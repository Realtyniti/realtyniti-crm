import { beforeEach, describe, expect, it } from "vitest";
import { handleReceipt, reportSendProblem, type CatcherConfig } from "@/lib/catcher";
import { captureLead, saveTemplate } from "@/lib/leads";
import { MemoryStore } from "@/lib/store/memory";
import type { Lead, SiteVisit } from "@/lib/types";
import { bookVisit, sendDueReminders } from "@/lib/visits";
import { applyStatus, canAutomate, GatedSender } from "@/lib/wa-gate";
import { setAutoWhatsApp } from "@/lib/wa-reply";
import {
  statusUpdates,
  WhatsAppSendError,
  type MetaTemplateRef,
  type SendContext,
  type SendResult,
  type StatusUpdate,
  type WhatsAppSender,
} from "@/lib/whatsapp";

/*
 * Third review round: site-visit reminders are only marked done once WhatsApp accepted them, and a
 * failed message stays failed whatever receipts arrive later. Meta is faked; nothing leaves.
 */

const BUYER = "+919876543210";
const CHETAN = "+919999988888";
const H = 3600_000;

class FakeMeta implements WhatsAppSender {
  readonly live = true;
  calls: { to: string; text?: string; key?: string | null }[] = [];
  fail: { kind: "rejected" | "uncertain"; message: string } | null = null;
  delay = 10;
  async sendText(to: string, text: string, ctx?: SendContext): Promise<SendResult> {
    return this.go({ to, text, key: ctx?.sendKey });
  }
  async sendTemplate(to: string, t: MetaTemplateRef, ctx?: SendContext): Promise<SendResult> {
    return this.go({ to, text: t.name, key: ctx?.sendKey });
  }
  private async go(c: FakeMeta["calls"][number]): Promise<SendResult> {
    await new Promise((r) => setTimeout(r, this.delay));
    // Failures hit messages to the buyer; Chetan's alert about them still gets through.
    if (this.fail && c.to !== CHETAN) throw new WhatsAppSendError(this.fail.kind, this.fail.message);
    this.calls.push(c);
    return { status: "sent", wamid: `wamid.out.${this.calls.length}` };
  }
}

let store: MemoryStore;
let meta: FakeMeta;
let cfg: CatcherConfig;

const reminders = () => meta.calls.filter((c) => c.to === BUYER && /reminder_2h|reminder_evening/.test(c.key ?? ""));
const toChetan = () => meta.calls.filter((c) => c.to === CHETAN);
const flags = async (leadId: string, re: RegExp) => (await store.listEvents(leadId)).filter((e) => e.kind === "flag" && re.test(e.body));

beforeEach(async () => {
  store = new MemoryStore();
  meta = new FakeMeta();
  const sender = new GatedSender(meta, store, { chetanPhone: CHETAN, onProblem: (m, p) => reportSendProblem(store, cfg, m, p) });
  cfg = { sender, chetanPhone: CHETAN, openerTemplate: null, alertTemplate: null, canAutomate: (l) => canAutomate(store, l) };
  for (const t of await store.listTemplates()) await saveTemplate(store, t.key, t.body, true);
});

describe("site-visit reminders are marked done only after WhatsApp accepted them", () => {
  const NOW = Date.now();
  const due = new Date(NOW + 1.5 * H); // 1.5 hours before a visit 3 hours from NOW
  let lead: Lead;
  let visit: SiteVisit;

  beforeEach(async () => {
    const { lead: l } = await captureLead(store, { source: "meta", phone: BUYER, name: "Ravi" });
    await setAutoWhatsApp(store, l.id, true);
    // The buyer wrote recently, so free text is allowed when the reminder is due.
    lead = await store.updateLead(l.id, { last_inbound_at: new Date(NOW + H).toISOString() });
    const slot = await store.insertSlot({
      starts_at: new Date(NOW + 3 * H).toISOString(), ends_at: new Date(NOW + 4 * H).toISOString(),
      area: "Noida", address: "Sales office", map_url: null, capacity: 1, is_open: true,
    });
    ({ visit } = await bookVisit(store, cfg, lead.id, { slotId: slot.id }, new Date(NOW)));
  });

  const reminderDone = async () => (await store.listVisits({ leadId: lead.id })).find((v) => v.id === visit.id)!.reminder_2h_sent_at;

  it("blocked while sending is off: stays due, flagged once; sent once after sending is switched on", async () => {
    // Switches still at their defaults: everything off. (Booking already logged its own "not sent" flag.)
    const before = (await flags(lead.id, /Not sent: WhatsApp sending is switched off/)).length;
    expect(await sendDueReminders(store, cfg, due)).toBe(0);
    expect(await sendDueReminders(store, cfg, new Date(due.getTime() + 15 * 60_000))).toBe(0);
    expect(await reminderDone()).toBeNull();
    expect(reminders()).toHaveLength(0);
    expect((await flags(lead.id, /Not sent: WhatsApp sending is switched off/)).length - before).toBe(1);

    await store.updateWhatsAppSettings({ outbound_enabled: true, automation_enabled: true, test_mode: false });
    const later = new Date(due.getTime() + 30 * 60_000);
    expect(await sendDueReminders(store, cfg, later)).toBe(1);
    expect(await reminderDone()).toBe(later.toISOString());
    expect(await sendDueReminders(store, cfg, new Date(later.getTime() + 15 * 60_000))).toBe(0);
    expect(reminders()).toHaveLength(1);
  });

  it("blocked by test mode: stays due until the buyer's number is on the test list", async () => {
    await store.updateWhatsAppSettings({ outbound_enabled: true, automation_enabled: true, test_mode: true, test_numbers: [] });
    expect(await sendDueReminders(store, cfg, due)).toBe(0);
    expect(await reminderDone()).toBeNull();
    await store.updateWhatsAppSettings({ test_numbers: [BUYER] });
    expect(await sendDueReminders(store, cfg, due)).toBe(1);
    expect(reminders()).toHaveLength(1);
  });

  it("blocked while automation is off for this lead: stays due until Chetan allows the lead", async () => {
    await store.updateWhatsAppSettings({ outbound_enabled: true, automation_enabled: true, test_mode: false });
    await setAutoWhatsApp(store, lead.id, false);
    expect(await sendDueReminders(store, cfg, due)).toBe(0);
    await setAutoWhatsApp(store, lead.id, true);
    expect(await sendDueReminders(store, cfg, due)).toBe(1);
    expect(reminders()).toHaveLength(1);
  });

  for (const kind of ["rejected", "uncertain"] as const) {
    it(`${kind === "rejected" ? "refused" : "unconfirmed"} by WhatsApp: flagged for review once and never resent`, async () => {
      await store.updateWhatsAppSettings({ outbound_enabled: true, automation_enabled: true, test_mode: false });
      meta.fail = { kind, message: kind === "rejected" ? "WhatsApp refused it (400): bad" : "No answer from WhatsApp (timed out)" };
      expect(await sendDueReminders(store, cfg, due)).toBe(0);
      meta.fail = null;
      // Later runs, with WhatsApp working again: still nothing is resent.
      for (const mins of [15, 30, 45]) await sendDueReminders(store, cfg, new Date(due.getTime() + mins * 60_000));
      expect(reminders()).toHaveLength(0);
      expect(await reminderDone()).toBeNull();
      const l = (await store.getLead(lead.id))!;
      expect(l.needs_chetan).toBe(true);
      expect(await flags(lead.id, kind === "rejected" ? /refused/ : /did not confirm/)).toHaveLength(1);
      expect(toChetan().filter((c) => /visit/.test(c.key ?? "") || /problem/.test(c.key ?? ""))).toHaveLength(1);
    });
  }

  it("two overlapping runs: one reminder, marked done", async () => {
    await store.updateWhatsAppSettings({ outbound_enabled: true, automation_enabled: true, test_mode: false });
    await Promise.all([sendDueReminders(store, cfg, due), sendDueReminders(store, cfg, due), sendDueReminders(store, cfg, due)]);
    expect(reminders()).toHaveLength(1);
    expect(await reminderDone()).toBe(due.toISOString());
  });

  it("the evening reminder is also kept due while blocked and sent once enabled", async () => {
    const evening = new Date("2026-11-06T13:00:00Z"); // 6:30 PM IST
    const slot = await store.insertSlot({
      starts_at: "2026-11-07T05:30:00Z", ends_at: "2026-11-07T06:30:00Z", // 11 AM IST next day
      area: "Yamuna Expressway", address: null, map_url: null, capacity: 1, is_open: true,
    });
    const { lead: other } = await captureLead(store, { source: "meta", phone: "+919811122233", name: "Asha" });
    await setAutoWhatsApp(store, other.id, true);
    await store.updateLead(other.id, { last_inbound_at: evening.toISOString() });
    const { visit: v } = await bookVisit(store, cfg, other.id, { slotId: slot.id }, new Date("2026-11-06T10:00:00Z"));
    const done = async () => (await store.listVisits({ leadId: other.id })).find((x) => x.id === v.id)!.reminder_evening_sent_at;

    await sendDueReminders(store, cfg, evening);
    expect(await done()).toBeNull();
    await store.updateWhatsAppSettings({ outbound_enabled: true, automation_enabled: true, test_mode: false });
    const later = new Date(evening.getTime() + H);
    await sendDueReminders(store, cfg, later);
    expect(await done()).toBe(later.toISOString());
    expect(meta.calls.filter((c) => c.to === "+919811122233" && /reminder_evening/.test(c.key ?? ""))).toHaveLength(1);
  });
});

describe("a failed message stays failed", () => {
  const receipt = (wamid: string, status: string): StatusUpdate => {
    const errors = status === "failed" ? [{ code: 131026, title: "Message undeliverable" }] : undefined;
    return statusUpdates({
      entry: [{ changes: [{ field: "messages", value: { statuses: [{ id: wamid, status, timestamp: "1767225600", recipient_id: "919876543210", errors }] } }] }],
    })[0];
  };

  async function sentMessage() {
    await store.updateWhatsAppSettings({ outbound_enabled: true, automation_enabled: true, test_mode: false });
    const { lead } = await captureLead(store, { source: "meta", phone: BUYER, name: "Ravi" });
    await setAutoWhatsApp(store, lead.id, true);
    const r = await cfg.sender.sendText(BUYER, "Hi", { leadId: lead.id, sendKey: "t:1" });
    return { lead, wamid: r.wamid! };
  }

  it("delayed sent, delivered and read receipts after a failure change nothing and keep the review flag", async () => {
    const { lead, wamid } = await sentMessage();
    await handleReceipt(store, cfg, receipt(wamid, "failed"));
    for (const s of ["sent", "delivered", "read", "delivered", "failed"]) await handleReceipt(store, cfg, receipt(wamid, s));

    expect((await store.findWaMessage({ wamid }))!).toMatchObject({ status: "failed", error: "131026 · Message undeliverable" });
    const l = (await store.getLead(lead.id))!;
    expect(l.needs_chetan).toBe(true);
    expect(l.needs_chetan_reason).toMatch(/failed to deliver/);
    expect(await flags(lead.id, /failed to deliver/)).toHaveLength(1);
    expect(toChetan()).toHaveLength(1);
    expect(meta.calls.filter((c) => c.to === BUYER)).toHaveLength(1);
  });

  it("a failure after an earlier delivered receipt still counts, once", async () => {
    const { lead, wamid } = await sentMessage();
    await handleReceipt(store, cfg, receipt(wamid, "delivered"));
    await handleReceipt(store, cfg, receipt(wamid, "failed"));
    await handleReceipt(store, cfg, receipt(wamid, "read"));
    expect((await store.findWaMessage({ wamid }))!.status).toBe("failed");
    expect(await flags(lead.id, /failed to deliver/)).toHaveLength(1);
  });

  it("concurrent receipts in any order end failed, with exactly one failure reported", async () => {
    const orders = [
      ["failed", "delivered", "read", "failed"],
      ["read", "delivered", "failed", "sent"],
      ["delivered", "failed", "failed", "read"],
      ["sent", "read", "failed", "delivered"],
    ];
    for (const order of orders) {
      store = new MemoryStore();
      meta = new FakeMeta();
      const sender = new GatedSender(meta, store, { chetanPhone: CHETAN, onProblem: (m, p) => reportSendProblem(store, cfg, m, p) });
      cfg = { sender, chetanPhone: CHETAN, openerTemplate: null, alertTemplate: null, canAutomate: (l) => canAutomate(store, l) };
      const { wamid } = await sentMessage();
      const results = await Promise.all(order.map((s) => applyStatus(store, receipt(wamid, s))));
      expect((await store.findWaMessage({ wamid }))!.status, order.join(",")).toBe("failed");
      expect(results.filter((r) => r?.newlyFailed), order.join(",")).toHaveLength(1);
    }
  });

  it("concurrent duplicate deliveries of the whole webhook: one flag, one alert, status failed", async () => {
    const { lead, wamid } = await sentMessage();
    const batch = ["failed", "delivered", "read"].map((s) => receipt(wamid, s));
    await Promise.all([...batch, ...batch, ...batch].map((u) => handleReceipt(store, cfg, u)));
    expect((await store.findWaMessage({ wamid }))!.status).toBe("failed");
    expect(await flags(lead.id, /failed to deliver/)).toHaveLength(1);
    expect(toChetan()).toHaveLength(1);
    expect((await store.getLead(lead.id))!.needs_chetan).toBe(true);
  });
});
