import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Lead, LeadEvent, LeadTouch, MessageTemplate, SiteVisit, VisitSlot } from "../types";
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
