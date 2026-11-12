import { GRAPH_API } from "./intake/meta";

/*
 * WhatsApp Cloud API (Meta). Free-text messages can only be sent within 24
 * hours of the buyer's last message; outside that window Meta requires a
 * pre-registered "message template", used here for the first contact with
 * Meta/website leads and for alerts to Chetan.
 */

export interface MetaTemplateRef {
  name: string;
  language: string;
  params: string[];
}

/** Who is sending and why. Omitted means an automatic message from the bot, the strictest case. */
export interface SendContext {
  leadId?: string | null;
  /** True (the default) for anything the CRM sends on its own; false only for a reply Chetan typed. */
  automated?: boolean;
  actor?: "chetan" | "bot" | "system";
  /** One-time id from the reply form; a second send with the same id is refused as a duplicate. */
  clientRef?: string | null;
}

export interface SendResult {
  /**
   * sent: Meta accepted it. dry_run: WhatsApp not connected. blocked: stopped by the send gate. failed: Meta refused it.
   * sending: only on a duplicate, when the first submission is still waiting for Meta.
   */
  status: "sent" | "dry_run" | "blocked" | "failed" | "sending";
  wamid: string | null;
  error?: string | null;
  /** The same reply form was submitted twice; nothing new was sent. */
  duplicate?: boolean;
}

/** True when the message went out (or would have, in dry-run mode). */
export const delivered = (r: SendResult) => r.status === "sent" || r.status === "dry_run";

export interface WhatsAppSender {
  /** True when messages actually leave; false in dry-run (demo) mode. */
  readonly live: boolean;
  sendText(to: string, body: string, ctx?: SendContext): Promise<SendResult>;
  sendTemplate(to: string, t: MetaTemplateRef, ctx?: SendContext): Promise<SendResult>;
}

export class CloudApiSender implements WhatsAppSender {
  readonly live = true;
  constructor(
    private phoneNumberId: string,
    private token: string,
  ) {}

  private async post(payload: object): Promise<SendResult> {
    const res = await fetch(`${GRAPH_API}/${this.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
    });
    if (!res.ok) throw new Error(`WhatsApp send failed ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { messages?: { id: string }[] };
    return { status: "sent", wamid: json.messages?.[0]?.id ?? null };
  }

  sendText(to: string, body: string) {
    return this.post({ to: to.replace("+", ""), type: "text", text: { body, preview_url: false } });
  }

  sendTemplate(to: string, t: MetaTemplateRef) {
    // Template parameters may not contain newlines or tabs.
    const params = t.params.map((p) => ({ type: "text", text: p.replace(/\s+/g, " ").trim() || "-" }));
    return this.post({
      to: to.replace("+", ""),
      type: "template",
      template: {
        name: t.name,
        language: { code: t.language },
        components: params.length ? [{ type: "body", parameters: params }] : [],
      },
    });
  }
}

/** Records what would have been sent. Used until WhatsApp is connected, and in tests. */
export class DryRunSender implements WhatsAppSender {
  readonly live = false;
  sent: { to: string; text?: string; template?: MetaTemplateRef; ctx?: SendContext }[] = [];
  async sendText(to: string, text: string, ctx?: SendContext): Promise<SendResult> {
    this.sent.push({ to, text, ctx });
    return { status: "dry_run", wamid: null };
  }
  async sendTemplate(to: string, template: MetaTemplateRef, ctx?: SendContext): Promise<SendResult> {
    this.sent.push({ to, template, ctx });
    return { status: "dry_run", wamid: null };
  }
}

export interface InboundMessage {
  id: string;
  from: string;
  name: string | null;
  text: string;
  timestamp: string;
  /** text for typed words and button taps; media for images, voice notes, documents and the like. */
  kind?: "text" | "media";
}

type WaValue = {
  statuses?: {
    id: string;
    status: string;
    timestamp: string;
    recipient_id: string;
    errors?: { code?: number; title?: string; message?: string; error_data?: { details?: string } }[];
  }[];
  contacts?: { wa_id: string; profile?: { name?: string } }[];
  messages?: {
    id: string;
    from: string;
    timestamp: string;
    type: string;
    text?: { body: string };
    button?: { text: string };
    interactive?: { button_reply?: { title: string }; list_reply?: { title: string } };
  }[];
};

/** Pulls buyer messages out of a WhatsApp webhook body (ignores delivery receipts). */
export function inboundMessages(body: unknown): InboundMessage[] {
  const out: InboundMessage[] = [];
  const entries = (body as { entry?: { changes?: { field?: string; value?: WaValue }[] }[] })?.entry ?? [];
  for (const e of entries) {
    for (const c of e.changes ?? []) {
      if (c.field !== "messages" || !c.value?.messages) continue;
      const names = new Map((c.value.contacts ?? []).map((ct) => [ct.wa_id, ct.profile?.name ?? null]));
      for (const m of c.value.messages) {
        const text =
          m.text?.body ??
          m.button?.text ??
          m.interactive?.button_reply?.title ??
          m.interactive?.list_reply?.title ??
          `[${m.type} message]`;
        out.push({
          id: m.id,
          from: `+${m.from}`,
          name: names.get(m.from) ?? null,
          text,
          timestamp: new Date(Number(m.timestamp) * 1000).toISOString(),
          kind: m.text || m.button || m.interactive ? "text" : "media",
        });
      }
    }
  }
  return out;
}

/** Within Meta's 24-hour customer service window, free text is allowed. */
export function windowOpen(lastInboundAt: string | null, now = new Date()): boolean {
  return !!lastInboundAt && now.getTime() - new Date(lastInboundAt).getTime() < 24 * 3600_000;
}

export interface StatusUpdate {
  wamid: string;
  status: "sent" | "delivered" | "read" | "failed";
  timestamp: string;
  recipient: string;
  error: string | null;
}

/** Pulls delivery receipts (sent, delivered, read, failed) out of a WhatsApp webhook body. */
export function statusUpdates(body: unknown): StatusUpdate[] {
  const out: StatusUpdate[] = [];
  const entries = (body as { entry?: { changes?: { field?: string; value?: WaValue }[] }[] })?.entry ?? [];
  for (const e of entries) {
    for (const c of e.changes ?? []) {
      if (c.field !== "messages") continue;
      for (const st of c.value?.statuses ?? []) {
        if (!["sent", "delivered", "read", "failed"].includes(st.status)) continue;
        const err = st.errors?.[0];
        out.push({
          wamid: st.id,
          status: st.status as StatusUpdate["status"],
          timestamp: new Date(Number(st.timestamp) * 1000).toISOString(),
          recipient: `+${st.recipient_id}`,
          error: err ? [err.code, err.title, err.error_data?.details ?? err.message].filter(Boolean).join(" · ") : null,
        });
      }
    }
  }
  return out;
}
