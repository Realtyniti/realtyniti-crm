import type { Lead, LeadEvent, LeadTouch, MessageTemplate } from "../types";

export type NewLead = Omit<Lead, "id" | "created_at" | "updated_at">;
export type LeadPatch = Partial<Omit<Lead, "id" | "created_at" | "updated_at">>;

export interface LeadFilter {
  temperature?: Lead["temperature"];
  status?: Lead["status"];
  needsChetan?: boolean;
}

/** Everything the app needs from storage. Supabase in production, memory for local demo and tests. */
export interface Store {
  findLeadByPhone(phone: string): Promise<Lead | null>;
  getLead(id: string): Promise<Lead | null>;
  listLeads(filter?: LeadFilter): Promise<Lead[]>;
  insertLead(lead: NewLead): Promise<Lead>;
  updateLead(id: string, patch: LeadPatch): Promise<Lead>;

  findTouch(source: LeadTouch["source"], externalId: string): Promise<LeadTouch | null>;
  addTouch(touch: Omit<LeadTouch, "id">): Promise<LeadTouch>;
  listTouches(leadId: string): Promise<LeadTouch[]>;

  addEvent(event: Omit<LeadEvent, "id" | "created_at"> & { created_at?: string }): Promise<LeadEvent>;
  listEvents(leadId: string): Promise<LeadEvent[]>;

  listTemplates(): Promise<MessageTemplate[]>;
  getTemplate(key: string): Promise<MessageTemplate | null>;
  upsertTemplate(t: Omit<MessageTemplate, "updated_at">): Promise<MessageTemplate>;
}
