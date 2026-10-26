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
  external_id?: string | null;
  message?: string | null;
  raw?: unknown;
  received_at?: string;
}
