import { beforeEach, describe, expect, it } from "vitest";
import { handleInbound, type CatcherConfig } from "@/lib/catcher";
import { captureLead, saveTemplate } from "@/lib/leads";
import { parseMicroMarket } from "@/lib/parse";
import { QUALIFYING_QUESTIONS } from "@/lib/intake-sop";
import { AREAS, answersToRequirement, QUESTIONNAIRE_V1, WHATSAPP_TO_CALL_KEY } from "@/lib/questionnaire";
import { MemoryStore } from "@/lib/store/memory";
import { SAFE_WHATSAPP_SETTINGS, type WhatsAppSettings } from "@/lib/types";
import { applyStatus, BLOCK, blockReason, canAutomate, GatedSender } from "@/lib/wa-gate";
import { sendManualReply, settingsFromForm } from "@/lib/wa-reply";
import { statusUpdates, type MetaTemplateRef, type SendContext, type SendResult, type WhatsAppSender } from "@/lib/whatsapp";

const BUYER = "+919876543210";
const OTHER = "+919811122233";
const CHETAN = "+919999988888";

/** Stands in for Meta: records what reached it and hands back a message id. */
class FakeMeta implements WhatsAppSender {
  readonly live = true;
  calls: { to: string; text?: string; template?: string; ctx?: SendContext }[] = [];
  fail: string | null = null;
  async sendText(to: string, text: string, ctx?: SendContext): Promise<SendResult> {
    return this.go({ to, text, ctx });
  }
  async sendTemplate(to: string, t: MetaTemplateRef, ctx?: SendContext): Promise<SendResult> {
    return this.go({ to, template: t.name, ctx });
  }
  private async go(c: FakeMeta["calls"][number]): Promise<SendResult> {
    if (this.fail) throw new Error(this.fail);
    this.calls.push(c);
    return { status: "sent", wamid: `wamid.out.${this.calls.length}` };
  }
}

let store: MemoryStore;
let meta: FakeMeta;
let gated: GatedSender;
let failures: string[];

const settings = (patch: Partial<WhatsAppSettings>) => store.updateWhatsAppSettings(patch);
const allOn = () => settings({ outbound_enabled: true, automation_enabled: true, test_mode: false });

beforeEach(async () => {
  store = new MemoryStore();
  meta = new FakeMeta();
  failures = [];
  gated = new GatedSender(meta, store, { chetanPhone: CHETAN, onFailure: async (m) => void failures.push(m.id) });
  for (const t of await store.listTemplates()) await saveTemplate(store, t.key, t.body, true);
});

describe("send gate rules", () => {
  const on: WhatsAppSettings = { outbound_enabled: true, automation_enabled: true, test_mode: false, test_numbers: [], updated_at: null };
  const allowed = { wa_auto_allowed: true };

  it("starts with everything off", () => {
    expect(SAFE_WHATSAPP_SETTINGS).toMatchObject({ outbound_enabled: false, automation_enabled: false, test_mode: true, test_numbers: [] });
  });

  it("blocks everything, even alerts, when sending is off", () => {
    const off = { ...on, outbound_enabled: false };
    expect(blockReason(off, { to: BUYER, automated: false, isAlert: false, lead: allowed })).toBe(BLOCK.off);
    expect(blockReason(off, { to: CHETAN, automated: true, isAlert: true, lead: null })).toBe(BLOCK.off);
  });

  it("blocks automatic messages when automation is off, but not Chetan's own replies", () => {
    const s = { ...on, automation_enabled: false };
    expect(blockReason(s, { to: BUYER, automated: true, isAlert: false, lead: allowed })).toBe(BLOCK.automationOff);
    expect(blockReason(s, { to: BUYER, automated: false, isAlert: false, lead: allowed })).toBeNull();
  });

  it("in test mode only lets listed numbers through", () => {
    const s = { ...on, test_mode: true, test_numbers: [BUYER] };
    expect(blockReason(s, { to: BUYER, automated: false, isAlert: false, lead: allowed })).toBeNull();
    expect(blockReason(s, { to: OTHER, automated: false, isAlert: false, lead: allowed })).toBe(BLOCK.testMode);
    expect(blockReason(s, { to: CHETAN, automated: true, isAlert: true, lead: null })).toBeNull();
  });

  it("needs the per-lead OK for automatic messages only", () => {
    const notAllowed = { wa_auto_allowed: false };
    expect(blockReason(on, { to: BUYER, automated: true, isAlert: false, lead: notAllowed })).toBe(BLOCK.leadNotAllowed);
    expect(blockReason(on, { to: BUYER, automated: false, isAlert: false, lead: notAllowed })).toBeNull();
  });
});

describe("GatedSender", () => {
  async function lead(allowed: boolean, phone = BUYER) {
    return (await captureLead(store, { source: "meta", phone, name: "Ravi", autoWhatsApp: allowed })).lead;
  }

  it("with the default switches, nothing reaches Meta and the attempt is logged", async () => {
    const l = await lead(true);
    const r = await gated.sendText(BUYER, "Hi", { leadId: l.id });
    expect(r).toMatchObject({ status: "blocked", error: BLOCK.off });
    expect(meta.calls).toHaveLength(0);
    expect(await store.listWaMessages(l.id)).toMatchObject([{ status: "blocked", direction: "out", error: BLOCK.off }]);
  });

  it("credentials plus switches on still send nothing automatic to a lead not allowed", async () => {
    await allOn();
    const l = await lead(false);
    expect((await gated.sendText(BUYER, "Hi", { leadId: l.id, automated: true })).status).toBe("blocked");
    expect(await canAutomate(store, l)).toBe(false);
    expect(meta.calls).toHaveLength(0);
  });

  it("sends when every switch allows it and logs Meta's message id", async () => {
    await allOn();
    const l = await lead(true);
    const r = await gated.sendText(BUYER, "Hi", { leadId: l.id, automated: true });
    expect(r).toMatchObject({ status: "sent", wamid: "wamid.out.1" });
    expect(await store.leadsContactedOnWhatsApp([l.id])).toEqual(new Set([l.id]));
  });

  it("lets an alert to Chetan through with only sending on", async () => {
    await settings({ outbound_enabled: true });
    expect((await gated.sendText(CHETAN, "New hot lead")).status).toBe("sent");
    expect(meta.calls.map((c) => c.to)).toEqual([CHETAN]);
  });

  it("sends a form's message once, however many times it is submitted", async () => {
    await settings({ outbound_enabled: true, test_numbers: [BUYER] });
    const l = await lead(false);
    const ctx = { leadId: l.id, automated: false, actor: "chetan" as const, clientRef: "ref-1" };
    const first = await gated.sendText(BUYER, "Hello", ctx);
    const again = await gated.sendText(BUYER, "Hello", ctx);
    expect(first.duplicate).toBeUndefined();
    expect(again).toMatchObject({ duplicate: true, status: "sent" });
    expect(meta.calls).toHaveLength(1);
  });

  it("logs a refusal as failed, does not retry, and reports it", async () => {
    await allOn();
    const l = await lead(true);
    meta.fail = "WhatsApp send failed (400): bad number";
    const r = await gated.sendText(BUYER, "Hi", { leadId: l.id });
    expect(r.status).toBe("failed");
    expect(meta.calls).toHaveLength(0);
    expect(await store.listWaMessages(l.id)).toMatchObject([{ status: "failed", error: meta.fail }]);
    expect(failures).toHaveLength(1);
    // A failed message does not count as having reached the lead.
    expect((await store.leadsContactedOnWhatsApp([l.id])).size).toBe(0);
  });
});

describe("delivery receipts", () => {
  const receipt = (id: string, status: string, errors?: unknown[]) => ({
    entry: [{ changes: [{ field: "messages", value: { statuses: [{ id, status, timestamp: "1767225600", recipient_id: "919876543210", errors }] } }] }],
  });

  async function sentMessage() {
    await allOn();
    const { lead } = await captureLead(store, { source: "meta", phone: BUYER, autoWhatsApp: true });
    const r = await gated.sendText(BUYER, "Hi", { leadId: lead.id });
    return r.wamid!;
  }

  it("parses Meta's status webhook", () => {
    expect(statusUpdates(receipt("wamid.x", "failed", [{ code: 131026, title: "Message undeliverable" }]))).toEqual([
      { wamid: "wamid.x", status: "failed", timestamp: "2026-01-01T00:00:00.000Z", recipient: BUYER, error: "131026 · Message undeliverable" },
    ]);
    expect(statusUpdates(receipt("wamid.x", "deleted"))).toEqual([]);
  });

  it("only moves forward: a late 'sent' never overwrites 'read'", async () => {
    const wamid = await sentMessage();
    for (const s of ["delivered", "read", "sent", "delivered"]) {
      for (const u of statusUpdates(receipt(wamid, s))) await applyStatus(store, u);
    }
    expect((await store.findWaMessage({ wamid }))!.status).toBe("read");
  });

  it("reports a failure once", async () => {
    const wamid = await sentMessage();
    const [u] = statusUpdates(receipt(wamid, "failed", [{ code: 131049, title: "Not delivered" }]));
    expect((await applyStatus(store, u))!.newlyFailed).toBe(true);
    expect((await applyStatus(store, u))!.newlyFailed).toBe(false);
    expect((await store.findWaMessage({ wamid }))!).toMatchObject({ status: "failed", error: "131049 · Not delivered" });
  });

  it("ignores receipts for messages it does not know", async () => {
    const [u] = statusUpdates(receipt("wamid.unknown", "read"));
    expect(await applyStatus(store, u)).toBeNull();
  });
});

describe("incoming WhatsApp with the switches", () => {
  let cfg: CatcherConfig;
  let n = 0;
  const msg = (text: string) => ({ id: `wamid.in.${++n}`, from: BUYER, name: "Ravi", text, timestamp: new Date().toISOString(), kind: "text" as const });

  beforeEach(() => {
    cfg = { sender: gated, chetanPhone: CHETAN, openerTemplate: null, alertTemplate: null, canAutomate: (l) => canAutomate(store, l) };
  });

  it("with automation off, logs the message and the bot sends nothing to the buyer", async () => {
    await settings({ outbound_enabled: true, automation_enabled: false, test_mode: false });
    const lead = await handleInbound(store, cfg, msg("Hi, I want a 2BHK"));
    expect(meta.calls.filter((c) => c.to === BUYER)).toHaveLength(0);
    expect(meta.calls.map((c) => c.to)).toEqual([CHETAN]);
    expect(await store.listWaMessages(lead.id)).toMatchObject([{ direction: "in", status: "received", actor: "buyer" }]);
  });

  it("with sending off, still receives and logs, and nothing goes out", async () => {
    const lead = await handleInbound(store, cfg, msg("Hello"));
    expect(meta.calls).toHaveLength(0);
    expect((await store.listWaMessages(lead.id)).filter((m) => m.direction === "in")).toHaveLength(1);
  });

  it("handles a webhook delivered twice only once", async () => {
    await allOn();
    const m = msg("Hi");
    const lead = await handleInbound(store, cfg, m);
    const sentAfterFirst = meta.calls.length;
    await handleInbound(store, cfg, m);
    expect(meta.calls.length).toBe(sentAfterFirst);
    expect((await store.listWaMessages(lead.id)).filter((x) => x.direction === "in")).toHaveLength(1);
  });

  it("STOP withdraws the lead's automatic-message OK", async () => {
    await allOn();
    await handleInbound(store, cfg, msg("Hi"));
    const lead = await handleInbound(store, cfg, msg("STOP"));
    expect((await store.getLead(lead.id))!.wa_auto_allowed).toBe(false);
  });
});

describe("Chetan's reply box", () => {
  const cfg = (): CatcherConfig => ({ sender: gated, chetanPhone: CHETAN, openerTemplate: null, alertTemplate: null });
  const NOW = new Date("2026-11-04T06:00:00Z");

  async function leadWhoWrote(hoursAgo: number) {
    const { lead } = await captureLead(store, { source: "meta", phone: BUYER, name: "Ravi" });
    return store.updateLead(lead.id, { last_inbound_at: new Date(NOW.getTime() - hoursAgo * 3600_000).toISOString() });
  }

  it("refuses free text after the 24-hour window", async () => {
    const l = await leadWhoWrote(25);
    const r = await sendManualReply(store, cfg(), { leadId: l.id, body: "Hi", clientRef: "a" }, NOW);
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/24 hours/) });
    expect(await store.listWaMessages(l.id)).toHaveLength(0);
  });

  it("refuses an empty message", async () => {
    const l = await leadWhoWrote(1);
    expect(await sendManualReply(store, cfg(), { leadId: l.id, body: "   ", clientRef: "a" }, NOW)).toMatchObject({ ok: false });
  });

  it("says why when sending is switched off", async () => {
    const l = await leadWhoWrote(1);
    const r = await sendManualReply(store, cfg(), { leadId: l.id, body: "Hi", clientRef: "a" }, NOW);
    expect(r).toMatchObject({ ok: false, error: `Not sent: ${BLOCK.off}` });
    expect(meta.calls).toHaveLength(0);
  });

  it("sends with automation off and the lead not allowed, logs it on the card, and only once", async () => {
    await settings({ outbound_enabled: true, test_numbers: [BUYER] });
    const l = await leadWhoWrote(1);
    const input = { leadId: l.id, body: "Sharing the brochure now", clientRef: "ref-9" };
    expect(await sendManualReply(store, cfg(), input, NOW)).toMatchObject({ ok: true, result: { status: "sent" } });
    expect(await sendManualReply(store, cfg(), input, NOW)).toMatchObject({ ok: true, result: { duplicate: true } });
    expect(meta.calls).toHaveLength(1);
    expect(meta.calls[0].ctx).toMatchObject({ automated: false, actor: "chetan" });
    const events = await store.listEvents(l.id);
    expect(events.filter((e) => e.kind === "message_out").map((e) => e.body)).toEqual(["Chetan: Sharing the brochure now"]);
  });

  it("a resubmitted blocked reply is reported as not sent, never as sent", async () => {
    const l = await leadWhoWrote(1);
    const input = { leadId: l.id, body: "Hi", clientRef: "same" };
    await sendManualReply(store, cfg(), input, NOW);
    expect(await sendManualReply(store, cfg(), input, NOW)).toMatchObject({ ok: false, error: `Not sent: ${BLOCK.off}` });
  });

  it("in test mode cannot reach a number off the list", async () => {
    await settings({ outbound_enabled: true, test_numbers: [OTHER] });
    const l = await leadWhoWrote(1);
    expect(await sendManualReply(store, cfg(), { leadId: l.id, body: "Hi", clientRef: "b" }, NOW)).toMatchObject({
      ok: false,
      error: `Not sent: ${BLOCK.testMode}`,
    });
  });
});

describe("switches form", () => {
  it("reads checkboxes and normalises test numbers, reporting bad ones", () => {
    const fd = new FormData();
    fd.set("outbound_enabled", "on");
    fd.set("test_mode", "on");
    fd.set("test_numbers", "98765 43210\n+91 98765 43210, 12\n");
    expect(settingsFromForm(fd)).toEqual({
      patch: { outbound_enabled: true, automation_enabled: false, test_mode: true, test_numbers: [BUYER] },
      invalid: ["12"],
    });
  });
});

describe("one question bank for calls and WhatsApp", () => {
  const callKeys = QUESTIONNAIRE_V1.sections.flatMap((s) => s.questions.map((q) => q.key));
  const option = (key: string, label: string) =>
    QUESTIONNAIRE_V1.sections.flatMap((s) => s.questions).find((q) => q.key === key)!.options.find((o) => o.label === label)!.value;

  it("every WhatsApp qualifying question is also a calling question", () => {
    for (const q of QUALIFYING_QUESTIONS) expect(callKeys).toContain(WHATSAPP_TO_CALL_KEY[q.key]);
  });

  it("both assistants store the same area names", () => {
    for (const a of AREAS) {
      expect(answersToRequirement({ location: { values: [option("location", a.label)] } }).micro_market).toBe(a.stored);
      expect(parseMicroMarket(a.label)).toBe(a.stored);
    }
  });

  it("calling answers fill the same card fields as WhatsApp answers", () => {
    const r = answersToRequirement({
      budget: { values: [option("budget", "₹45–55 Lakhs")] },
      property_type: { values: [option("property_type", "2BHK")] },
      purpose: { values: [option("purpose", "Self-Use")] },
      timeline: { values: [option("timeline", "Within 1–3 Months")] },
      site_visit: { values: [option("site_visit", "This Weekend")] },
    });
    expect(r).toEqual({
      budget_min_inr: 4_500_000,
      budget_max_inr: 5_500_000,
      property_type: "2BHK",
      purpose: "end_use",
      timeline_months: 3,
      agreed_site_visit: true,
    });
    expect(answersToRequirement({ purpose: { values: [option("purpose", "Both")] } }).purpose).toBe("investment");
    expect(answersToRequirement({ budget: { values: [], skipped: true } })).toEqual({});
  });
});
