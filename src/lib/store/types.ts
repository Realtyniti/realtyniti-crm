import type { LeadPage, LeadQuery, LeadView } from "../lead-views";
import type { ChannelSpend, Lead, LeadEvent, LeadTouch, MessageTemplate, Project, ProjectInput, SiteVisit, VisitSlot } from "../types";

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
  /** One page of the Leads screen, filtered and sorted by the database. */
  queryLeads(query: LeadQuery): Promise<LeadPage>;
  countLeads(views: readonly LeadView[]): Promise<Record<LeadView, number>>;
  /** When each lead first enquired (earliest touch), which can be earlier than the card's created_at for imports. */
  firstTouchAt(leadIds: string[]): Promise<Record<string, string>>;
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

  listSlots(filter?: { from?: string; openOnly?: boolean }): Promise<VisitSlot[]>;
  getSlot(id: string): Promise<VisitSlot | null>;
  insertSlot(slot: Omit<VisitSlot, "id" | "created_at">): Promise<VisitSlot>;
  updateSlot(id: string, patch: Partial<Omit<VisitSlot, "id" | "created_at">>): Promise<VisitSlot>;

  listVisits(filter?: VisitFilter): Promise<SiteVisit[]>;
  insertVisit(visit: Omit<SiteVisit, "id" | "created_at" | "reminder_evening_sent_at" | "reminder_2h_sent_at">): Promise<SiteVisit>;
  updateVisit(id: string, patch: Partial<Omit<SiteVisit, "id" | "created_at">>): Promise<SiteVisit>;

  listProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project | null>;
  insertProject(p: ProjectInput): Promise<Project>;
  updateProject(id: string, patch: Partial<ProjectInput>): Promise<Project>;

  listSpend(): Promise<ChannelSpend[]>;
  upsertSpend(s: ChannelSpend): Promise<ChannelSpend>;
}

export interface VisitFilter {
  leadId?: string;
  slotId?: string;
  slotIds?: string[];
  status?: SiteVisit["status"];
}
