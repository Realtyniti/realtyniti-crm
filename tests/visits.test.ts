import { beforeEach, describe, expect, it } from "vitest";
import { buildBoard, reasonGroup } from "@/lib/board";
import { handleInbound, type CatcherConfig } from "@/lib/catcher";
import { importLeads, parseCsv } from "@/lib/import";
import { captureLead, closeLead, LeadError, saveTemplate } from "@/lib/leads";
import { MemoryStore } from "@/lib/store/memory";
import { bookableSlots, bookingToken, bookVisit, sendDueReminders, verifyBookingToken } from "@/lib/visits";
import { DryRunSender } from "@/lib/whatsapp";

let store: MemoryStore;
let sender: DryRunSender;
let cfg: CatcherConfig;
const BUYER = "+919876543210";
const CHETAN = "+919999988888";
const H = 3600_000;

async function slot(startsInHours: number, capacity = 1, area = "Yamuna Expressway", now = Date.now()) {
  const start = new Date(now + startsInHours * H);
  return store.insertSlot({
    starts_at: start.toISOString(),
    ends_at: new Date(start.getTime() + H).toISOString(),
    area,
    address: "Sales office",
    map_url: "https://maps.app.goo.gl/abc",
    capacity,
    is_open: true,
  });
}

async function chattyLead() {
  // A buyer who messaged recently, so free-text WhatsApp is allowed.
  await handleInbound(store, cfg, { id: "w1", from: BUYER, name: "Ravi", text: "Hi", timestamp: new Date().toISOString() });
  return (await store.findLeadByPhone(BUYER))!;
}

beforeEach(async () => {
  store = new MemoryStore();
  sender = new DryRunSender();
  cfg = { sender, chetanPhone: CHETAN, openerTemplate: null, alertTemplate: null, bookingUrl: (id) => `https://x/book/${id}` };
  for (const t of await store.listTemplates()) await saveTemplate(store, t.key, t.body, true);
});

describe("booking links", () => {
  it("only genuine tokens open the booker", () => {
    const t = bookingToken("lead-1", "s3cret");
    expect(verifyBookingToken(t, "s3cret")).toBe("lead-1");
    expect(verifyBookingToken(t, "other")).toBeNull();
    expect(verifyBookingToken("lead-2." + t.split(".")[1], "s3cret")).toBeNull();
  });
});

describe("Site Visit Booker", () => {
  it("only offers open, future slots with space, at least 2 hours ahead", async () => {
    const soon = await slot(1);
    const ok = await slot(30);
    const closed = await slot(48);
    await store.updateSlot(closed.id, { is_open: false });
    const ids = (await bookableSlots(store)).map((s) => s.id);
    expect(ids).toEqual([ok.id]);
    expect(ids).not.toContain(soon.id);
  });

  it("books, confirms on WhatsApp, alerts Chetan, and fills the slot", async () => {
    const lead = await chattyLead();
    const s = await slot(30);
    await bookVisit(store, cfg, lead.id, { slotId: s.id, pickup: "Pari Chowk", people: 3 });

    const updated = (await store.getLead(lead.id))!;
    expect(updated.status).toBe("site_visit");
    expect(updated.agreed_site_visit).toBe(true);
    expect(sender.sent.find((m) => m.to === BUYER && /confirmed/.test(m.text ?? ""))?.text).toMatch(/Yamuna Expressway/);
    expect(sender.sent.find((m) => m.to === CHETAN)?.text).toMatch(/Visit booked: Ravi.*3 ppl, pickup Pari Chowk/);
    expect(await bookableSlots(store)).toHaveLength(0);
  });

  it("rebooking moves the visit and frees the old slot", async () => {
    const lead = await chattyLead();
    const a = await slot(30);
    const b = await slot(50);
    await bookVisit(store, cfg, lead.id, { slotId: a.id });
    const r = await bookVisit(store, cfg, lead.id, { slotId: b.id });
    expect(r.rescheduled).toBe(true);
    expect((await store.listVisits({ leadId: lead.id, status: "booked" })).map((v) => v.slot_id)).toEqual([b.id]);
    expect((await bookableSlots(store)).map((s) => s.id)).toEqual([a.id]);
  });

  it("refuses a full slot", async () => {
    const lead = await chattyLead();
    const other = await captureLead(store, { source: "website", phone: "9811122233" });
    const s = await slot(30);
    await bookVisit(store, cfg, other.lead.id, { slotId: s.id });
    await expect(bookVisit(store, cfg, lead.id, { slotId: s.id })).rejects.toThrow(LeadError);
  });

  it("hot leads get the booking link", async () => {
    const msgs = ["Hi", "55 lakh", "Greater Noida West", "2bhk", "own use", "within 1 month", "yes"];
    for (const [i, text] of msgs.entries()) {
      await handleInbound(store, cfg, { id: `m${i}`, from: BUYER, name: "Ravi", text, timestamp: new Date().toISOString() });
    }
    const lead = (await store.findLeadByPhone(BUYER))!;
    expect(sender.sent.filter((m) => m.to === BUYER).at(-1)?.text).toBe(
      `Great, Ravi! Pick a day and time that suits you for the site visit here: https://x/book/${lead.id}`,
    );
  });
});

describe("reminders", () => {
  it("sends the 2-hour reminder once", async () => {
    const lead = await chattyLead();
    const now = Date.now();
    const s = await slot(3, 1, "Noida", now);
    await bookVisit(store, cfg, lead.id, { slotId: s.id }, new Date(now));
    const later = new Date(now + 1.5 * H);
    expect(await sendDueReminders(store, cfg, later)).toBe(1);
    expect(await sendDueReminders(store, cfg, later)).toBe(0);
    expect(sender.sent.filter((m) => m.to === BUYER).at(-1)?.text).toMatch(/in about two hours/);
  });

  it("sends the evening-before reminder after 6 PM IST", async () => {
    const lead = await chattyLead();
    const evening = new Date("2026-11-06T13:00:00Z"); // 6:30 PM IST, Friday
    const s = await store.insertSlot({
      starts_at: "2026-11-07T05:30:00Z", // 11 AM IST Saturday
      ends_at: "2026-11-07T06:30:00Z",
      area: "Yamuna Expressway",
      address: null,
      map_url: null,
      capacity: 1,
      is_open: true,
    });
    await bookVisit(store, cfg, lead.id, { slotId: s.id }, new Date("2026-11-06T10:00:00Z"));
    await store.updateLead(lead.id, { last_inbound_at: evening.toISOString() });
    expect(await sendDueReminders(store, cfg, new Date("2026-11-06T11:00:00Z"))).toBe(0); // 4:30 PM IST
    expect(await sendDueReminders(store, cfg, evening)).toBe(1);
    expect(sender.sent.filter((m) => m.to === BUYER).at(-1)?.text).toMatch(/visit tomorrow/);
  });
});

describe("Pipeline Board", () => {
  it("puts soonest deciders first and groups lost reasons", async () => {
    const past = new Date(Date.now() - 1000);
    const a = await captureLead(store, { source: "meta", phone: "9811111111", timeline_months: 12 }, past);
    const b = await captureLead(store, { source: "website", phone: "9822222222", timeline_months: 1 }, past);
    for (const l of [a.lead, b.lead]) await store.updateLead(l.id, { next_follow_up_at: past.toISOString() });
    const c = await captureLead(store, { source: "meta", phone: "9833333333" });
    const d = await captureLead(store, { source: "meta", phone: "9844444444" });
    await closeLead(store, c.lead.id, "lost", "Budget too low");
    await closeLead(store, d.lead.id, "lost", "budget is less");

    const board = buildBoard(await store.listLeads(), []);
    expect(board.dueToday.map((l) => l.phone)).toEqual(["+919822222222", "+919811111111"]);
    expect(board.lostByReason).toEqual([{ reason: "Budget / price", leads: expect.any(Array) }]);
    expect(board.lostByReason[0].leads).toHaveLength(2);
    expect(board.sources.find((s) => s.source === "meta")).toMatchObject({ leads: 3, lost: 2 });
  });

  it("reason groups", () => {
    expect(reasonGroup("Bought from another broker")).toBe("Bought elsewhere");
    expect(reasonGroup("not replying")).toBe("Stopped responding");
    expect(reasonGroup("wants a villa")).toBe("Wants a villa");
  });
});

describe("import", () => {
  it("parses quoted CSV and tab-separated paste", () => {
    expect(parseCsv('a,b\n"x, y","say ""hi"""\n')).toEqual([["a", "b"], ["x, y", 'say "hi"']]);
    expect(parseCsv("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("imports, merges duplicates, and requires a lost reason", async () => {
    const csv = [
      "Name,Mobile No,Source,Budget,Location,Property,Timeline,Status,Lost reason,Remarks",
      "Ravi,98765 43210,Facebook,55 lakh,Greater Noida West,2 BHK,2 months,,,wants ready to move",
      "Ravi K,+919876543210,Insta,,,,,,,second enquiry",
      "Anjali,9811122233,Website,,,,,Lost,Bought elsewhere,",
      "Mohit,9922233344,YT,,,,,lost,,",
      "Bad,12345,,,,,,,,",
    ].join("\n");
    const r = await importLeads(store, csv, "other");
    expect(r).toMatchObject({ created: 3, merged: 1, closed: 1 });
    expect(r.errors).toHaveLength(2);
    const ravi = (await store.findLeadByPhone(BUYER))!;
    expect(ravi).toMatchObject({ first_source: "meta", budget_max_inr: 5_500_000, property_type: "2BHK", timeline_months: 2 });
    expect((await store.findLeadByPhone("+919922233344"))!.status).not.toBe("lost");
    expect(sender.sent).toHaveLength(0); // imports never message anyone
  });
});
