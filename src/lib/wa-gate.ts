import type { Store } from "./store/types";
import type { Lead, WaMessage, WhatsAppSettings } from "./types";
import { WhatsAppSendError, type MetaTemplateRef, type SendContext, type SendResult, type StatusUpdate, type WhatsAppSender } from "./whatsapp";

/*
 * The one gate every WhatsApp message passes through. Nothing reaches Meta unless:
 *  - sending is switched on (whatsapp_settings.outbound_enabled), and
 *  - for anything automatic: automation is switched on AND Chetan has allowed
 *    automatic messages for that lead (leads.wa_auto_allowed), and
 *  - in test mode: the number is on the test list (alerts to Chetan always pass).
 * Every attempt, sent or not, is written to wa_messages with the reason.
 * Credentials alone never cause a message: the switches start off.
 */

export const BLOCK = {
  off: "WhatsApp sending is switched off.",
  automationOff: "Automatic WhatsApp messages are switched off.",
  testMode: "Test mode: this number is not on the test list.",
  leadNotAllowed: "Automatic WhatsApp messages are not allowed for this lead yet.",
} as const;

/** Why this message may not go out, or null when it may. Pure, so it is easy to test. */
export function blockReason(
  settings: WhatsAppSettings,
  msg: { to: string; automated: boolean; isAlert: boolean; lead: Pick<Lead, "wa_auto_allowed"> | null },
): string | null {
  if (!settings.outbound_enabled) return BLOCK.off;
  if (msg.isAlert) return null;
  if (msg.automated && !settings.automation_enabled) return BLOCK.automationOff;
  if (settings.test_mode && !settings.test_numbers.includes(msg.to)) return BLOCK.testMode;
  if (msg.automated && msg.lead && !msg.lead.wa_auto_allowed) return BLOCK.leadNotAllowed;
  return null;
}

/** Whether the bot may message this lead on its own right now (used before starting a conversation). */
export async function canAutomate(store: Store, lead: Pick<Lead, "wa_auto_allowed" | "phone">): Promise<boolean> {
  const s = await store.getWhatsAppSettings();
  return blockReason(s, { to: lead.phone, automated: true, isAlert: false, lead }) === null;
}

/** What went wrong with a message to a buyer, for Chetan's review. */
export type SendProblem = "failed" | "uncertain";

export class GatedSender implements WhatsAppSender {
  constructor(
    private inner: WhatsAppSender,
    private store: Store,
    private opts: {
      chetanPhone: string | null;
      /**
       * Called once per message to a buyer that may not have arrived: Meta refused it (failed) or
       * there was no clear answer (uncertain). Production wires this to flag the lead for Chetan
       * and alert him. A send whose outcome could not be written at all is reported by the sweep.
       */
      onProblem?: (m: WaMessage, problem: SendProblem) => Promise<void>;
    },
  ) {}

  get live() {
    return this.inner.live;
  }

  sendText(to: string, body: string, ctx?: SendContext) {
    return this.send(to, { kind: "text", body }, ctx, () => this.inner.sendText(to, body, ctx));
  }

  sendTemplate(to: string, t: MetaTemplateRef, ctx?: SendContext) {
    const body = `[template ${t.name}] ${t.params.join(" | ")}`.trim();
    return this.send(to, { kind: "template", body, template: t.name }, ctx, () => this.inner.sendTemplate(to, t, ctx));
  }

  /**
   * Reserve, then send. The log row is written BEFORE Meta is called, with the message's send_key,
   * which is unique in the database. When the same logical message is triggered twice at once
   * (a repeated webhook, overlapping cron runs, a double click), only one insert succeeds and only
   * that caller calls Meta; the others get the existing row back as a duplicate.
   * A blocked attempt stores no key: nothing was sent, so the message may go out once allowed.
   */
  private async send(
    to: string,
    content: { kind: "text" | "template"; body: string; template?: string },
    ctx: SendContext | undefined,
    deliver: () => Promise<SendResult>,
  ): Promise<SendResult> {
    const automated = ctx?.automated ?? true;
    const isAlert = !!this.opts.chetanPhone && to === this.opts.chetanPhone;
    const sendKey = ctx?.sendKey ?? null;
    if (!sendKey) throw new Error("Every WhatsApp message needs a send key (its stable identity), so it can never be sent twice.");

    const leadId = isAlert ? null : (ctx?.leadId ?? null);
    const lead = leadId ? await this.store.getLead(leadId) : null;
    const settings = await this.store.getWhatsAppSettings();
    const reason = blockReason(settings, { to, automated, isAlert, lead });

    const row = {
      lead_id: ctx?.leadId ?? null,
      direction: "out" as const,
      phone: to,
      kind: content.kind,
      body: content.body,
      template_name: content.template ?? null,
      actor: isAlert ? ("system" as const) : (ctx?.actor ?? (automated ? "bot" : "chetan")),
      automated,
    };

    if (reason) {
      // Already handled? Then say so rather than logging a second "not sent".
      const seen = await this.store.findWaMessage({ sendKey });
      if (seen) return duplicateOf(seen);
      await this.store.addWaMessage({ ...row, send_key: null, wamid: null, status: "blocked", error: reason });
      return { status: "blocked", wamid: null, error: reason };
    }

    const reserved = await this.store.addWaMessage({ ...row, send_key: sendKey, wamid: null, status: "sending", error: null });
    if (!reserved) {
      const seen = await this.store.findWaMessage({ sendKey });
      return seen ? duplicateOf(seen) : { status: "sending", wamid: null, error: null, duplicate: true };
    }

    let result: SendResult;
    try {
      result = await deliver();
    } catch (e) {
      // Never retried: after a timeout Meta may still deliver it, and a retry could reach the buyer twice.
      const certain = e instanceof WhatsAppSendError && e.kind === "rejected";
      const status: "failed" | "uncertain" = certain ? "failed" : "uncertain";
      const error = (e as Error).message.slice(0, 500);
      // Reported only once the status is recorded. If even that write fails, the row stays
      // "sending" and the hourly sweep reports it (once, by compare-and-set) instead.
      const updated = await this.store.updateWaMessageIf(reserved.id, ["sending"], { status, error }).catch(() => null);
      if (updated && !isAlert) await this.report(updated, status);
      return { status, wamid: null, error };
    }

    const patch = { status: result.status === "sending" ? ("uncertain" as const) : result.status, wamid: result.wamid, error: result.error ?? null };
    let recorded = false;
    for (let attempt = 0; attempt < 2 && !recorded; attempt++) {
      // Retrying the database write is safe; the message itself is never sent again.
      recorded = await this.store.updateWaMessage(reserved.id, patch).then(
        () => true,
        (e) => (console.error("wa_messages update after send failed", reserved.id, e), false),
      );
    }
    if (!recorded) {
      // Meta has it, but the log still says "sending". The hourly sweep marks it "uncertain" and
      // flags the lead for Chetan once the database answers again; nothing is resent meanwhile.
      console.error("WhatsApp message sent but not recorded; the sweep will flag it", reserved.id, result.wamid);
    }
    return result;
  }

  private async report(m: WaMessage, problem: SendProblem) {
    try {
      await this.opts.onProblem?.(m, problem);
    } catch (e) {
      console.error("WhatsApp problem report failed", m.id, problem, e);
    }
  }
}

function duplicateOf(seen: WaMessage): SendResult {
  const status: SendResult["status"] =
    seen.status === "delivered" || seen.status === "read" || seen.status === "received" ? "sent" : seen.status;
  return { status, wamid: seen.wamid, error: seen.error, duplicate: true };
}

/** Forward order of delivery receipts. "failed" is not on it: a failed message stays failed. */
const RANK: Record<string, number> = { blocked: 0, dry_run: 0, sending: 1, uncertain: 1, sent: 2, delivered: 3, read: 4 };

/**
 * A delivery receipt from Meta. Statuses only move forward (sent, delivered, read), and failed is
 * final: nothing overwrites it. Every change is a compare-and-set on the status just read, so
 * repeated or concurrent receipts count once. `newlyFailed` is true for exactly one caller per
 * failed message.
 */
export async function applyStatus(store: Store, u: StatusUpdate): Promise<{ message: WaMessage; newlyFailed: boolean } | null> {
  // Read, decide, compare-and-set. If another receipt changed the status in between, the set
  // matches nothing and we decide again on the fresh status, so concurrent receipts end in the
  // same state whatever order they land in.
  for (let attempt = 0; attempt < 5; attempt++) {
    const m = await store.findWaMessage({ wamid: u.wamid });
    if (!m) return null;
    // Failed is final. A delayed sent, delivered or read receipt (Meta does not guarantee order)
    // never overwrites it, so the failure and Chetan's review flag on the lead stay in place.
    if (m.status === "failed") return { message: m, newlyFailed: false };
    if (u.status === "failed") {
      // A failure counts even after an earlier "delivered": when in doubt, Chetan reviews it.
      const updated = await store.updateWaMessageIf(m.id, [m.status], { status: "failed", error: u.error });
      if (updated) return { message: updated, newlyFailed: true };
      continue;
    }
    if ((RANK[u.status] ?? 0) <= (RANK[m.status] ?? 0)) return { message: m, newlyFailed: false };
    const updated = await store.updateWaMessageIf(m.id, [m.status], { status: u.status });
    if (updated) return { message: updated, newlyFailed: false };
  }
  return { message: (await store.findWaMessage({ wamid: u.wamid }))!, newlyFailed: false };
}
