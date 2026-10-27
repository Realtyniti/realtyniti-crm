import { randomUUID } from "node:crypto";
import { DEFAULT_TEMPLATES } from "../templates";
import type { ChannelSpend, Lead, LeadEvent, LeadTouch, MessageTemplate, Project, ProjectInput, SiteVisit, VisitSlot } from "../types";
import { compareLeads, matchesQuery, matchesView, type LeadQuery, type LeadView } from "../lead-views";
import type { LeadFilter, LeadPatch, NewLead, Store, VisitFilter } from "./types";

/** In-process store. Data is lost on restart; used for local demo and tests. */
export class MemoryStore implements Store {
  private leads = new Map<string, Lead>();
  private touches: LeadTouch[] = [];
  private events: LeadEvent[] = [];
  private templates = new Map<string, MessageTemplate>();
  private slots = new Map<string, VisitSlot>();
  private visits = new Map<string, SiteVisit>();
  private projects = new Map<string, Project>();
  private spend = new Map<string, ChannelSpend>();

  constructor() {
    const now = new Date().toISOString();
    for (const t of DEFAULT_TEMPLATES) this.templates.set(t.key, { ...t, approved_at: null, updated_at: now });
  }

  async findLeadByPhone(phone: string) {
    return [...this.leads.values()].find((l) => l.phone === phone) ?? null;
  }

  async getLead(id: string) {
    return this.leads.get(id) ?? null;
  }

  async listLeads(filter: LeadFilter = {}) {
    return [...this.leads.values()]
      .filter((l) => !filter.temperature || l.temperature === filter.temperature)
      .filter((l) => !filter.status || l.status === filter.status)
      .filter((l) => filter.needsChetan === undefined || l.needs_chetan === filter.needsChetan)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async queryLeads(query: LeadQuery) {
    const size = query.pageSize ?? 25;
    const page = Math.max(1, query.page ?? 1);
    const all = [...this.leads.values()].filter((l) => matchesQuery(l, query)).sort(compareLeads(query.sort));
    return { rows: all.slice((page - 1) * size, page * size), total: all.length };
  }

  async countLeads(views: readonly LeadView[]) {
    const leads = [...this.leads.values()];
    return Object.fromEntries(views.map((v) => [v, leads.filter((l) => matchesView(l, v)).length])) as Record<LeadView, number>;
  }

  async firstTouchAt(leadIds: string[]) {
    const out: Record<string, string> = {};
    for (const t of this.touches) {
      if (!leadIds.includes(t.lead_id)) continue;
      if (!out[t.lead_id] || t.received_at < out[t.lead_id]) out[t.lead_id] = t.received_at;
    }
    return out;
  }

  async insertLead(lead: NewLead) {
    if (await this.findLeadByPhone(lead.phone)) throw new Error(`duplicate phone ${lead.phone}`);
    checkLost(lead);
    const now = new Date().toISOString();
    const row: Lead = { ...lead, id: randomUUID(), created_at: now, updated_at: now };
    this.leads.set(row.id, row);
    return row;
  }

  async updateLead(id: string, patch: LeadPatch) {
    const current = this.leads.get(id);
    if (!current) throw new Error(`lead ${id} not found`);
    const next: Lead = { ...current, ...patch, updated_at: new Date().toISOString() };
    checkLost(next);
    this.leads.set(id, next);
    return next;
  }

  async findTouch(source: LeadTouch["source"], externalId: string) {
    return this.touches.find((t) => t.source === source && t.external_id === externalId) ?? null;
  }

  async addTouch(touch: Omit<LeadTouch, "id">) {
    const row = { ...touch, id: randomUUID() };
    this.touches.push(row);
    return row;
  }

  async listTouches(leadId: string) {
    return this.touches.filter((t) => t.lead_id === leadId);
  }

  async addEvent(event: Omit<LeadEvent, "id" | "created_at"> & { created_at?: string }) {
    const row: LeadEvent = { ...event, id: randomUUID(), created_at: event.created_at ?? new Date().toISOString() };
    this.events.push(row);
    return row;
  }

  async listEvents(leadId: string) {
    return this.events.filter((e) => e.lead_id === leadId).sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  async listTemplates() {
    return [...this.templates.values()].sort((a, b) => a.key.localeCompare(b.key));
  }

  async getTemplate(key: string) {
    return this.templates.get(key) ?? null;
  }

  async upsertTemplate(t: Omit<MessageTemplate, "updated_at">) {
    const prev = this.templates.get(t.key);
    // Mirrors the database trigger: editing the text withdraws approval.
    const approved_at = prev && prev.body !== t.body && prev.approved_at === t.approved_at ? null : t.approved_at;
    const row = { ...t, approved_at, updated_at: new Date().toISOString() };
    this.templates.set(t.key, row);
    return row;
  }

  async listSlots(filter: { from?: string; openOnly?: boolean } = {}) {
    return [...this.slots.values()]
      .filter((s) => !filter.from || s.starts_at >= filter.from)
      .filter((s) => !filter.openOnly || s.is_open)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  }

  async getSlot(id: string) {
    return this.slots.get(id) ?? null;
  }

  async insertSlot(slot: Omit<VisitSlot, "id" | "created_at">) {
    const row = { ...slot, id: randomUUID(), created_at: new Date().toISOString() };
    this.slots.set(row.id, row);
    return row;
  }

  async updateSlot(id: string, patch: Partial<Omit<VisitSlot, "id" | "created_at">>) {
    const cur = this.slots.get(id);
    if (!cur) throw new Error(`slot ${id} not found`);
    const row = { ...cur, ...patch };
    this.slots.set(id, row);
    return row;
  }

  async listVisits(filter: VisitFilter = {}) {
    return [...this.visits.values()]
      .filter((v) => !filter.leadId || v.lead_id === filter.leadId)
      .filter((v) => !filter.slotId || v.slot_id === filter.slotId)
      .filter((v) => !filter.slotIds || filter.slotIds.includes(v.slot_id))
      .filter((v) => !filter.status || v.status === filter.status)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  async insertVisit(visit: Omit<SiteVisit, "id" | "created_at" | "reminder_evening_sent_at" | "reminder_2h_sent_at">) {
    // Mirrors the one-live-booking-per-lead unique index.
    if (visit.status === "booked" && [...this.visits.values()].some((v) => v.lead_id === visit.lead_id && v.status === "booked")) {
      throw new Error("lead already has a live booking");
    }
    const row: SiteVisit = {
      ...visit,
      id: randomUUID(),
      created_at: new Date().toISOString(),
      reminder_evening_sent_at: null,
      reminder_2h_sent_at: null,
    };
    this.visits.set(row.id, row);
    return row;
  }

  async updateVisit(id: string, patch: Partial<Omit<SiteVisit, "id" | "created_at">>) {
    const cur = this.visits.get(id);
    if (!cur) throw new Error(`visit ${id} not found`);
    const row = { ...cur, ...patch };
    this.visits.set(id, row);
    return row;
  }

  async listProjects() {
    return [...this.projects.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async getProject(id: string) {
    return this.projects.get(id) ?? null;
  }

  async insertProject(p: ProjectInput) {
    const now = new Date().toISOString();
    const row: Project = { ...p, id: randomUUID(), created_at: now, updated_at: now };
    this.projects.set(row.id, row);
    return row;
  }

  async updateProject(id: string, patch: Partial<ProjectInput>) {
    const cur = this.projects.get(id);
    if (!cur) throw new Error(`project ${id} not found`);
    const row = { ...cur, ...patch, updated_at: new Date().toISOString() };
    this.projects.set(id, row);
    return row;
  }

  async listSpend() {
    return [...this.spend.values()].sort((a, b) => b.month.localeCompare(a.month));
  }

  async upsertSpend(s: ChannelSpend) {
    this.spend.set(`${s.source}|${s.month}`, s);
    return s;
  }
}

/** Mirrors the database's lost_needs_reason constraint. */
function checkLost(l: Pick<Lead, "status" | "lost_reason">) {
  if (l.status === "lost" && !l.lost_reason?.trim()) throw new Error("A lost reason is required to close a lead.");
}
