import { beforeEach, describe, expect, it } from "vitest";
import { answerFor, greetNewLead, handleInbound, looksHinglish, type CatcherConfig } from "@/lib/catcher";
import { buildDigest } from "@/lib/digest";
import { captureLead, saveTemplate } from "@/lib/leads";
import { MemoryStore } from "@/lib/store/memory";
import { DryRunSender, inboundMessages } from "@/lib/whatsapp";

let store: MemoryStore;
let sender: DryRunSender;
let cfg: CatcherConfig;
let n = 0;
const BUYER = "+919876543210";
const CHETAN = "+919999988888";

async function approveAll() {
  for (const t of await store.listTemplates()) await saveTemplate(store, t.key, t.body, true);
}

function msg(text: string, from = BUYER) {
  n += 1;
  return { id: `wamid.${n}`, from, name: "Ravi Kumar", text, timestamp: new Date().toISOString() };
}

const toBuyer = () => sender.sent.filter((s) => s.to === BUYER).map((s) => s.text ?? s.template?.name);
const toChetan = () => sender.sent.filter((s) => s.to === CHETAN);

beforeEach(async () => {
  store = new MemoryStore();
  sender = new DryRunSender();
  cfg = { sender, chetanPhone: CHETAN, openerTemplate: null, alertTemplate: null };
  await approveAll();
});

describe("Lead Catcher conversation", () => {
  it("greets, asks the five questions one at a time, tags hot and alerts Chetan", async () => {
    await handleInbound(store, cfg, msg("Hi, saw your video on Greater Noida West"));
    expect(toBuyer()).toHaveLength(2);
    expect(toBuyer()[0]).toMatch(/^Hi Ravi, thanks for reaching out/);
    expect(toBuyer()[1]).toMatch(/budget/i);

    // Location was already in the first message? No: it is asked in order regardless of mentions.
    for (const [answer, nextAsk] of [
      ["around 55 lakh", /area/i],
      ["Greater Noida West", /2BHK, 3BHK/],
      ["2 bhk", /own use or as an investment/],
      ["own use for family", /decide/],
      ["within 2 months", /in person this weekend/],
    ] as const) {
      await handleInbound(store, cfg, msg(answer));
      expect(toBuyer().at(-1)).toMatch(nextAsk);
    }
    await handleInbound(store, cfg, msg("yes sure"));

    const lead = (await store.findLeadByPhone(BUYER))!;
    expect(lead).toMatchObject({
      budget_max_inr: 5_500_000,
      micro_market: "Greater Noida West",
      property_type: "2BHK",
      purpose: "end_use",
      timeline_months: 2,
      agreed_site_visit: true,
      temperature: "hot",
      status: "qualified",
    });
    expect(toBuyer().at(-1)).toMatch(/Chetan will call you/);
    expect(toChetan()).toHaveLength(1);
    expect(toChetan()[0].text).toMatch(/Hot lead: Ravi Kumar \+919876543210/);
  });

  it("switches to Hinglish when the buyer writes in Hinglish", async () => {
    await handleInbound(store, cfg, msg("Namaste, mujhe flat chahiye Noida mein"));
    expect(toBuyer().at(-1)).toMatch(/Aapka budget roughly/);
  });

  it("stops everything the moment money comes up, replies once and alerts Chetan", async () => {
    await handleInbound(store, cfg, msg("Hello"));
    const before = toBuyer().length;
    await handleInbound(store, cfg, msg("2bhk ka rate kya hai? koi offer?"));
    expect(toBuyer().slice(before)).toEqual([expect.stringMatching(/Chetan will personally share/)]);
    expect(toChetan()).toHaveLength(1);
    expect(toChetan()[0].text).toMatch(/Price question/);

    await handleInbound(store, cfg, msg("50 lakh"));
    expect(toBuyer().length).toBe(before + 1); // nothing more sent
    expect(toChetan()).toHaveLength(1);
  });

  it("never sends a template Chetan has not approved", async () => {
    store = new MemoryStore(); // fresh, nothing approved
    await handleInbound(store, cfg, msg("Hi"));
    expect(sender.sent).toHaveLength(0);
    const lead = (await store.findLeadByPhone(BUYER))!;
    const events = await store.listEvents(lead.id);
    expect(events.some((e) => e.kind === "flag" && /not approved/.test(e.body))).toBe(true);
  });

  it("ignores a webhook delivered twice", async () => {
    const m = msg("Hi");
    await handleInbound(store, cfg, m);
    const count = sender.sent.length;
    await handleInbound(store, cfg, m);
    expect(sender.sent.length).toBe(count);
  });

  it("an unclear answer is not stored, and the next question follows", async () => {
    await handleInbound(store, cfg, msg("Hi"));
    await handleInbound(store, cfg, msg("depends on the project"));
    const lead = (await store.findLeadByPhone(BUYER))!;
    expect(lead.budget_max_inr).toBeNull();
    expect(toBuyer().at(-1)).toMatch(/area/i);
  });
});

describe("opting out", () => {
  it("STOP closes the lead without a reply", async () => {
    await handleInbound(store, cfg, msg("Hi"));
    const before = sender.sent.length;
    const lead = await handleInbound(store, cfg, msg("STOP"));
    expect(sender.sent).toHaveLength(before);
    expect(lead.status).toBe("lost");
    expect(lead.lost_reason).toBe("Asked to stop messages");
  });
});

describe("greeting form leads", () => {
  it("uses the Meta opener template outside the 24h window", async () => {
    cfg.openerTemplate = { name: "realtyniti_opener", language: "en" };
    const { lead } = await captureLead(store, { source: "meta", phone: BUYER, name: "Ravi Kumar" });
    await greetNewLead(store, cfg, lead);
    expect(sender.sent[0].template).toEqual({ name: "realtyniti_opener", language: "en", params: ["Ravi", "Realtyniti"] });

    // When they reply, the questions start.
    await handleInbound(store, cfg, msg("Yes please"));
    expect(toBuyer().at(-1)).toMatch(/budget/i);
  });

  it("greets a Tathya Homes ad lead as Tathya Homes, keeping the brand on later visits", async () => {
    cfg.openerTemplate = { name: "brand_opener", language: "en" };
    const { lead } = await captureLead(store, { source: "meta", brand: "Tathya Homes", phone: BUYER, name: "Ravi Kumar" });
    await greetNewLead(store, cfg, lead);
    expect(sender.sent[0].template?.params).toEqual(["Ravi", "Tathya Homes"]);

    // Same buyer later messages the WhatsApp number directly: still a Tathya Homes lead.
    const again = await captureLead(store, { source: "whatsapp", phone: BUYER });
    expect(again.lead.brand).toBe("Tathya Homes");
  });

  it("names the brand in free-text first replies", async () => {
    await captureLead(store, { source: "meta", brand: "Tathya Homes", phone: BUYER, name: "Ravi Kumar" });
    await handleInbound(store, cfg, msg("Hi"));
    expect(toBuyer()[0]).toMatch(/Chetan from Tathya Homes/);
    expect(toBuyer()[0]).not.toMatch(/Realtyniti/);
  });

  it("flags the card when no opener template is set up", async () => {
    const { lead } = await captureLead(store, { source: "website", phone: BUYER });
    await greetNewLead(store, cfg, lead);
    expect(sender.sent).toHaveLength(0);
    const events = await store.listEvents(lead.id);
    expect(events.at(-1)?.body).toMatch(/opener template is not set up/);
  });
});

describe("helpers", () => {
  it("answers", () => {
    expect(answerFor("site_visit", "haan ji")).toEqual({ agreed_site_visit: true });
    expect(answerFor("site_visit", "not now")).toEqual({ agreed_site_visit: false });
    expect(answerFor("timeline", "no idea")).toEqual({});
  });
  it("hinglish", () => {
    expect(looksHinglish("kya price hai")).toBe(true);
    expect(looksHinglish("Is it ready to move?")).toBe(false);
  });
  it("parses webhook messages", () => {
    const body = {
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                contacts: [{ wa_id: "919876543210", profile: { name: "Ravi" } }],
                messages: [{ id: "wamid.X", from: "919876543210", timestamp: "1761480000", type: "text", text: { body: "Hi" } }],
              },
            },
          ],
        },
      ],
    };
    expect(inboundMessages(body)).toEqual([
      { id: "wamid.X", from: "+919876543210", name: "Ravi", text: "Hi", timestamp: new Date(1761480000 * 1000).toISOString() },
    ]);
  });
  it("digest", async () => {
    await captureLead(store, { source: "meta", phone: BUYER, name: "Ravi", micro_market: "Noida", budget_max_inr: 5e6 });
    await captureLead(store, { source: "website", phone: "9811122233", name: "Anjali", message: "price?" });
    const d = buildDigest(await store.listLeads())!;
    expect(d).toMatch(/Last 24h: 2 new/);
    expect(d).toMatch(/Asked about money: Anjali/);
    expect(d).not.toMatch(/\n/);
  });
});
