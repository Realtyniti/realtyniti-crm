export const LEAD_SOURCES = [
  "meta",
  "instagram",
  "youtube",
  "whatsapp",
  "website",
  "referral",
  "call",
  "other",
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export type Temperature = "hot" | "warm" | "cold";
export type LeadStatus = "new" | "qualifying" | "qualified" | "site_visit" | "converted" | "lost";
export type Purpose = "end_use" | "investment" | "rental";

/** The qualifying answers. Any of them may still be unknown. */
export interface Requirement {
  budget_min_inr: number | null;
  budget_max_inr: number | null;
  micro_market: string | null;
  property_type: string | null;
  purpose: Purpose | null;
  timeline_months: number | null;
  agreed_site_visit: boolean;
}

export interface Lead extends Requirement {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  interest_level: string | null;
  temperature: Temperature | null;
  status: LeadStatus;
  first_source: LeadSource;
  lost_reason: string | null;
  needs_chetan: boolean;
  needs_chetan_reason: string | null;
  next_follow_up_at: string | null;
  first_reply_at: string | null;
  notes: string | null;
  /** Lead Catcher: the question we are waiting on an answer for. */
  awaiting_question: string | null;
  asked_questions: string[];
  last_inbound_at: string | null;
  prefers_hinglish: boolean;
  /** The business name the buyer enquired with (Realtyniti, Tathya Homes); messages greet them in it. */
  brand: string;
  /** Follow-up Clock: messages sent since the buyer last replied. */
  followups_unanswered: number;
  last_followup_at: string | null;
  /**
   * Chetan allows automatic WhatsApp messages to this lead (bot replies, opener,
   * follow-ups, reminders). Off for every lead that existed before WhatsApp went
   * live and for imports; on for new live enquiries. Manual replies ignore it.
   */
  wa_auto_allowed: boolean;
  created_at: string;
  updated_at: string;
}

export interface LeadTouch {
  id: string;
  lead_id: string;
  source: LeadSource;
  external_id: string | null;
  raw: unknown;
  received_at: string;
}

export interface LeadEvent {
  id: string;
  lead_id: string;
  kind: "message_in" | "message_out" | "note" | "status_change" | "flag";
  channel: LeadSource | null;
  body: string;
  created_at: string;
}

export interface MessageTemplate {
  key: string;
  channel: LeadSource | null;
  purpose: string;
  body: string;
  approved_at: string | null;
  updated_at: string;
}

/** What an intake channel hands over: a phone plus whatever else it knew. */
export interface LeadInput extends Partial<Requirement> {
  phone: string;
  name?: string | null;
  email?: string | null;
  source: LeadSource;
  /** Which of Chetan's brands the enquiry came in under, when the channel knows. */
  brand?: string | null;
  external_id?: string | null;
  message?: string | null;
  raw?: unknown;
  received_at?: string;
  /** A live enquiry (Meta webhook, website, WhatsApp) that may get automatic WhatsApp messages. Imports and backfills never do. */
  autoWhatsApp?: boolean;
}

export interface VisitSlot {
  id: string;
  starts_at: string;
  ends_at: string;
  area: string;
  address: string | null;
  map_url: string | null;
  capacity: number;
  is_open: boolean;
  created_at: string;
}

export type VisitStatus = "booked" | "cancelled" | "done" | "no_show";

export interface SiteVisit {
  id: string;
  lead_id: string;
  slot_id: string;
  project_interest: string | null;
  pickup: string | null;
  people: number;
  status: VisitStatus;
  reminder_evening_sent_at: string | null;
  reminder_2h_sent_at: string | null;
  created_at: string;
}

export type Availability = "available" | "limited" | "sold_out" | "on_hold";

export interface Project {
  id: string;
  name: string;
  developer: string;
  micro_market: string;
  sector: string | null;
  rera_number: string | null;
  configurations: string | null;
  price_min_inr: number | null;
  price_max_inr: number | null;
  plc: string | null;
  payment_plan: string | null;
  possession: string | null;
  offers: string | null;
  offer_valid_until: string | null;
  amenities: string | null;
  availability: Availability;
  developer_contact_name: string | null;
  developer_contact_phone: string | null;
  last_confirmed_at: string | null;
  confirmed_by: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type ProjectInput = Omit<Project, "id" | "created_at" | "updated_at">;

export interface ChannelSpend {
  source: LeadSource;
  /** First day of the month, YYYY-MM-01. */
  month: string;
  amount_inr: number;
}

export type WaDirection = "in" | "out";
/** received (inbound); blocked = stopped by the send gate before reaching Meta; dry_run = WhatsApp not connected. */
/** sending: reserved in the log, waiting for Meta's answer. */
export type WaStatus = "received" | "sending" | "blocked" | "dry_run" | "sent" | "delivered" | "read" | "failed";

/** Every WhatsApp message in or out, with Meta's message id and delivery status. */
export interface WaMessage {
  id: string;
  lead_id: string | null;
  /** Meta's message id (wamid). Unique; null when the message never reached Meta. */
  wamid: string | null;
  direction: WaDirection;
  /** The buyer's (or Chetan's, for alerts) number, +91XXXXXXXXXX. */
  phone: string;
  kind: "text" | "template" | "media";
  body: string;
  template_name: string | null;
  status: WaStatus;
  /** Why a message was blocked or failed. */
  error: string | null;
  /** Who sent it: chetan (typed by hand), bot (automatic), system (alerts). */
  actor: "chetan" | "bot" | "system" | "buyer";
  automated: boolean;
  /** One-time id from the reply form, so a double click cannot send twice. */
  client_ref: string | null;
  created_at: string;
  status_at: string | null;
}

export type NewWaMessage = Omit<WaMessage, "id" | "created_at" | "status_at"> & { created_at?: string };

/** The global WhatsApp switches. Defaults are all safe: nothing leaves. */
export interface WhatsAppSettings {
  /** Master switch: when off, no WhatsApp message leaves the CRM at all, manual replies included. */
  outbound_enabled: boolean;
  /** When off, only messages Chetan types by hand (and alerts to Chetan) are sent. */
  automation_enabled: boolean;
  /** When on, messages go only to the numbers in test_numbers and to Chetan's own number. */
  test_mode: boolean;
  test_numbers: string[];
  updated_at: string | null;
}

export const SAFE_WHATSAPP_SETTINGS: WhatsAppSettings = {
  outbound_enabled: false,
  automation_enabled: false,
  test_mode: true,
  test_numbers: [],
  updated_at: null,
};
