import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ChannelSpend, Lead, LeadEvent, LeadTouch, MessageTemplate, Project, ProjectInput, SiteVisit, VisitSlot } from "../types";
import { cleanSearch, viewWindow, type LeadQuery, type LeadView } from "../lead-views";
import type { LeadFilter, LeadPatch, NewLead, Store, VisitFilter } from "./types";

/** Server-only store backed by Supabase, using the service role key. */
export class SupabaseStore implements Store {
  private db: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.db = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  }

  async findLeadByPhone(phone: string) {
    return one<Lead>(await this.db.from("leads").select("*").eq("phone", phone).maybeSingle());
  }

  async getLead(id: string) {
    return one<Lead>(await this.db.from("leads").select("*").eq("id", id).maybeSingle());
  }

  async listLeads(filter: LeadFilter = {}) {
    let q = this.db.from("leads").select("*").order("created_at", { ascending: false }).limit(500);
    if (filter.temperature) q = q.eq("temperature", filter.temperature);
    if (filter.status) q = q.eq("status", filter.status);
    if (filter.needsChetan !== undefined) q = q.eq("needs_chetan", filter.needsChetan);
    return many<Lead>(await q);
  }

  async queryLeads(query: LeadQuery) {
    const size = query.pageSize ?? 25;
    const page = Math.max(1, query.page ?? 1);
    let q = applyView(this.db.from("leads").select("*", { count: "exact" }), query.view);
    if (query.source) q = q.eq("first_source", query.source);
    if (query.status) q = q.eq("status", query.status);
    if (query.budget === "known") q = q.or("budget_min_inr.not.is.null,budget_max_inr.not.is.null");
    if (query.budget === "unknown") q = q.is("budget_min_inr", null).is("budget_max_inr", null);
    const text = cleanSearch(query.q);
    if (text) {
      const digits = text.replace(/\D/g, "");
      q = q.or(digits.length >= 3 ? `name.ilike.%${text}%,phone.ilike.%${digits}%` : `name.ilike.%${text}%`);
    }
    if (query.sort !== "recent") q = q.order("next_follow_up_at", { ascending: true, nullsFirst: false });
    q = q.order("created_at", { ascending: false }).range((page - 1) * size, page * size - 1);
    const { data, error, count } = await q;
    if (error) throw new Error(error.message);
    return { rows: (data ?? []) as Lead[], total: count ?? 0 };
  }

  async countLeads(views: readonly LeadView[]) {
    const counts = await Promise.all(
      views.map(async (v) => {
        const { count, error } = await applyView(this.db.from("leads").select("id", { count: "exact", head: true }), v);
        if (error) throw new Error(error.message);
        return [v, count ?? 0] as const;
      }),
    );
    return Object.fromEntries(counts) as Record<LeadView, number>;
  }

  async firstTouchAt(leadIds: string[]) {
    if (leadIds.length === 0) return {};
    const rows = many<{ lead_id: string; received_at: string }>(
      await this.db.from("lead_touches").select("lead_id, received_at").in("lead_id", leadIds).order("received_at"),
    );
    const out: Record<string, string> = {};
    for (const r of rows) out[r.lead_id] ??= r.received_at;
    return out;
  }

  async insertLead(lead: NewLead) {
    return must<Lead>(await this.db.from("leads").insert(lead).select().single());
  }

  async updateLead(id: string, patch: LeadPatch) {
    return must<Lead>(await this.db.from("leads").update(patch).eq("id", id).select().single());
  }

  async findTouch(source: LeadTouch["source"], externalId: string) {
    return one<LeadTouch>(
      await this.db.from("lead_touches").select("*").eq("source", source).eq("external_id", externalId).maybeSingle(),
    );
  }

  async addTouch(touch: Omit<LeadTouch, "id">) {
    return must<LeadTouch>(await this.db.from("lead_touches").insert(touch).select().single());
  }

  async listTouches(leadId: string) {
    return many<LeadTouch>(
      await this.db.from("lead_touches").select("*").eq("lead_id", leadId).order("received_at"),
    );
  }

  async addEvent(event: Omit<LeadEvent, "id" | "created_at"> & { created_at?: string }) {
    return must<LeadEvent>(await this.db.from("lead_events").insert(event).select().single());
  }

  async listEvents(leadId: string) {
    return many<LeadEvent>(await this.db.from("lead_events").select("*").eq("lead_id", leadId).order("created_at"));
  }

  async listTemplates() {
    return many<MessageTemplate>(await this.db.from("message_templates").select("*").order("key"));
  }

  async getTemplate(key: string) {
    return one<MessageTemplate>(await this.db.from("message_templates").select("*").eq("key", key).maybeSingle());
  }

  async upsertTemplate(t: Omit<MessageTemplate, "updated_at">) {
    return must<MessageTemplate>(await this.db.from("message_templates").upsert(t).select().single());
  }

  async listSlots(filter: { from?: string; openOnly?: boolean } = {}) {
    let q = this.db.from("visit_slots").select("*").order("starts_at").limit(500);
    if (filter.from) q = q.gte("starts_at", filter.from);
    if (filter.openOnly) q = q.eq("is_open", true);
    return many<VisitSlot>(await q);
  }

  async getSlot(id: string) {
    return one<VisitSlot>(await this.db.from("visit_slots").select("*").eq("id", id).maybeSingle());
  }

  async insertSlot(slot: Omit<VisitSlot, "id" | "created_at">) {
    return must<VisitSlot>(await this.db.from("visit_slots").insert(slot).select().single());
  }

  async updateSlot(id: string, patch: Partial<Omit<VisitSlot, "id" | "created_at">>) {
    return must<VisitSlot>(await this.db.from("visit_slots").update(patch).eq("id", id).select().single());
  }

  async listVisits(filter: VisitFilter = {}) {
    let q = this.db.from("site_visits").select("*").order("created_at").limit(1000);
    if (filter.leadId) q = q.eq("lead_id", filter.leadId);
    if (filter.slotId) q = q.eq("slot_id", filter.slotId);
    if (filter.slotIds) q = q.in("slot_id", filter.slotIds);
    if (filter.status) q = q.eq("status", filter.status);
    return many<SiteVisit>(await q);
  }

  async insertVisit(visit: Omit<SiteVisit, "id" | "created_at" | "reminder_evening_sent_at" | "reminder_2h_sent_at">) {
    return must<SiteVisit>(await this.db.from("site_visits").insert(visit).select().single());
  }

  async updateVisit(id: string, patch: Partial<Omit<SiteVisit, "id" | "created_at">>) {
    return must<SiteVisit>(await this.db.from("site_visits").update(patch).eq("id", id).select().single());
  }

  async listProjects() {
    return many<Project>(await this.db.from("projects").select("*").order("name"));
  }

  async getProject(id: string) {
    return one<Project>(await this.db.from("projects").select("*").eq("id", id).maybeSingle());
  }

  async insertProject(p: ProjectInput) {
    return must<Project>(await this.db.from("projects").insert(p).select().single());
  }

  async updateProject(id: string, patch: Partial<ProjectInput>) {
    return must<Project>(await this.db.from("projects").update(patch).eq("id", id).select().single());
  }

  async listSpend() {
    return many<ChannelSpend>(await this.db.from("channel_spend").select("source, month, amount_inr").order("month", { ascending: false }));
  }

  async upsertSpend(s: ChannelSpend) {
    return must<ChannelSpend>(
      await this.db.from("channel_spend").upsert({ ...s, updated_at: new Date().toISOString() }).select("source, month, amount_inr").single(),
    );
  }
}

// The query builder's generic type is unwieldy; these are the filter methods the views use.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Filterable = any;

/** Mirrors matchesView() in lead-views.ts as database filters. */
function applyView(q: Filterable, view: LeadView): Filterable {
  const { start, end } = viewWindow();
  const open = () => q.not("status", "in", "(converted,lost)");
  switch (view) {
    case "all":
      return q;
    case "open":
      return open();
    case "new":
      return q.eq("status", "new");
    case "hot":
    case "warm":
    case "cold":
      return open().eq("temperature", view);
    case "due":
      return open().gte("next_follow_up_at", start).lte("next_follow_up_at", end);
    case "overdue":
      return open().lt("next_follow_up_at", start);
    case "chetan":
      return open().eq("needs_chetan", true);
    case "lost":
      return q.eq("status", "lost");
  }
}

type Result<T> = { data: T | null; error: { message: string } | null };

function one<T>({ data, error }: Result<T>): T | null {
  if (error) throw new Error(error.message);
  return data;
}

function must<T>(r: Result<T>): T {
  const row = one(r);
  if (!row) throw new Error("No row returned");
  return row;
}

function many<T>({ data, error }: Result<T[]>): T[] {
  if (error) throw new Error(error.message);
  return data ?? [];
}
