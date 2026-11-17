import type { Lead, LeadEvent, LeadTouch, Project, WaMessage } from "../types";
import type { Store } from "./types";

/*
 * The lead store as a view-only reviewer (Meta App Review) sees it: buyers' phone numbers and
 * emails are masked everywhere they appear, including inside timeline notes and messages, and
 * raw platform payloads are dropped. Used together with the read-only store, so nothing is written.
 */

/** +919876543210 -> +91 98xxx xxx10 */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  const local = digits.length > 10 ? digits.slice(-10) : digits;
  const cc = digits.length > 10 ? `+${digits.slice(0, digits.length - 10)} ` : "";
  if (local.length < 4) return "xxxx";
  return `${cc}${local.slice(0, 2)}xxx xxx${local.slice(-2)}`;
}

/** ravi.kumar@gmail.com -> r***@gmail.com */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return email ?? null;
  const at = email.indexOf("@");
  return at > 0 ? `${email[0]}***${email.slice(at)}` : "***";
}

const PHONE_IN_TEXT = /\+?\d[\d\s-]{8,}\d/g;
const EMAIL_IN_TEXT = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

/** Masks phone numbers and emails inside free text (notes, alerts, messages). */
export function maskText(text: string): string;
export function maskText(text: string | null): string | null;
export function maskText(text: string | null): string | null {
  if (!text) return text;
  return text
    .replace(PHONE_IN_TEXT, (m) => (m.replace(/\D/g, "").length >= 10 ? maskPhone(m) : m))
    .replace(EMAIL_IN_TEXT, (m) => maskEmail(m) ?? m);
}

const lead = (l: Lead | null): Lead | null =>
  l && { ...l, phone: maskPhone(l.phone), email: maskEmail(l.email), notes: maskText(l.notes), needs_chetan_reason: maskText(l.needs_chetan_reason) };
const event = (e: LeadEvent): LeadEvent => ({ ...e, body: maskText(e.body) });
const touch = (t: LeadTouch): LeadTouch => ({ ...t, raw: null, external_id: null });
const wa = (m: WaMessage): WaMessage => ({ ...m, phone: maskPhone(m.phone), body: maskText(m.body), error: maskText(m.error) });
const project = (p: Project | null): Project | null => p && { ...p, developer_contact_phone: p.developer_contact_phone ? maskPhone(p.developer_contact_phone) : null };

export function maskedStore(store: Store): Store {
  const overrides: Partial<Store> = {
    getLead: async (id) => lead(await store.getLead(id)),
    // Looking a buyer up by phone number would confirm who is a lead: not for a reviewer.
    findLeadByPhone: async () => null,
    listLeads: async (filter) => (await store.listLeads(filter)).map((l) => lead(l)!),
    queryLeads: async (query) => {
      // Search by name only, so typing a number can't confirm it belongs to a buyer.
      const q = query.q?.replace(/\d/g, "").trim() || null;
      const page = await store.queryLeads({ ...query, q });
      return { ...page, rows: page.rows.map((l) => lead(l)!) };
    },
    listTouches: async (id) => (await store.listTouches(id)).map(touch),
    listEvents: async (id) => (await store.listEvents(id)).map(event),
    listWaMessages: async (id) => (await store.listWaMessages(id)).map(wa),
    listProjects: async () => (await store.listProjects()).map((p) => project(p)!),
    getProject: async (id) => project(await store.getProject(id)),
    getWhatsAppSettings: async () => {
      const s = await store.getWhatsAppSettings();
      return { ...s, test_numbers: s.test_numbers.map(maskPhone) };
    },
  };
  return new Proxy(store, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && prop in overrides) return overrides[prop as keyof Store];
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
