import { beforeEach, describe, expect, it } from "vitest";
import { addFlagOnce, reportSendProblem, type CatcherConfig } from "@/lib/catcher";
import { captureLead, saveTemplate } from "@/lib/leads";
import { MemoryStore } from "@/lib/store/memory";
import { readOnly } from "@/lib/store/read-only-store";
import { SupabaseStore } from "@/lib/store/supabase";
import { bookVisit, sendDueReminders } from "@/lib/visits";
import { canAutomate, GatedSender } from "@/lib/wa-gate";
import { setAutoWhatsApp } from "@/lib/wa-reply";
import { DryRunSender } from "@/lib/whatsapp";

/*
 * Fourth review round: a timeline flag for a blocked message is added exactly once, atomically,
 * however many hourly or overlapping runs try to add it.
 */

const BUYER = "+919876543210";
const CHETAN = "+919999988888";
const H = 3600_000;

describe("blocked reminder flag, in-memory store", () => {
  let store: MemoryStore;
  let cfg: CatcherConfig;

  beforeEach(async () => {
    store = new MemoryStore();
    const sender = new GatedSender(new DryRunSender(), store, { chetanPhone: CHETAN, onProblem: (m, p) => reportSendProblem(store, cfg, m, p) });
    cfg = { sender, chetanPhone: CHETAN, openerTemplate: null, alertTemplate: null, canAutomate: (l) => canAutomate(store, l) };
    for (const t of await store.listTemplates()) await saveTemplate(store, t.key, t.body, true);
  });

  it("five overlapping runs of the same blocked reminder create exactly one flag, and later hourly runs add none", async () => {
    const now = Date.now();
    const { lead: l } = await captureLead(store, { source: "meta", phone: BUYER, name: "Ravi" });
    await setAutoWhatsApp(store, l.id, true);
    const lead = await store.updateLead(l.id, { last_inbound_at: new Date(now + H).toISOString() });
    const slot = await store.insertSlot({
      starts_at: new Date(now + 3 * H).toISOString(), ends_at: new Date(now + 4 * H).toISOString(),
      area: "Noida", address: "Sales office", map_url: null, capacity: 1, is_open: true,
    });
    await bookVisit(store, cfg, lead.id, { slotId: slot.id }, new Date(now));
    // Sending is off (the defaults), so the reminder is blocked and stays due.
    const reminderFlags = async () =>
      (await store.listEvents(lead.id)).filter((e) => e.kind === "flag" && e.body.startsWith("Not sent") && /two hours/.test(e.body));

    const due = new Date(now + 1.5 * H);
    await Promise.all(Array.from({ length: 5 }, () => sendDueReminders(store, cfg, due)));
    expect(await reminderFlags()).toHaveLength(1);

    await sendDueReminders(store, cfg, new Date(due.getTime() + 15 * 60_000));
    await sendDueReminders(store, cfg, new Date(due.getTime() + 30 * 60_000));
    expect(await reminderFlags()).toHaveLength(1);
  });

  it("addFlagOnce called concurrently: one flag; a different text is a different flag", async () => {
    const { lead } = await captureLead(store, { source: "meta", phone: BUYER });
    await Promise.all(Array.from({ length: 10 }, () => addFlagOnce(store, lead.id, "Not sent: X")));
    await addFlagOnce(store, lead.id, "Not sent: Y");
    const bodies = (await store.listEvents(lead.id)).filter((e) => e.kind === "flag").map((e) => e.body);
    expect(bodies.sort()).toEqual(["Not sent: X", "Not sent: Y"]);
  });

  it("the same text on another lead is that lead's own flag", async () => {
    const a = (await captureLead(store, { source: "meta", phone: BUYER })).lead;
    const b = (await captureLead(store, { source: "meta", phone: "+919811122233" })).lead;
    await Promise.all([addFlagOnce(store, a.id, "Not sent: X"), addFlagOnce(store, b.id, "Not sent: X")]);
    expect((await store.listEvents(a.id)).filter((e) => e.kind === "flag")).toHaveLength(1);
    expect((await store.listEvents(b.id)).filter((e) => e.kind === "flag")).toHaveLength(1);
  });

  it("a read-only preview cannot add flags", async () => {
    await expect(readOnly(store).addEventOnce({ lead_id: "x", kind: "flag", channel: null, body: "b" }, "k")).rejects.toThrow();
  });
});

describe("blocked reminder flag, Supabase store", () => {
  /**
   * A stand-in for the Supabase client: lead_events with a unique dedupe_key, answering after a
   * delay so concurrent inserts really overlap. A repeated key fails with Postgres' code 23505,
   * which is what the real unique index returns (checked against real Postgres separately).
   */
  function fakeDb() {
    const rows: Record<string, unknown>[] = [];
    const inserts: Record<string, unknown>[] = [];
    const client = {
      from(table: string) {
        expect(table).toBe("lead_events");
        return {
          insert(row: Record<string, unknown>) {
            inserts.push(row);
            return {
              select: () => ({
                single: async () => {
                  await new Promise((r) => setTimeout(r, 5));
                  if (row.dedupe_key && rows.some((r) => r.dedupe_key === row.dedupe_key)) {
                    return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
                  }
                  const saved = { ...row, id: `e${rows.length + 1}`, created_at: new Date().toISOString() };
                  rows.push(saved);
                  return { data: saved, error: null };
                },
              }),
            };
          },
        };
      },
    };
    return { client, rows, inserts };
  }

  function storeWith(client: unknown) {
    const store = new SupabaseStore("https://example.supabase.co", "test-key");
    (store as unknown as { db: unknown }).db = client;
    return store;
  }

  it("sends the key with the insert and turns the unique violation into 'already there'", async () => {
    const db = fakeDb();
    const store = storeWith(db.client);
    const event = { lead_id: "lead-1", kind: "flag" as const, channel: "whatsapp" as const, body: "Not sent: X" };
    expect(await store.addEventOnce(event, "flag:k")).toMatchObject({ body: "Not sent: X" });
    expect(await store.addEventOnce(event, "flag:k")).toBeNull();
    expect(db.inserts[0]).toMatchObject({ dedupe_key: "flag:k", kind: "flag" });
    expect(db.rows).toHaveLength(1);
  });

  it("ten concurrent addFlagOnce calls through the Supabase store leave one flag", async () => {
    const db = fakeDb();
    const store = storeWith(db.client);
    await Promise.all(Array.from({ length: 10 }, () => addFlagOnce(store, "lead-1", "Not sent: WhatsApp sending is switched off.")));
    expect(db.rows).toHaveLength(1);
    expect(db.inserts).toHaveLength(10);
    expect(new Set(db.inserts.map((r) => r.dedupe_key)).size).toBe(1);
  });

  it("any other database error is raised, not swallowed", async () => {
    const store = storeWith({
      from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { code: "42P01", message: "relation does not exist" } }) }) }) }),
    });
    await expect(store.addEventOnce({ lead_id: "l", kind: "flag", channel: null, body: "b" }, "k")).rejects.toThrow(/relation does not exist/);
  });
});
