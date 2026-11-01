import type { LeadPage, LeadQuery, LeadView } from "../lead-views";
import type { ChannelSpend, Lead, LeadEvent, LeadTouch, MessageTemplate, NewWaMessage, Project, ProjectInput, SiteVisit, VisitSlot, WaMessage, WhatsAppSettings } from "../types";

export type NewLead = Omit<Lead, "id" | "created_at" | "updated_at">;
export type LeadPatch = Partial<Omit<Lead, "id" | "created_at" | "updated_at">>;

/** The few requirement fields the dashboard's market brief counts, for every lead. */
export type LeadFacts = Pick<Lead, "property_type" | "budget_min_inr" | "budget_max_inr" | "micro_market" | "status">;

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
  /** Requirement fields of every lead, for the dashboard's market brief. */
  leadFacts(): Promise<LeadFacts[]>;
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

  /** WhatsApp message log. addWaMessage returns null when the wamid or client_ref is already stored (duplicate). */
  addWaMessage(m: NewWaMessage): Promise<WaMessage | null>;
  findWaMessage(by: { wamid?: string; clientRef?: string }): Promise<WaMessage | null>;
  updateWaMessage(id: string, patch: Partial<Pick<WaMessage, "status" | "error" | "wamid" | "lead_id">>): Promise<WaMessage>;
  listWaMessages(leadId: string): Promise<WaMessage[]>;
  /** Lead ids (of those given) that have at least one outbound WhatsApp message Meta accepted (sent, delivered or read). */
  leadsContactedOnWhatsApp(leadIds: string[]): Promise<Set<string>>;

  getWhatsAppSettings(): Promise<WhatsAppSettings>;
  updateWhatsAppSettings(patch: Partial<Omit<WhatsAppSettings, "updated_at">>): Promise<WhatsAppSettings>;
}

export interface VisitFilter {
  leadId?: string;
  slotId?: string;
  slotIds?: string[];
  status?: SiteVisit["status"];
}
