import { sendApproved, type CatcherConfig } from "./catcher";
import { nextFollowUpDate } from "./intake-sop";
import type { Store } from "./store/types";
import type { Lead } from "./types";
import { windowOpen } from "./whatsapp";

/*
 * Realtyniti Follow-up Clock (SYS-05). On a lead's follow-up date it sends a
 * pre-approved message, sets the next date from the intake cadence, and stops
 * (flagging Chetan) once a buyer has ignored two follow-ups in a row. Money
 * questions already stop it through the needs_chetan flag.
 */

/** Follow-ups only go out in daytime India hours. */
export const SEND_HOURS_IST = { from: 10, to: 19 } as const;
export const MAX_UNANSWERED = 2;

export function istHour(now: Date): number {
  return Number(now.toLocaleString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false }));
}

export function isDue(l: Lead, now: Date): boolean {
  return (
    l.status !== "converted" &&
    l.status !== "lost" &&
    !l.needs_chetan &&
    !!l.next_follow_up_at &&
    l.next_follow_up_at <= now.toISOString()
  );
}

/**
 * Who the clock may message on its own. A follow-up only goes to a lead that:
 *  - Chetan has allowed automatic WhatsApp messages for (none of the leads that existed before go-live), and
 *  - has already had at least one WhatsApp message from us that Meta accepted.
 * Everyone else who is due stays on Chetan's due list.
 */
export function eligibleForAutoFollowUp(l: Lead, contacted: Set<string>): boolean {
  return l.wa_auto_allowed && contacted.has(l.id);
}

export interface ClockResult {
  sent: number;
  flagged: number;
  /** Due but nothing could be sent automatically; they stay on Chetan's due list. */
  leftForChetan: number;
}

export async function runFollowUpClock(store: Store, cfg: CatcherConfig, now = new Date()): Promise<ClockResult> {
  const result: ClockResult = { sent: 0, flagged: 0, leftForChetan: 0 };
  const hour = istHour(now);
  if (hour < SEND_HOURS_IST.from || hour >= SEND_HOURS_IST.to) return result;

  const due = (await store.listLeads()).filter((l) => isDue(l, now));
  const contacted = await store.leadsContactedOnWhatsApp(due.map((l) => l.id));
  for (const lead of due) {
    if (!eligibleForAutoFollowUp(lead, contacted) || (cfg.canAutomate && !(await cfg.canAutomate(lead)))) {
      result.leftForChetan++;
      continue;
    }
    if (lead.followups_unanswered >= MAX_UNANSWERED) {
      await store.updateLead(lead.id, {
        needs_chetan: true,
        needs_chetan_reason: `Gone quiet after ${MAX_UNANSWERED} follow-ups`,
      });
      await store.addEvent({
        lead_id: lead.id,
        kind: "flag",
        channel: null,
        body: `No reply to ${MAX_UNANSWERED} follow-ups. The clock has stopped; call them or close the lead with a reason.`,
      });
      result.flagged++;
      continue;
    }

    // The CRM follow-up template for this tag must be approved by Chetan, whichever way the message goes out.
    const key = `followup.${lead.temperature ?? "warm"}`;
    // This follow-up's identity is the lead and the due time it answers: overlapping or repeated
    // clock runs see the same due time, so the database lets only one of them send it.
    const trigger = `followup:${lead.id}:${lead.next_follow_up_at}`;
    const approved = !!(await store.getTemplate(key))?.approved_at;
    let sent = false;
    if (!approved) {
      sent = false;
    } else if (windowOpen(lead.last_inbound_at, now)) {
      sent = await sendApproved(store, cfg, lead, key, trigger);
    } else if (cfg.followupTemplate) {
      const r = await cfg.sender.sendTemplate(
        lead.phone,
        { ...cfg.followupTemplate, params: [lead.name?.split(" ")[0] ?? "there", lead.brand] },
        { leadId: lead.id, automated: true, actor: "bot", sendKey: `${trigger}:template` },
      );
      if (r.duplicate) {
        // Another run already sent (or is sending) this follow-up; it moves the date on, not this one.
        result.leftForChetan++;
        continue;
      }
      sent = r.status === "sent" || r.status === "dry_run";
      await store.addEvent({
        lead_id: lead.id,
        kind: sent ? "message_out" : "flag",
        channel: "whatsapp",
        body: sent
          ? `${r.status === "sent" ? "" : "[dry run] "}Sent follow-up template (${cfg.followupTemplate.name}).`
          : `Follow-up not sent: ${r.error ?? r.status}`,
      });
    }

    if (!sent) {
      result.leftForChetan++;
      continue;
    }
    await store.updateLead(lead.id, {
      followups_unanswered: lead.followups_unanswered + 1,
      last_followup_at: now.toISOString(),
      next_follow_up_at: nextFollowUpDate(lead, now).toISOString(),
    });
    result.sent++;
  }
  return result;
}

/** Chetan followed up himself (a call, a personal message). Resets the clock. */
export async function markFollowedUp(store: Store, leadId: string, note: string | null, now = new Date()) {
  const lead = await store.getLead(leadId);
  if (!lead) return null;
  const updated = await store.updateLead(leadId, {
    followups_unanswered: 0,
    last_followup_at: now.toISOString(),
    next_follow_up_at: nextFollowUpDate(lead, now).toISOString(),
  });
  await store.addEvent({
    lead_id: leadId,
    kind: "note",
    channel: "call",
    body: note ? `Chetan followed up: ${note}` : "Chetan followed up.",
  });
  return updated;
}
