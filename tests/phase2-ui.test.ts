import { beforeEach, describe, expect, it } from "vitest";
import { captureLead } from "@/lib/leads";
import { followUpState } from "@/lib/lead-display";
import { cleanSearch, startOfTodayIst } from "@/lib/lead-views";
import { ReadOnlyError } from "@/lib/read-only";
import { MemoryStore } from "@/lib/store/memory";
import { readOnly } from "@/lib/store/read-only-store";

let store: MemoryStore;
beforeEach(() => {
  store = new MemoryStore();
});

const day = 86_400_000;

describe("read-only preview store", () => {
  it("reads pass through and every write is refused", async () => {
    const { lead } = await captureLead(store, { source: "meta", phone: "9876543210", name: "Ravi" });
    const ro = readOnly(store);
    expect((await ro.getLead(lead.id))?.name).toBe("Ravi");
    expect(await ro.listLeads()).toHaveLength(1);
    await expect(ro.updateLead(lead.id, { name: "Changed" })).rejects.toBeInstanceOf(ReadOnlyError);
    await expect(ro.addEvent({ lead_id: lead.id, kind: "note", channel: null, body: "x" })).rejects.toBeInstanceOf(ReadOnlyError);
    await expect(captureLead(ro, { source: "website", phone: "9123456789" })).rejects.toBeInstanceOf(ReadOnlyError);
    expect((await store.getLead(lead.id))?.name).toBe("Ravi");
    expect(await store.listLeads()).toHaveLength(1);
  });
});

describe("lead views", () => {
  async function seed() {
    const now = Date.now();
    const at = (offset: number) => new Date(now + offset).toISOString();
    const mk = async (phone: string, patch: Parameters<MemoryStore["updateLead"]>[1]) => {
      const { lead } = await captureLead(store, { source: "meta", phone, name: phone.slice(-2) });
      return store.updateLead(lead.id, patch);
    };
    const today = new Date(startOfTodayIst().getTime() + 12 * 3600_000).toISOString();
    await mk("9000000001", { next_follow_up_at: at(-3 * day), temperature: "hot" });
    await mk("9000000002", { next_follow_up_at: today, temperature: "warm" });
    await mk("9000000003", { next_follow_up_at: at(5 * day), temperature: "cold" });
    await mk("9000000004", { next_follow_up_at: at(-3 * day), status: "lost", lost_reason: "Bought elsewhere" });
  }

  it("splits overdue from due today and leaves closed leads out", async () => {
    await seed();
    const c = await store.countLeads(["all", "open", "due", "overdue", "hot", "lost"]);
    expect(c).toEqual({ all: 4, open: 3, due: 1, overdue: 1, hot: 1, lost: 1 });
  });

  it("pages, searches by phone digits and sorts by next follow-up", async () => {
    await seed();
    const page = await store.queryLeads({ view: "open", pageSize: 2 });
    expect(page.total).toBe(3);
    expect(page.rows.map((r) => r.phone)).toEqual(["+919000000001", "+919000000002"]);
    expect((await store.queryLeads({ view: "all", q: "0003" })).rows.map((r) => r.phone)).toEqual(["+919000000003"]);
  });

  it("strips characters that would change the database filter", () => {
    expect(cleanSearch("ravi,phone.eq.1")).toBe("ravi phone.eq.1");
    expect(cleanSearch("  (%)  ")).toBeNull();
  });

  it("labels follow-up state", () => {
    const now = new Date();
    expect(followUpState(null)).toBeNull();
    expect(followUpState(new Date(now.getTime() - 2 * day).toISOString())).toBe("overdue");
    expect(followUpState(new Date(now.getTime() + 3 * day).toISOString())).toBe("upcoming");
  });
});
