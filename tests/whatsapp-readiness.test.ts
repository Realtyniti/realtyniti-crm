import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { handleInbound, handleReceipt, type CatcherConfig } from "@/lib/catcher";
import { runFollowUpClock } from "@/lib/followup-clock";
import { captureLead, saveTemplate } from "@/lib/leads";
import { parseMicroMarket } from "@/lib/parse";
import { QUALIFYING_QUESTIONS } from "@/lib/intake-sop";
import { AREAS, answersToRequirement, QUESTIONNAIRE_V1, WHATSAPP_TO_CALL_KEY } from "@/lib/questionnaire";
import { MemoryStore } from "@/lib/store/memory";
import { SAFE_WHATSAPP_SETTINGS, type WhatsAppSettings } from "@/lib/types";
import { applyStatus, BLOCK, blockReason, canAutomate, GatedSender } from "@/lib/wa-gate";
import { sendManualReply, settingsFromForm } from "@/lib/wa-reply";
import { statusUpdates, WhatsAppSendError, type MetaTemplateRef, type SendContext, type SendResult, type WhatsAppSender } from "@/lib/whatsapp";

const BUYER = "+919876543210";
const OTHER = "+919811122233";
const CHETAN = "+919999988888";

/** Stands in for Meta: records what reached it and hands back a message id. */
class FakeMeta implements WhatsAppSender {
  readonly live = true;
  calls: { to: string; text?: string; template?: string; ctx?: SendContext }[] = [];
  fail: string | null = null;
  failKind: "rejected" | "uncertain" = "rejected";
  /** Milliseconds Meta takes to answer, to let two requests overlap. */
  delay = 0;
  /** What the log said about this message at the moment Meta was called. */
  logAtCall: string[] = [];
  onCall?: () => Promise<void>;
  async sendText(to: string, text: string, ctx?: SendContext): Promise<SendResult> {
    return this.go({ to, text, ctx });
  }
  async sendTemplate(to: string, t: MetaTemplateRef, ctx?: SendContext): Promise<SendResult> {
    return this.go({ to, template: t.name, ctx });
  }
  private async go(c: FakeMeta["calls"][number]): Promise<SendResult> {
    await this.onCall?.();
    if (this.delay) await new Promise((r) => setTimeout(r, this.delay));
    if (this.fail) throw new WhatsAppSendError(this.failKind, this.fail);
    this.calls.push(c);
    return { status: "sent", wamid: `wamid.out.${this.calls.length}` };
  }
}

let store: MemoryStore;
let meta: FakeMeta;
let gated: GatedSender;
let problems: string[];

const settings = (patch: Partial<WhatsAppSettings>) => store.updateWhatsAppSettings(patch);
const allOn = () => settings({ outbound_enabled: true, automation_enabled: true, test_mode: false });

beforeEach(async () => {
  store = new MemoryStore();
  meta = new FakeMeta();
  problems = [];
  gated = new GatedSender(meta, store, { chetanPhone: CHETAN, onProblem: async (m, p) => void problems.push(`${p}:${m.id}`) });
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
    const { lead } = await captureLead(store, { source: "meta", phone, name: "Ravi" });
    return allowed ? store.updateLead(lead.id, { wa_auto_allowed: true }) : lead;
  }

  it("with the default switches, nothing reaches Meta and the attempt is logged", async () => {
    const l = await lead(true);
    const r = await gated.sendText(BUYER, "Hi", { leadId: l.id, sendKey: "t:1" });
    expect(r).toMatchObject({ status: "blocked", error: BLOCK.off });
    expect(meta.calls).toHaveLength(0);
    expect(await store.listWaMessages(l.id)).toMatchObject([{ status: "blocked", direction: "out", error: BLOCK.off }]);
  });

  it("credentials plus switches on still send nothing automatic to a lead not allowed", async () => {
    await allOn();
    const l = await lead(false);
    expect((await gated.sendText(BUYER, "Hi", { leadId: l.id, automated: true, sendKey: "t:1" })).status).toBe("blocked");
    expect(await canAutomate(store, l)).toBe(false);
    expect(meta.calls).toHaveLength(0);
  });

  it("sends when every switch allows it and logs Meta's message id", async () => {
    await allOn();
    const l = await lead(true);
    const r = await gated.sendText(BUYER, "Hi", { leadId: l.id, automated: true, sendKey: "t:1" });
    expect(r).toMatchObject({ status: "sent", wamid: "wamid.out.1" });
    expect(await store.leadsContactedOnWhatsApp([l.id])).toEqual(new Set([l.id]));
  });

  it("lets an alert to Chetan through with only sending on", async () => {
    await settings({ outbound_enabled: true });
    expect((await gated.sendText(CHETAN, "New hot lead", { sendKey: "alert:t" })).status).toBe("sent");
    expect(meta.calls.map((c) => c.to)).toEqual([CHETAN]);
  });

  it("sends a form's message once, however many times it is submitted", async () => {
    await settings({ outbound_enabled: true, test_numbers: [BUYER] });
    const l = await lead(false);
    const ctx = { leadId: l.id, automated: false, actor: "chetan" as const, sendKey: "ref-1" };
    const first = await gated.sendText(BUYER, "Hello", ctx);
    const again = await gated.sendText(BUYER, "Hello", ctx);
    expect(first.duplicate).toBeUndefined();
    expect(again).toMatchObject({ duplicate: true, status: "sent" });
    expect(meta.calls).toHaveLength(1);
  });

  it("logs a refusal as failed, does not retry, and reports it", async () => {
    await allOn();
    const l = await lead(true);
    meta.fail = "WhatsApp refused it (400): bad number";
    const r = await gated.sendText(BUYER, "Hi", { leadId: l.id, sendKey: "t:1" });
    expect(r.status).toBe("failed");
    expect(meta.calls).toHaveLength(0);
    expect(await store.listWaMessages(l.id)).toMatchObject([{ status: "failed", error: meta.fail }]);
    expect(problems).toEqual([`failed:${(await store.listWaMessages(l.id))[0].id}`]);
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
    const { lead } = await captureLead(store, { source: "meta", phone: BUYER });
    await store.updateLead(lead.id, { wa_auto_allowed: true });
    const r = await gated.sendText(BUYER, "Hi", { leadId: lead.id, sendKey: "t:1" });
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
    const r = await sendManualReply(store, cfg(), { leadId: l.id, body: "Hi", sendKey: "a" }, NOW);
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/24 hours/) });
    expect(await store.listWaMessages(l.id)).toHaveLength(0);
  });

  it("refuses an empty message", async () => {
    const l = await leadWhoWrote(1);
    expect(await sendManualReply(store, cfg(), { leadId: l.id, body: "   ", sendKey: "a" }, NOW)).toMatchObject({ ok: false });
  });

  it("says why when sending is switched off", async () => {
    const l = await leadWhoWrote(1);
    const r = await sendManualReply(store, cfg(), { leadId: l.id, body: "Hi", sendKey: "a" }, NOW);
    expect(r).toMatchObject({ ok: false, error: `Not sent: ${BLOCK.off}` });
    expect(meta.calls).toHaveLength(0);
  });

  it("sends with automation off and the lead not allowed, logs it on the card, and only once", async () => {
    await settings({ outbound_enabled: true, test_numbers: [BUYER] });
    const l = await leadWhoWrote(1);
    const input = { leadId: l.id, body: "Sharing the brochure now", sendKey: "ref-9" };
    expect(await sendManualReply(store, cfg(), input, NOW)).toMatchObject({ ok: true, result: { status: "sent" } });
    expect(await sendManualReply(store, cfg(), input, NOW)).toMatchObject({ ok: true, result: { duplicate: true } });
    expect(meta.calls).toHaveLength(1);
    expect(meta.calls[0].ctx).toMatchObject({ automated: false, actor: "chetan" });
    const events = await store.listEvents(l.id);
    expect(events.filter((e) => e.kind === "message_out").map((e) => e.body)).toEqual(["Chetan: Sharing the brochure now"]);
  });

  it("a resubmitted blocked reply is reported as not sent, never as sent", async () => {
    const l = await leadWhoWrote(1);
    const input = { leadId: l.id, body: "Hi", sendKey: "same" };
    await sendManualReply(store, cfg(), input, NOW);
    expect(await sendManualReply(store, cfg(), input, NOW)).toMatchObject({ ok: false, error: `Not sent: ${BLOCK.off}` });
  });

  it("in test mode cannot reach a number off the list", async () => {
    await settings({ outbound_enabled: true, test_numbers: [OTHER] });
    const l = await leadWhoWrote(1);
    expect(await sendManualReply(store, cfg(), { leadId: l.id, body: "Hi", sendKey: "b" }, NOW)).toMatchObject({
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

describe("review fixes: one submission can never reach Meta twice", () => {
  const NOW = new Date();
  const cfg = (): CatcherConfig => ({ sender: gated, chetanPhone: CHETAN, openerTemplate: null, alertTemplate: null });

  async function openLead() {
    await settings({ outbound_enabled: true, test_numbers: [BUYER] });
    const { lead } = await captureLead(store, { source: "meta", phone: BUYER, name: "Ravi" });
    return store.updateLead(lead.id, { last_inbound_at: new Date(NOW.getTime() - 3600_000).toISOString() });
  }

  it("reserves the message in the log before Meta is called", async () => {
    const l = await openLead();
    meta.onCall = async () => {
      meta.logAtCall.push(...(await store.listWaMessages(l.id)).map((m) => m.status));
    };
    await sendManualReply(store, cfg(), { leadId: l.id, body: "Hi", sendKey: "r1" }, NOW);
    expect(meta.logAtCall).toEqual(["sending"]);
    expect((await store.listWaMessages(l.id)).map((m) => m.status)).toEqual(["sent"]);
  });

  it("two simultaneous submissions of the same form call Meta once", async () => {
    const l = await openLead();
    meta.delay = 30;
    const input = { leadId: l.id, body: "Brochure attached", sendKey: "same-click" };
    const results = await Promise.all([1, 2, 3].map(() => sendManualReply(store, cfg(), input, NOW)));
    expect(meta.calls).toHaveLength(1);
    expect(results.filter((r) => r.ok && !r.result.duplicate)).toHaveLength(1);
    expect(results.filter((r) => r.ok && r.result.duplicate && r.result.status === "sending")).toHaveLength(2);
    expect(await store.listWaMessages(l.id)).toHaveLength(1);
    // Only the one real send is written on the card.
    expect((await store.listEvents(l.id)).filter((e) => e.kind === "message_out")).toHaveLength(1);
  });

  it("a different form submission is a separate message", async () => {
    const l = await openLead();
    await sendManualReply(store, cfg(), { leadId: l.id, body: "One", sendKey: "a" }, NOW);
    await sendManualReply(store, cfg(), { leadId: l.id, body: "Two", sendKey: "b" }, NOW);
    expect(meta.calls).toHaveLength(2);
  });
});

describe("review fixes: accepted by Meta, then failed", () => {
  const receipt = (id: string, status: string, errors?: unknown[]) => ({
    entry: [{ changes: [{ field: "messages", value: { statuses: [{ id, status, timestamp: "1767225600", recipient_id: "919876543210", errors }] } }] }],
  });

  it("flags the lead, alerts Chetan once, pauses automation for the lead, and resends nothing", async () => {
    await allOn();
    const cfg: CatcherConfig = { sender: gated, chetanPhone: CHETAN, openerTemplate: null, alertTemplate: null, canAutomate: (l) => canAutomate(store, l) };
    const { lead } = await captureLead(store, { source: "meta", phone: BUYER, name: "Ravi" });
    await store.updateLead(lead.id, { wa_auto_allowed: true });
    const sent = await gated.sendText(BUYER, "Hi Ravi", { leadId: lead.id, sendKey: "t:1" });
    expect(sent.status).toBe("sent");
    const toBuyer = () => meta.calls.filter((c) => c.to === BUYER).length;
    const toChetan = () => meta.calls.filter((c) => c.to === CHETAN).length;
    expect([toBuyer(), toChetan()]).toEqual([1, 0]);

    const [failed] = statusUpdates(receipt(sent.wamid!, "failed", [{ code: 131026, title: "Message undeliverable" }]));
    await handleReceipt(store, cfg, failed);
    // Meta sometimes repeats a webhook: the second copy changes nothing.
    await handleReceipt(store, cfg, failed);

    const after = (await store.getLead(lead.id))!;
    expect(after.needs_chetan).toBe(true);
    expect(after.needs_chetan_reason).toMatch(/failed to deliver/);
    expect((await store.listEvents(lead.id)).filter((e) => e.kind === "flag" && /failed/.test(e.body))).toHaveLength(1);
    expect(toChetan()).toBe(1);
    expect(toBuyer()).toBe(1);
    expect((await store.findWaMessage({ wamid: sent.wamid! }))!.status).toBe("failed");

    // The flag pauses the Follow-up Clock and the bot for this lead until Chetan clears it.
    await store.updateLead(lead.id, { next_follow_up_at: new Date(Date.now() - 3600_000).toISOString() });
    await runFollowUpClock(store, cfg, new Date("2026-11-04T06:00:00Z"));
    await handleInbound(store, cfg, { id: "wamid.in.after", from: BUYER, name: "Ravi", text: "hello?", timestamp: new Date().toISOString(), kind: "text" });
    expect(toBuyer()).toBe(1);
  });
});

describe("review fixes: the existing leads stay out of automation", () => {
  it("94 leads from before the migration get nothing with every switch on, even when they enquire again", async () => {
    await allOn();
    const cfg: CatcherConfig = { sender: gated, chetanPhone: CHETAN, openerTemplate: null, alertTemplate: null, canAutomate: (l) => canAutomate(store, l) };
    const phones = Array.from({ length: 94 }, (_, i) => `+9198${String(10000000 + i).padStart(8, "0")}`);
    // As after the migration: every existing row has wa_auto_allowed = false.
    for (const phone of phones) await captureLead(store, { source: "other", phone, name: "Old lead" });
    // Some come back in through a Meta form and through WhatsApp.
    for (const phone of phones.slice(0, 5)) await captureLead(store, { source: "meta", phone });
    for (const [i, phone] of phones.slice(5, 10).entries()) {
      await handleInbound(store, cfg, { id: `wamid.old.${i}`, from: phone, name: "Old lead", text: "Hi, still looking", timestamp: new Date().toISOString(), kind: "text" });
    }
    for (const phone of phones) {
      const l = (await store.findLeadByPhone(phone))!;
      expect(l.wa_auto_allowed).toBe(false);
      expect(await canAutomate(store, l)).toBe(false);
      await store.updateLead(l.id, { next_follow_up_at: new Date(Date.now() - 3600_000).toISOString() });
    }
    await runFollowUpClock(store, cfg, new Date("2026-11-04T06:00:00Z"));
    // The only messages are alerts to Chetan about the five who wrote in.
    expect(meta.calls.filter((c) => c.to !== CHETAN)).toHaveLength(0);
    expect(meta.calls.filter((c) => c.to === CHETAN)).toHaveLength(5);
  });
});

describe("review fixes: the migration", () => {
  const sql = readFileSync("supabase/migrations/0010_whatsapp_readiness.sql", "utf8").replace(/--.*$/gm, "");

  it("only adds: no update, delete, drop or truncate of existing data", () => {
    // "on delete set null" is the foreign-key rule for a lead deleted later, not a delete now.
    expect(sql.replace(/on delete set null/g, "")).not.toMatch(/\b(update|delete|drop|truncate)\b/i);
    expect(sql).toMatch(/add column wa_auto_allowed boolean not null default false/);
  });

  it("locks the new tables to the server", () => {
    for (const t of ["wa_messages", "whatsapp_settings"]) {
      expect(sql).toContain(`alter table ${t} enable row level security;`);
      expect(sql).toContain(`revoke all on table ${t} from anon, authenticated;`);
      expect(sql).not.toMatch(new RegExp(`create policy[^;]*on ${t}`, "i"));
    }
  });

  it("allows every status the code writes", () => {
    for (const s of ["received", "sending", "blocked", "dry_run", "sent", "delivered", "read", "failed", "uncertain"]) expect(sql).toContain(`'${s}'`);
  });
});
