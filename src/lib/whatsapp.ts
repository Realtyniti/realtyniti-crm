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

export interface WhatsAppSender {
  /** True when messages actually leave; false in dry-run (demo) mode. */
  readonly live: boolean;
  sendText(to: string, body: string): Promise<string | null>;
  sendTemplate(to: string, t: MetaTemplateRef): Promise<string | null>;
}

export class CloudApiSender implements WhatsAppSender {
  readonly live = true;
  constructor(
    private phoneNumberId: string,
    private token: string,
  ) {}

  private async post(payload: object): Promise<string | null> {
    const res = await fetch(`${GRAPH_API}/${this.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
    });
    if (!res.ok) throw new Error(`WhatsApp send failed ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { messages?: { id: string }[] };
    return json.messages?.[0]?.id ?? null;
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
  sent: { to: string; text?: string; template?: MetaTemplateRef }[] = [];
  async sendText(to: string, text: string) {
    this.sent.push({ to, text });
    return null;
  }
  async sendTemplate(to: string, template: MetaTemplateRef) {
    this.sent.push({ to, template });
    return null;
  }
}

export interface InboundMessage {
  id: string;
  from: string;
  name: string | null;
  text: string;
  timestamp: string;
}

type WaValue = {
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
