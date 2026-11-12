import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { alertChetan, greetNewLead, handleInbound, handleReceipt, reportSendProblem, sendApproved, sweepStuckSends, STUCK_AFTER_MS, type CatcherConfig } from "@/lib/catcher";
import { runFollowUpClock } from "@/lib/followup-clock";
import { captureLead, saveTemplate } from "@/lib/leads";
import { MemoryStore } from "@/lib/store/memory";
import { LEAD_SOURCES, type Lead, type WaMessage } from "@/lib/types";
import { bookVisit, sendDueReminders } from "@/lib/visits";
import { canAutomate, GatedSender } from "@/lib/wa-gate";
import { sendManualReply, setAutoWhatsApp } from "@/lib/wa-reply";
import {
  CloudApiSender,
  statusUpdates,
  WhatsAppSendError,
  type MetaTemplateRef,
  type SendContext,
  type SendResult,
  type WhatsAppSender,
} from "@/lib/whatsapp";

/*
 * Second review round: explicit per-lead permission, race-safe keys for every automatic message,
 * and every way a send can fail. Meta is faked; nothing leaves the machine.
 */

const BUYER = "+919876543210";
const CHETAN = "+919999988888";
const H = 3600_000;
// 11:30 AM IST on a weekday, inside the Follow-up Clock's sending hours.
const NOON = new Date("2026-11-04T06:00:00Z");

/** Stands in for Meta. `delay` lets concurrent requests overlap while one is "at Meta". */
class FakeMeta implements WhatsAppSender {
  readonly live = true;
  calls: { to: string; text?: string; template?: string; key?: string | null }[] = [];
  fail: { kind: "rejected" | "uncertain"; message: string } | null = null;
  delay = 15;
  async sendText(to: string, text: string, ctx?: SendContext): Promise<SendResult> {
    return this.go({ to, text, key: ctx?.sendKey });
  }
  async sendTemplate(to: string, t: MetaTemplateRef, ctx?: SendContext): Promise<SendResult> {
    return this.go({ to, template: t.name, key: ctx?.sendKey });
  }
  private async go(c: FakeMeta["calls"][number]): Promise<SendResult> {
    await new Promise((r) => setTimeout(r, this.delay));
    // Failures hit messages to the buyer; Chetan's alert about them still gets through.
    if (this.fail && c.to !== CHETAN) throw new WhatsAppSendError(this.fail.kind, this.fail.message);
    this.calls.push(c);
    return { status: "sent", wamid: `wamid.out.${this.calls.length}` };
  }
}

/** A database whose message-log updates can be made to fail, as during an outage. */
class FlakyStore extends MemoryStore {
  failLogUpdates = false;
  override async updateWaMessage(...args: Parameters<MemoryStore["updateWaMessage"]>) {
    if (this.failLogUpdates) throw new Error("database unavailable");
    return super.updateWaMessage(...args);
  }
}

let store: FlakyStore;
let meta: FakeMeta;
let cfg: CatcherConfig;

const toBuyer = () => meta.calls.filter((c) => c.to === BUYER);
const toChetan = () => meta.calls.filter((c) => c.to === CHETAN);
const flags = async (leadId: string) => (await store.listEvents(leadId)).filter((e) => e.kind === "flag");
const allOn = () => store.updateWhatsAppSettings({ outbound_enabled: true, automation_enabled: true, test_mode: false });
const inbound = (id: string, text: string, from = BUYER) => ({ id, from, name: "Ravi", text, timestamp: new Date().toISOString(), kind: "text" as const });

async function allowedLead(extra: Partial<Lead> = {}): Promise<Lead> {
  const { lead } = await captureLead(store, { source: "meta", phone: BUYER, name: "Ravi", micro_market: "Noida", budget_max_inr: 5e6, timeline_months: 4 });
  await setAutoWhatsApp(store, lead.id, true);
  return store.updateLead(lead.id, extra);
}

beforeEach(async () => {
  store = new FlakyStore();
  meta = new FakeMeta();
  const sender = new GatedSender(meta, store, { chetanPhone: CHETAN, onProblem: (m, p) => reportSendProblem(store, cfg, m, p) });
  cfg = { sender, chetanPhone: CHETAN, openerTemplate: null, alertTemplate: null, canAutomate: (l) => canAutomate(store, l) };
  for (const t of await store.listTemplates()) await saveTemplate(store, t.key, t.body, true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("1. automatic WhatsApp needs Chetan's explicit permission", () => {
  it("every new lead starts not allowed, whatever its source", async () => {
    for (const [i, source] of LEAD_SOURCES.entries()) {
      const { lead } = await captureLead(store, { source, phone: `+9198000000${String(i).padStart(2, "0")}` });
      expect(lead.wa_auto_allowed, source).toBe(false);
    }
  });

  it("with every switch on, a new WhatsApp enquiry gets no bot reply until Chetan allows it", async () => {
    await allOn();
    const lead = await handleInbound(store, cfg, inbound("wamid.a", "Hi, 2BHK in Noida?"));
    expect(lead.wa_auto_allowed).toBe(false);
    expect(toBuyer()).toHaveLength(0);
    expect(toChetan()).toHaveLength(1);

    await setAutoWhatsApp(store, lead.id, true);
    await handleInbound(store, cfg, inbound("wamid.b", "Hello?"));
    expect(toBuyer().length).toBeGreaterThan(0);
  });

  it("a new Meta form lead is not greeted automatically", async () => {
    await allOn();
    const { lead } = await captureLead(store, { source: "meta", phone: BUYER, name: "Ravi" });
    await greetNewLead(store, { ...cfg, openerTemplate: { name: "opener", language: "en" } }, lead);
    expect(meta.calls).toHaveLength(0);
  });

  it("Chetan's own reply still works for a lead that is not allowed, with automation off", async () => {
    await store.updateWhatsAppSettings({ outbound_enabled: true, test_mode: false });
    const { lead } = await captureLead(store, { source: "meta", phone: BUYER });
    await store.updateLead(lead.id, { last_inbound_at: new Date(Date.now() - H).toISOString() });
    expect(await sendManualReply(store, cfg, { leadId: lead.id, body: "Hi Ravi", sendKey: "f1" })).toMatchObject({ ok: true });
    expect(toBuyer()).toHaveLength(1);
  });
});

describe("2. an automatic message is sent at most once, however often it is triggered", () => {
  beforeEach(allOn);

  it("refuses any message without a send key", async () => {
    await expect(cfg.sender.sendText(BUYER, "Hi", { automated: true })).rejects.toThrow(/send key/);
    expect(meta.calls).toHaveLength(0);
  });

  it("bot reply: the same inbound message processed three times at once sends each reply once", async () => {
    const lead = await allowedLead({ last_inbound_at: new Date().toISOString() });
    await Promise.all([1, 2, 3].map(() => sendApproved(store, cfg, lead, "question.budget", "in:wamid.same")));
    expect(toBuyer()).toHaveLength(1);
    expect(toBuyer()[0].key).toBe("in:wamid.same:question.budget");
  });

  it("bot reply: a repeated webhook for the same message sends nothing new", async () => {
    await allowedLead();
    const msg = inbound("wamid.dup", "Hi");
    await Promise.all([handleInbound(store, cfg, msg), handleInbound(store, cfg, msg)]);
    const keys = toBuyer().map((c) => c.key);
    expect(keys.length).toBeGreaterThan(0);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((k) => k?.startsWith("in:wamid.dup:"))).toBe(true);
  });

  it("new-lead opener: three intake deliveries at once send one opener", async () => {
    const lead = await allowedLead();
    const withOpener = { ...cfg, openerTemplate: { name: "realtyniti_opener", language: "en" } };
    await Promise.all([1, 2, 3].map(() => greetNewLead(store, withOpener, lead)));
    expect(toBuyer()).toEqual([{ to: BUYER, template: "realtyniti_opener", key: `greet:${lead.id}:opener` }]);
  });

  async function dueForFollowUp(inWindow: boolean) {
    const lead = await allowedLead({
      last_inbound_at: inWindow ? new Date(NOON.getTime() - 2 * H).toISOString() : new Date(NOON.getTime() - 48 * H).toISOString(),
      next_follow_up_at: new Date(NOON.getTime() - H).toISOString(),
    });
    // Reached on WhatsApp before, so the clock may follow up.
    await store.addWaMessage({
      lead_id: lead.id, wamid: "wamid.earlier", direction: "out", phone: BUYER, kind: "text", body: "Hi", template_name: null,
      status: "delivered", error: null, actor: "bot", automated: true, send_key: "earlier",
    });
    return lead;
  }

  it("Follow-up Clock: two overlapping runs send one follow-up (inside the 24-hour window)", async () => {
    await dueForFollowUp(true);
    const [a, b] = await Promise.all([runFollowUpClock(store, cfg, NOON), runFollowUpClock(store, cfg, NOON)]);
    expect(toBuyer()).toHaveLength(1);
    expect(a.sent + b.sent).toBe(1);
  });

  it("Follow-up Clock: two overlapping runs send one follow-up template (outside the window)", async () => {
    await dueForFollowUp(false);
    const withTemplate = { ...cfg, followupTemplate: { name: "realtyniti_followup", language: "en" } };
    const [a, b] = await Promise.all([runFollowUpClock(store, withTemplate, NOON), runFollowUpClock(store, withTemplate, NOON)]);
    expect(toBuyer().map((c) => c.template)).toEqual(["realtyniti_followup"]);
    expect(a.sent + b.sent).toBe(1);
  });

  it("site-visit reminder: two overlapping hourly runs send one reminder", async () => {
    const now = Date.now();
    const lead = await allowedLead({ last_inbound_at: new Date(now).toISOString() });
    const slot = await store.insertSlot({
      starts_at: new Date(now + 3 * H).toISOString(), ends_at: new Date(now + 4 * H).toISOString(),
      area: "Noida", address: "Sales office", map_url: null, capacity: 1, is_open: true,
    });
    await bookVisit(store, cfg, lead.id, { slotId: slot.id }, new Date(now));
    const before = toBuyer().length;
    const later = new Date(now + 1.5 * H);
    await Promise.all([sendDueReminders(store, cfg, later), sendDueReminders(store, cfg, later)]);
    expect(toBuyer().length - before).toBe(1);
    expect(toBuyer().at(-1)!.key).toMatch(/^visit:.+:visit\.reminder_2h$/);
  });

  it("alerts to Chetan: the same alert triggered twice at once is sent once", async () => {
    const lead = await allowedLead();
    await Promise.all([alertChetan(store, cfg, lead, "Hot lead", "in:wamid.x:hot"), alertChetan(store, cfg, lead, "Hot lead", "in:wamid.x:hot")]);
    expect(toChetan()).toHaveLength(1);
  });

  it("a message blocked by the switches can still go out once allowed (blocked attempts reserve nothing)", async () => {
    await store.updateWhatsAppSettings({ automation_enabled: false });
    const lead = await allowedLead({ last_inbound_at: new Date().toISOString() });
    expect(await sendApproved(store, cfg, lead, "question.budget", "in:wamid.y")).toBe(false);
    await allOn();
    expect(await sendApproved(store, cfg, lead, "question.budget", "in:wamid.y")).toBe(true);
    expect(await sendApproved(store, cfg, lead, "question.budget", "in:wamid.y")).toBe(false);
    expect(toBuyer()).toHaveLength(1);
  });
});

describe("3. every way a send can fail", () => {
  describe("how Meta's answer is classified", () => {
    const sender = new CloudApiSender("123", "token");
    const answer = (status: number, body: string) => vi.fn(async () => new Response(body, { status }));
    const attempt = () => sender.sendText(BUYER, "Hi");

    it("a 4xx answer is a certain refusal", async () => {
      for (const status of [400, 401, 429]) {
        vi.stubGlobal("fetch", answer(status, '{"error":{"message":"bad"}}'));
        await expect(attempt()).rejects.toMatchObject({ kind: "rejected" });
      }
    });

    it("a 5xx answer, a network error, a timeout or an answer without a message id are uncertain", async () => {
      vi.stubGlobal("fetch", answer(503, "unavailable"));
      await expect(attempt()).rejects.toMatchObject({ kind: "uncertain" });
      vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
      await expect(attempt()).rejects.toMatchObject({ kind: "uncertain" });
      vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new DOMException("The operation timed out.", "TimeoutError"))));
      await expect(attempt()).rejects.toMatchObject({ kind: "uncertain", message: expect.stringMatching(/timed out/) });
      vi.stubGlobal("fetch", answer(200, '{"messages":[]}'));
      await expect(attempt()).rejects.toMatchObject({ kind: "uncertain" });
      vi.stubGlobal("fetch", answer(200, "not json"));
      await expect(attempt()).rejects.toMatchObject({ kind: "uncertain" });
    });

    it("a 200 with a message id is sent", async () => {
      vi.stubGlobal("fetch", answer(200, '{"messages":[{"id":"wamid.ok"}]}'));
      expect(await attempt()).toEqual({ status: "sent", wamid: "wamid.ok" });
    });
  });

  async function expectFlaggedOnce(leadId: string, pattern: RegExp) {
    const lead = (await store.getLead(leadId))!;
    expect(lead.needs_chetan).toBe(true);
    expect(lead.needs_chetan_reason).toMatch(pattern);
    expect((await flags(leadId)).filter((f) => pattern.test(f.body))).toHaveLength(1);
    expect(toChetan()).toHaveLength(1);
  }

  it("Meta refuses an automatic message: failed, flagged for review, Chetan alerted, not retried", async () => {
    await allOn();
    const lead = await allowedLead({ last_inbound_at: new Date().toISOString() });
    meta.fail = { kind: "rejected", message: "WhatsApp refused it (400): invalid parameter" };
    expect(await sendApproved(store, cfg, lead, "question.budget", "in:wamid.r")).toBe(false);
    meta.fail = null;
    expect(await sendApproved(store, cfg, lead, "question.budget", "in:wamid.r")).toBe(false);
    expect(toBuyer()).toHaveLength(0);
    expect((await store.listWaMessages(lead.id)).filter((m) => m.direction === "out" && m.phone === BUYER).map((m) => m.status)).toEqual(["failed"]);
    await expectFlaggedOnce(lead.id, /refused/);
  });

  it("timeout on Chetan's reply: shown as unconfirmed, flagged, alerted once, and the same form cannot resend", async () => {
    await store.updateWhatsAppSettings({ outbound_enabled: true, test_mode: false });
    const lead = await allowedLead({ last_inbound_at: new Date().toISOString() });
    meta.fail = { kind: "uncertain", message: "No answer from WhatsApp (timed out)" };
    const input = { leadId: lead.id, body: "Brochure attached", sendKey: "form-1" };
    expect(await sendManualReply(store, cfg, input)).toMatchObject({ ok: false, error: expect.stringMatching(/may or may not have arrived/) });
    meta.fail = null;
    expect(await sendManualReply(store, cfg, input)).toMatchObject({ ok: false, error: expect.stringMatching(/may or may not have arrived/) });
    expect(toBuyer()).toHaveLength(0);
    const out = (await store.listWaMessages(lead.id)).filter((m) => m.direction === "out" && m.phone === BUYER);
    expect(out.map((m) => m.status)).toEqual(["uncertain"]);
    await expectFlaggedOnce(lead.id, /did not confirm/);
  });

  it("accepted, then a failed receipt delivered three times at once: one flag, one alert, nothing resent", async () => {
    await allOn();
    const lead = await allowedLead();
    const sent = await cfg.sender.sendText(BUYER, "Hi", { leadId: lead.id, sendKey: "t:1" });
    const body = {
      entry: [{ changes: [{ field: "messages", value: { statuses: [{ id: sent.wamid, status: "failed", timestamp: "1767225600", recipient_id: "919876543210", errors: [{ code: 131026, title: "Message undeliverable" }] }] } }] }],
    };
    const [u] = statusUpdates(body);
    await Promise.all([handleReceipt(store, cfg, u), handleReceipt(store, cfg, u), handleReceipt(store, cfg, u)]);
    expect(toBuyer()).toHaveLength(1);
    await expectFlaggedOnce(lead.id, /failed to deliver/);
  });

  it("accepted, but the log cannot be updated: never resent; the sweep flags it once, even when runs overlap", async () => {
    await allOn();
    const lead = await allowedLead({ last_inbound_at: new Date().toISOString() });
    store.failLogUpdates = true;
    expect(await sendApproved(store, cfg, lead, "question.budget", "in:wamid.u")).toBe(true);
    store.failLogUpdates = false;
    expect(toBuyer()).toHaveLength(1);
    const [row] = (await store.listWaMessages(lead.id)).filter((m: WaMessage) => m.phone === BUYER);
    expect(row.status).toBe("sending");
    // The same trigger again: the reservation still holds, so nothing is resent.
    expect(await sendApproved(store, cfg, lead, "question.budget", "in:wamid.u")).toBe(false);
    expect(toBuyer()).toHaveLength(1);

    expect(await sweepStuckSends(store, cfg, new Date())).toBe(0);
    const later = new Date(Date.now() + STUCK_AFTER_MS + 60_000);
    const [a, b] = await Promise.all([sweepStuckSends(store, cfg, later), sweepStuckSends(store, cfg, later)]);
    expect(a + b).toBe(1);
    expect((await store.findWaMessage({ sendKey: "in:wamid.u:question.budget" }))!.status).toBe("uncertain");
    expect(toBuyer()).toHaveLength(1);
    await expectFlaggedOnce(lead.id, /did not confirm/);
  });

  it("a flagged lead gets no further automatic messages until Chetan clears it", async () => {
    await allOn();
    const lead = await allowedLead({ last_inbound_at: new Date().toISOString() });
    meta.fail = { kind: "uncertain", message: "No answer from WhatsApp (timed out)" };
    await sendApproved(store, cfg, lead, "question.budget", "in:wamid.p");
    meta.fail = null;
    await handleInbound(store, cfg, inbound("wamid.next", "hello?"));
    expect(toBuyer()).toHaveLength(0);
  });
});
