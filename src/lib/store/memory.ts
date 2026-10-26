import { randomUUID } from "node:crypto";
import { DEFAULT_TEMPLATES } from "../templates";
import type { Lead, LeadEvent, LeadTouch, MessageTemplate } from "../types";
import type { LeadFilter, LeadPatch, NewLead, Store } from "./types";

/** In-process store. Data is lost on restart; used for local demo and tests. */
export class MemoryStore implements Store {
  private leads = new Map<string, Lead>();
  private touches: LeadTouch[] = [];
  private events: LeadEvent[] = [];
  private templates = new Map<string, MessageTemplate>();

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
}

/** Mirrors the database's lost_needs_reason constraint. */
function checkLost(l: Pick<Lead, "status" | "lost_reason">) {
  if (l.status === "lost" && !l.lost_reason?.trim()) throw new Error("A lost reason is required to close a lead.");
}
