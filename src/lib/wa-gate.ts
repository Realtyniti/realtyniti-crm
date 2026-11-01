import type { Store } from "./store/types";
import type { Lead, WaMessage, WhatsAppSettings } from "./types";
import type { MetaTemplateRef, SendContext, SendResult, StatusUpdate, WhatsAppSender } from "./whatsapp";

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

export class GatedSender implements WhatsAppSender {
  constructor(
    private inner: WhatsAppSender,
    private store: Store,
    private opts: {
      chetanPhone: string | null;
      /** Called when Meta refuses a message to a buyer, so Chetan hears about it. */
      onFailure?: (m: WaMessage) => Promise<void>;
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

  private async send(
    to: string,
    content: { kind: "text" | "template"; body: string; template?: string },
    ctx: SendContext | undefined,
    deliver: () => Promise<SendResult>,
  ): Promise<SendResult> {
    const automated = ctx?.automated ?? true;
    const isAlert = !!this.opts.chetanPhone && to === this.opts.chetanPhone;
    const clientRef = ctx?.clientRef ?? null;

    if (clientRef) {
      const seen = await this.store.findWaMessage({ clientRef });
      if (seen) return { status: toResult(seen.status), wamid: seen.wamid, error: seen.error, duplicate: true };
    }

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
      client_ref: clientRef,
    };

    if (reason) {
      await this.store.addWaMessage({ ...row, wamid: null, status: "blocked", error: reason });
      return { status: "blocked", wamid: null, error: reason };
    }

    let result: SendResult;
    try {
      result = await deliver();
    } catch (e) {
      const error = (e as Error).message.slice(0, 500);
      const failed = await this.store.addWaMessage({ ...row, wamid: null, status: "failed", error });
      if (failed && !isAlert) await this.opts.onFailure?.(failed).catch(() => undefined);
      return { status: "failed", wamid: null, error };
    }
    const saved = await this.store.addWaMessage({ ...row, wamid: result.wamid, status: result.status, error: result.error ?? null });
    if (!saved) return { ...result, duplicate: true };
    return result;
  }
}

function toResult(s: WaMessage["status"]): SendResult["status"] {
  if (s === "delivered" || s === "read") return "sent";
  if (s === "received") return "sent";
  return s;
}

const RANK: Record<string, number> = { blocked: 0, dry_run: 0, failed: 1, sent: 2, delivered: 3, read: 4 };

/**
 * A delivery receipt from Meta. Statuses only move forward (sent, delivered, read),
 * so a late "sent" never overwrites "read". Returns the message when it has just failed.
 */
export async function applyStatus(store: Store, u: StatusUpdate): Promise<{ message: WaMessage; newlyFailed: boolean } | null> {
  const m = await store.findWaMessage({ wamid: u.wamid });
  if (!m) return null;
  if (u.status === "failed") {
    if (m.status === "failed" || m.status === "delivered" || m.status === "read") return { message: m, newlyFailed: false };
    const updated = await store.updateWaMessage(m.id, { status: "failed", error: u.error });
    return { message: updated, newlyFailed: true };
  }
  if ((RANK[u.status] ?? 0) <= (RANK[m.status] ?? 0)) return { message: m, newlyFailed: false };
  return { message: await store.updateWaMessage(m.id, { status: u.status }), newlyFailed: false };
}
