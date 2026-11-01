import { normalisePhone } from "./phone";
import type { CatcherConfig } from "./catcher";
import { LeadError } from "./leads";
import type { Store } from "./store/types";
import type { WhatsAppSettings } from "./types";
import { windowOpen, type SendResult } from "./whatsapp";

/*
 * Chetan replying to a buyer by hand from the customer page. It is not automatic,
 * so the automation switch and the per-lead OK do not apply, but the master switch
 * and test mode still do (see wa-gate.ts). Free text is only allowed by Meta inside
 * 24 hours of the buyer's last message.
 */

export const MAX_REPLY = 4096;

export type ReplyOutcome = { ok: true; result: SendResult } | { ok: false; error: string };

export async function sendManualReply(
  store: Store,
  cfg: CatcherConfig,
  input: { leadId: string; body: string; clientRef: string | null },
  now = new Date(),
): Promise<ReplyOutcome> {
  const lead = await store.getLead(input.leadId);
  if (!lead) throw new LeadError("Lead not found");
  const body = input.body.trim();
  if (!body) return { ok: false, error: "Type a message first." };
  if (body.length > MAX_REPLY) return { ok: false, error: `WhatsApp allows up to ${MAX_REPLY} characters.` };
  if (!windowOpen(lead.last_inbound_at, now)) {
    return {
      ok: false,
      error: "The buyer hasn't messaged in the last 24 hours, so WhatsApp only allows an approved template. Call them, or wait for them to write.",
    };
  }

  const result = await cfg.sender.sendText(lead.phone, body, {
    leadId: lead.id,
    automated: false,
    actor: "chetan",
    clientRef: input.clientRef,
  });
  if (result.duplicate) {
    if (result.status === "blocked" || result.status === "failed") return { ok: false, error: `Not sent: ${result.error ?? "refused"}` };
    return { ok: true, result };
  }
  if (result.status === "blocked") return { ok: false, error: `Not sent: ${result.error}` };
  if (result.status === "failed") {
    await store.addEvent({ lead_id: lead.id, kind: "flag", channel: "whatsapp", body: `WhatsApp message failed: ${result.error}` });
    return { ok: false, error: `WhatsApp refused it: ${result.error}` };
  }
  await store.addEvent({
    lead_id: lead.id,
    kind: "message_out",
    channel: "whatsapp",
    body: `${result.status === "dry_run" ? "[dry run, WhatsApp not connected] " : ""}Chetan: ${body}`,
  });
  if (!lead.first_reply_at) await store.updateLead(lead.id, { first_reply_at: now.toISOString() });
  return { ok: true, result };
}

/** Chetan allowing (or stopping) automatic WhatsApp messages for one lead. */
export async function setAutoWhatsApp(store: Store, leadId: string, allowed: boolean) {
  const lead = await store.getLead(leadId);
  if (!lead) throw new LeadError("Lead not found");
  if (lead.wa_auto_allowed === allowed) return lead;
  const updated = await store.updateLead(leadId, { wa_auto_allowed: allowed });
  await store.addEvent({
    lead_id: leadId,
    kind: "note",
    channel: "whatsapp",
    body: allowed ? "Chetan allowed automatic WhatsApp messages for this lead." : "Chetan stopped automatic WhatsApp messages for this lead.",
  });
  return updated;
}

/** Reads the switches form. Test numbers: one per line or comma-separated; bad numbers are reported, not saved. */
export function settingsFromForm(fd: FormData): { patch: Omit<WhatsAppSettings, "updated_at">; invalid: string[] } {
  const raw = String(fd.get("test_numbers") ?? "");
  const parts = raw.split(/[\n,]+/).map((p) => p.trim()).filter(Boolean);
  const numbers: string[] = [];
  const invalid: string[] = [];
  for (const p of parts) {
    const n = normalisePhone(p);
    if (n) {
      if (!numbers.includes(n)) numbers.push(n);
    } else invalid.push(p);
  }
  return {
    patch: {
      outbound_enabled: fd.get("outbound_enabled") === "on",
      automation_enabled: fd.get("automation_enabled") === "on",
      test_mode: fd.get("test_mode") === "on",
      test_numbers: numbers,
    },
    invalid,
  };
}
