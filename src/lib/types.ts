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
