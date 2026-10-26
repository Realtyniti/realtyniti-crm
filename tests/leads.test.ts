import { beforeEach, describe, expect, it } from "vitest";
import { captureLead, closeLead, LeadError, saveTemplate, updateRequirement } from "@/lib/leads";
import { MemoryStore } from "@/lib/store/memory";

let store: MemoryStore;
beforeEach(() => {
  store = new MemoryStore();
});

describe("captureLead", () => {
  it("creates a card with source, follow-up date and no tag until something is answered", async () => {
    const r = await captureLead(store, { source: "website", phone: "98765 43210", name: "Ravi" });
    expect(r.created).toBe(true);
    expect(r.lead.phone).toBe("+919876543210");
    expect(r.lead.first_source).toBe("website");
    expect(r.lead.temperature).toBeNull();
    expect(r.lead.next_follow_up_at).toBeTruthy();
  });

  it("the same client from two platforms is one card with both sources", async () => {
    const a = await captureLead(store, { source: "meta", phone: "+91 9876543210", micro_market: "Noida" });
    const b = await captureLead(store, { source: "whatsapp", phone: "09876543210", name: "Ravi", budget_max_inr: 5e6 });
    expect(b.created).toBe(false);
    expect(b.lead.id).toBe(a.lead.id);
    expect(b.lead.name).toBe("Ravi");
    expect(b.lead.micro_market).toBe("Noida");
    expect(b.lead.budget_max_inr).toBe(5e6);
    expect((await store.listTouches(a.lead.id)).map((t) => t.source)).toEqual(["meta", "whatsapp"]);
    expect(await store.listLeads()).toHaveLength(1);
  });

  it("never wipes a known answer with a channel that knows less", async () => {
    await captureLead(store, { source: "website", phone: "9876543210", micro_market: "Yamuna Expressway" });
    const b = await captureLead(store, { source: "meta", phone: "9876543210", micro_market: "Noida" });
    expect(b.lead.micro_market).toBe("Yamuna Expressway");
  });

  it("a webhook delivered twice is stored once", async () => {
    await captureLead(store, { source: "meta", phone: "9876543210", external_id: "lg_1" });
    const again = await captureLead(store, { source: "meta", phone: "9876543210", external_id: "lg_1" });
    expect(again.duplicateDelivery).toBe(true);
    expect(await store.listTouches(again.lead.id)).toHaveLength(1);
  });

  it("flags the card for Chetan when money comes up", async () => {
    const r = await captureLead(store, { source: "whatsapp", phone: "9876543210", message: "2bhk kitne ka hai?" });
    expect(r.flaggedForChetan).toBe(true);
    const events = await store.listEvents(r.lead.id);
    expect(events.some((e) => e.kind === "flag")).toBe(true);
  });

  it("rejects an invalid phone", async () => {
    await expect(captureLead(store, { source: "website", phone: "123" })).rejects.toThrow(LeadError);
  });
});

describe("updating and closing", () => {
  it("re-tags when answers change", async () => {
    const { lead } = await captureLead(store, { source: "website", phone: "9876543210" });
    const hot = await updateRequirement(store, lead.id, {
      budget_max_inr: 5_500_000,
      micro_market: "Greater Noida West",
      timeline_months: 2,
      agreed_site_visit: true,
    });
    expect(hot.temperature).toBe("hot");
    expect(hot.status).toBe("qualifying");
  });

  it("a lead cannot be closed as lost without a reason", async () => {
    const { lead } = await captureLead(store, { source: "website", phone: "9876543210" });
    await expect(closeLead(store, lead.id, "lost", "  ")).rejects.toThrow(LeadError);
    const closed = await closeLead(store, lead.id, "lost", "Bought elsewhere");
    expect(closed.status).toBe("lost");
    expect(closed.next_follow_up_at).toBeNull();
  });

  it("a lost client who comes back is live again", async () => {
    const { lead } = await captureLead(store, { source: "website", phone: "9876543210" });
    await closeLead(store, lead.id, "lost", "Stopped replying");
    const back = await captureLead(store, { source: "whatsapp", phone: "9876543210" });
    expect(back.lead.status).toBe("new");
    expect(back.lead.lost_reason).toBeNull();
  });
});

describe("template approval", () => {
  it("cannot approve a template that mentions money", async () => {
    await expect(saveTemplate(store, "first_reply.meta", "Hi {{name}}, price starts at 45 lakh", true)).rejects.toThrow(
      LeadError,
    );
  });
  it("editing an approved template withdraws approval", async () => {
    const approved = await saveTemplate(store, "first_reply.meta", "Hi {{name}}, thanks!", true);
    expect(approved.approved_at).toBeTruthy();
    const edited = await saveTemplate(store, "first_reply.meta", "Hi {{name}}, thanks a lot!", false);
    expect(edited.approved_at).toBeNull();
  });
});
