import { beforeEach, describe, expect, it } from "vitest";
import { handleInbound, type CatcherConfig } from "@/lib/catcher";
import { buildChannelBoard, periodStart } from "@/lib/channels";
import { markFollowedUp, runFollowUpClock } from "@/lib/followup-clock";
import { captureLead, saveTemplate } from "@/lib/leads";
import { clientSummary, comparisonNote, developerConfirmation, freshness, offersExpiring } from "@/lib/projects";
import { MemoryStore } from "@/lib/store/memory";
import type { Project } from "@/lib/types";
import { DryRunSender } from "@/lib/whatsapp";

let store: MemoryStore;
let sender: DryRunSender;
let cfg: CatcherConfig;
const BUYER = "+919876543210";
// 11:30 AM IST on a weekday.
const NOON = new Date("2026-11-04T06:00:00Z");

beforeEach(async () => {
  store = new MemoryStore();
  sender = new DryRunSender();
  cfg = { sender, chetanPhone: "+919999988888", openerTemplate: null, alertTemplate: null };
  for (const t of await store.listTemplates()) await saveTemplate(store, t.key, t.body, true);
});

async function dueLead(opts: { inboundHoursAgo?: number } = {}) {
  const { lead } = await captureLead(store, { source: "meta", phone: BUYER, name: "Ravi", micro_market: "Noida", budget_max_inr: 5e6, timeline_months: 4 });
  return store.updateLead(lead.id, {
    next_follow_up_at: new Date(NOON.getTime() - 3600_000).toISOString(),
    last_inbound_at: opts.inboundHoursAgo != null ? new Date(NOON.getTime() - opts.inboundHoursAgo * 3600_000).toISOString() : null,
  });
}

describe("Follow-up Clock", () => {
  it("sends the approved follow-up on the due date and sets the next one", async () => {
    const lead = await dueLead({ inboundHoursAgo: 5 });
    const r = await runFollowUpClock(store, cfg, NOON);
    expect(r.sent).toBe(1);
    expect(sender.sent[0].text).toMatch(/any new thoughts on your search in Noida/);
    const after = (await store.getLead(lead.id))!;
    expect(after.followups_unanswered).toBe(1);
    expect(after.next_follow_up_at! > NOON.toISOString()).toBe(true);
  });

  it("does not send at night", async () => {
    await dueLead({ inboundHoursAgo: 5 });
    const night = new Date("2026-11-04T17:00:00Z"); // 10:30 PM IST
    expect((await runFollowUpClock(store, cfg, night)).sent).toBe(0);
  });

  it("outside the 24h window it uses the Meta template, or leaves it for Chetan", async () => {
    await dueLead();
    expect(await runFollowUpClock(store, cfg, NOON)).toMatchObject({ sent: 0, leftForChetan: 1 });
    cfg.followupTemplate = { name: "realtyniti_followup", language: "en" };
    expect((await runFollowUpClock(store, cfg, NOON)).sent).toBe(1);
    expect(sender.sent[0].template?.name).toBe("realtyniti_followup");
  });

  it("stops and flags Chetan after two unanswered follow-ups", async () => {
    const lead = await dueLead({ inboundHoursAgo: 5 });
    await store.updateLead(lead.id, { followups_unanswered: 2 });
    const r = await runFollowUpClock(store, cfg, NOON);
    expect(r).toMatchObject({ sent: 0, flagged: 1 });
    expect((await store.getLead(lead.id))!.needs_chetan_reason).toMatch(/Gone quiet/);
  });

  it("never follows up once money has come up", async () => {
    const lead = await dueLead({ inboundHoursAgo: 5 });
    await store.updateLead(lead.id, { needs_chetan: true, needs_chetan_reason: "Asked about price" });
    expect((await runFollowUpClock(store, cfg, NOON)).sent).toBe(0);
  });

  it("a reply from the buyer resets the count", async () => {
    const lead = await dueLead({ inboundHoursAgo: 5 });
    await store.updateLead(lead.id, { followups_unanswered: 1, first_reply_at: NOON.toISOString(), status: "qualified" });
    await handleInbound(store, cfg, { id: "w9", from: BUYER, name: "Ravi", text: "Hello, still looking", timestamp: new Date().toISOString() });
    expect((await store.getLead(lead.id))!.followups_unanswered).toBe(0);
  });

  it("Chetan marking a follow-up resets the clock", async () => {
    const lead = await dueLead();
    await store.updateLead(lead.id, { followups_unanswered: 2 });
    const after = (await markFollowedUp(store, lead.id, "Called, visiting Sunday", NOON))!;
    expect(after.followups_unanswered).toBe(0);
    expect(after.next_follow_up_at! > NOON.toISOString()).toBe(true);
  });
});

const project = (over: Partial<Project> = {}): Project => ({
  id: "p1",
  name: "Skyline Greens",
  developer: "ACE Group",
  micro_market: "Yamuna Expressway",
  sector: "Sector 22D",
  rera_number: "UPRERAPRJ1234",
  configurations: "2BHK 1050 sqft, 3BHK 1450 sqft",
  price_min_inr: 8_000_000,
  price_max_inr: 12_000_000,
  plc: null,
  payment_plan: "30:70",
  possession: "Dec 2027",
  offers: "No GST till Diwali",
  offer_valid_until: "2026-11-08",
  amenities: "Clubhouse, pool",
  availability: "limited",
  developer_contact_name: "Amit Verma",
  developer_contact_phone: "9810000000",
  last_confirmed_at: "2026-10-30T10:00:00Z",
  confirmed_by: "Amit",
  notes: null,
  created_at: "",
  updated_at: "",
  ...over,
});

describe("Project Sheet", () => {
  it("freshness colours", () => {
    expect(freshness(project(), NOON)).toBe("green");
    expect(freshness(project({ last_confirmed_at: "2026-10-10T00:00:00Z" }), NOON)).toBe("amber");
    expect(freshness(project({ last_confirmed_at: "2026-09-01T00:00:00Z" }), NOON)).toBe("red");
    expect(freshness(project({ last_confirmed_at: null }), NOON)).toBe("red");
  });

  it("client summary shows the confirmation date beside every figure", () => {
    const s = clientSummary(project());
    expect(s).toMatch(/Price: ₹80 L – ₹1\.2 Cr \(confirmed 30 Oct\)/);
    expect(s).toMatch(/Offer: No GST till Diwali, valid till 8 Nov \(confirmed 30 Oct\)/);
  });

  it("developer confirmation asks only for the figures that go stale", () => {
    const m = developerConfirmation(project());
    expect(m).toMatch(/^Hi Amit, Chetan from Realtyniti here\./);
    expect(m).toMatch(/1\. Current price range \(I have: ₹80 L – ₹1\.2 Cr\)/);
    expect(m).not.toMatch(/Clubhouse/);
  });

  it("comparison and expiring offers", () => {
    const note = comparisonNote([project(), project({ id: "p2", name: "Urban Nest", offers: null })]);
    expect(note).toMatch(/Skyline Greens vs Urban Nest/);
    expect(note).toMatch(/Urban Nest: not recorded/);
    expect(offersExpiring([project()], 7, NOON).map((p) => p.id)).toEqual(["p1"]);
    expect(offersExpiring([project()], 2, NOON)).toEqual([]);
  });
});

describe("Channel Board", () => {
  it("counts by channel and shows rupees per qualified lead and per visit", async () => {
    const now = new Date();
    const a = await captureLead(store, { source: "meta", phone: "9811111111", micro_market: "Noida" });
    await captureLead(store, { source: "meta", phone: "9822222222" });
    await captureLead(store, { source: "website", phone: "9833333333", micro_market: "Noida" });
    const visits = [
      { id: "v", lead_id: a.lead.id, slot_id: "s", project_interest: null, pickup: null, people: 1, status: "booked" as const, reminder_2h_sent_at: null, reminder_evening_sent_at: null, created_at: now.toISOString() },
    ];
    const month = `${now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }).slice(0, 7)}-01`;
    const rows = buildChannelBoard(await store.listLeads(), visits, [{ source: "meta", month, amount_inr: 20000 }], "month", now);
    expect(rows.find((r) => r.source === "meta")).toMatchObject({ enquiries: 2, qualified: 1, visits: 1, spend: 20000, perQualified: 20000, perVisit: 20000 });
    expect(rows.find((r) => r.source === "website")).toMatchObject({ enquiries: 1, spend: null, perQualified: null });
  });

  it("weeks start on Monday in India time", () => {
    // Wednesday 4 Nov 2026 → Monday 2 Nov 00:00 IST = 1 Nov 18:30 UTC
    expect(periodStart("week", NOON).toISOString()).toBe("2026-11-01T18:30:00.000Z");
    expect(periodStart("month", NOON).toISOString()).toBe("2026-10-31T18:30:00.000Z");
  });
});
