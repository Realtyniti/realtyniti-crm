import type { Lead } from "../types";
import type { Store } from "./types";

/** An agent asked for a lead (or a change) outside their own leads. */
export class AccessError extends Error {
  constructor(message = "You don't have access to that.") {
    super(message);
  }
}

/** Store methods an agent may never call, whatever the screen offers. */
const FORBIDDEN = [
  "reassignLeads",
  "insertSlot",
  "updateSlot",
  "upsertTemplate",
  "updateWhatsAppSettings",
  "upsertSpend",
  "insertProject",
  "updateProject",
] as const satisfies readonly (keyof Store)[];

/**
 * The lead store as an agent sees it: only leads assigned to them, everywhere. Reads of other
 * leads come back empty (as if the lead didn't exist), and writes to them throw. Every screen
 * an agent opens gets this store, so a missed check on one page can't leak someone else's lead.
 */
export function scopedStore(store: Store, memberId: string): Store {
  const mine = (l: Lead | null) => (l && l.assigned_to === memberId ? l : null);
  const assertMine = async (leadId: string | null | undefined) => {
    if (!leadId || !mine(await store.getLead(leadId))) throw new AccessError();
  };
  const myLeadIds = async () => (await store.listLeads({ assignedTo: memberId })).map((l) => l.id);

  const overrides: Partial<Store> = {
    getLead: async (id) => mine(await store.getLead(id)),
    findLeadByPhone: async (phone) => mine(await store.findLeadByPhone(phone)),
    listLeads: (filter = {}) => store.listLeads({ ...filter, assignedTo: memberId }),
    queryLeads: (query) => store.queryLeads({ ...query, assignee: memberId }),
    countLeads: (views) => store.countLeads(views, memberId),
    leadFacts: () => store.leadFacts(memberId),
    firstTouchAt: async (ids) => {
      const allowed = new Set(await myLeadIds());
      return store.firstTouchAt(ids.filter((id) => allowed.has(id)));
    },
    updateLead: async (id, patch) => {
      await assertMine(id);
      if ("assigned_to" in patch) throw new AccessError("Only the owner or a manager can assign leads.");
      return store.updateLead(id, patch);
    },
    listTouches: async (leadId) => (await assertMine(leadId), store.listTouches(leadId)),
    listEvents: async (leadId) => (await assertMine(leadId), store.listEvents(leadId)),
    listWaMessages: async (leadId) => (await assertMine(leadId), store.listWaMessages(leadId)),
    addEvent: async (event) => (await assertMine(event.lead_id), store.addEvent(event)),
    addEventOnce: async (event, key) => (await assertMine(event.lead_id), store.addEventOnce(event, key)),
    addTouch: async (touch) => (await assertMine(touch.lead_id), store.addTouch(touch)),
    listVisits: async (filter = {}) => {
      const ids = await myLeadIds();
      const leadIds = filter.leadIds ? filter.leadIds.filter((id) => ids.includes(id)) : ids;
      if (filter.leadId && !ids.includes(filter.leadId)) return [];
      return store.listVisits({ ...filter, leadIds });
    },
    insertVisit: async (visit) => (await assertMine(visit.lead_id), store.insertVisit(visit)),
    updateVisit: async (id, patch) => {
      const visits = await store.listVisits({ leadIds: await myLeadIds() });
      if (!visits.some((v) => v.id === id) || ("lead_id" in patch && patch.lead_id)) throw new AccessError();
      return store.updateVisit(id, patch);
    },
    leadsContactedOnWhatsApp: async (ids) => {
      const allowed = new Set(await myLeadIds());
      return store.leadsContactedOnWhatsApp(ids.filter((id) => allowed.has(id)));
    },
  };
  for (const name of FORBIDDEN) {
    (overrides as Record<string, unknown>)[name] = () => Promise.reject(new AccessError());
  }

  return new Proxy(store, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && prop in overrides) return overrides[prop as keyof Store];
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
