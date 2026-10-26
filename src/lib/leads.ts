import { classify, nextFollowUpDate, unansweredQuestions, QUALIFYING_QUESTIONS } from "./intake-sop";
import { normalisePhone } from "./phone";
import { checkMoney } from "./price-guard";
import type { LeadPatch, Store } from "./store/types";
import { DEFAULT_BRAND, DEFAULT_TEMPLATES, templateProblems } from "./templates";
import type { Lead, LeadInput, Requirement } from "./types";

export class LeadError extends Error {}

const REQUIREMENT_KEYS = [
  "budget_min_inr",
  "budget_max_inr",
  "micro_market",
  "property_type",
  "purpose",
  "timeline_months",
] as const satisfies readonly (keyof Requirement)[];

function requirementOf(l: Partial<Requirement>): Requirement {
  return {
    budget_min_inr: l.budget_min_inr ?? null,
    budget_max_inr: l.budget_max_inr ?? null,
    micro_market: l.micro_market ?? null,
    property_type: l.property_type ?? null,
    purpose: l.purpose ?? null,
    timeline_months: l.timeline_months ?? null,
    agreed_site_visit: l.agreed_site_visit ?? false,
  };
}

/** No temperature until at least one qualifying question has an answer. */
function temperatureFor(r: Requirement): Lead["temperature"] {
  return unansweredQuestions(r).length === QUALIFYING_QUESTIONS.length && !r.agreed_site_visit
    ? null
    : classify(r).temperature;
}

export interface CaptureResult {
  lead: Lead;
  created: boolean;
  /** The same platform event was delivered twice (webhook retry); nothing changed. */
  duplicateDelivery: boolean;
  flaggedForChetan: boolean;
}

/**
 * Lead Card intake (F-00). Every channel calls this. A phone number already on a
 * card adds to that card instead of creating a second one; known answers are
 * never wiped by a channel that knows less.
 */
export async function captureLead(store: Store, input: LeadInput, now = new Date()): Promise<CaptureResult> {
  const phone = normalisePhone(input.phone);
  if (!phone) throw new LeadError(`Not a valid phone number: "${input.phone}"`);

  if (input.external_id) {
    const seen = await store.findTouch(input.source, input.external_id);
    if (seen) {
      const lead = await store.getLead(seen.lead_id);
      if (lead) return { lead, created: false, duplicateDelivery: true, flaggedForChetan: lead.needs_chetan };
    }
  }

  const money = checkMoney(input.message, { incoming: true });
  const existing = await store.findLeadByPhone(phone);
  let lead: Lead;
  let created = false;

  if (!existing) {
    const req = requirementOf(input);
    lead = await store.insertLead({
      name: input.name?.trim() || null,
      phone,
      email: input.email?.trim() || null,
      ...req,
      interest_level: null,
      temperature: temperatureFor(req),
      status: "new",
      first_source: input.source,
      lost_reason: null,
      needs_chetan: money.mentionsMoney,
      needs_chetan_reason: money.mentionsMoney ? `Asked about ${money.matched.join(", ")}` : null,
      next_follow_up_at: nextFollowUpDate(req, now).toISOString(),
      first_reply_at: null,
      notes: null,
      awaiting_question: null,
      asked_questions: [],
      last_inbound_at: null,
      prefers_hinglish: false,
      brand: input.brand?.trim() || DEFAULT_BRAND,
      followups_unanswered: 0,
      last_followup_at: null,
    });
    created = true;
  } else {
    const patch: LeadPatch = {};
    if (!existing.name && input.name?.trim()) patch.name = input.name.trim();
    if (!existing.email && input.email?.trim()) patch.email = input.email.trim();
    for (const k of REQUIREMENT_KEYS) {
      if (existing[k] == null && input[k] != null) Object.assign(patch, { [k]: input[k] });
    }
    if (input.agreed_site_visit && !existing.agreed_site_visit) patch.agreed_site_visit = true;
    if (money.mentionsMoney && !existing.needs_chetan) {
      patch.needs_chetan = true;
      patch.needs_chetan_reason = `Asked about ${money.matched.join(", ")}`;
    }
    // A closed lead that comes back in is a live lead again.
    if (existing.status === "lost") Object.assign(patch, { status: "new", lost_reason: null });
    const req = requirementOf({ ...existing, ...patch });
    patch.temperature = temperatureFor(req);
    lead = await store.updateLead(existing.id, patch);
  }

  await store.addTouch({
    lead_id: lead.id,
    source: input.source,
    external_id: input.external_id ?? null,
    raw: input.raw ?? null,
    received_at: input.received_at ?? now.toISOString(),
  });
  await store.addEvent({
    lead_id: lead.id,
    kind: "note",
    channel: input.source,
    body: created ? `New enquiry via ${input.source}.` : `Same client arrived again via ${input.source}.`,
  });
  if (input.message?.trim()) {
    await store.addEvent({ lead_id: lead.id, kind: "message_in", channel: input.source, body: input.message.trim() });
  }
  if (money.mentionsMoney) {
    await store.addEvent({
      lead_id: lead.id,
      kind: "flag",
      channel: input.source,
      body: `Money came up (${money.matched.join(", ")}). Automation stopped; Chetan replies personally.`,
    });
  }

  return { lead, created, duplicateDelivery: false, flaggedForChetan: lead.needs_chetan };
}

/** Chetan editing the card's answers by hand. Re-tags and resets the follow-up date. */
export async function updateRequirement(
  store: Store,
  id: string,
  changes: Partial<Requirement> & { name?: string | null; email?: string | null; notes?: string | null },
  now = new Date(),
): Promise<Lead> {
  const lead = await store.getLead(id);
  if (!lead) throw new LeadError("Lead not found");
  const req = requirementOf({ ...lead, ...changes });
  const before = lead.temperature;
  const temperature = temperatureFor(req);
  const updated = await store.updateLead(id, {
    ...changes,
    temperature,
    status: lead.status === "new" && temperature ? "qualifying" : lead.status,
    next_follow_up_at: nextFollowUpDate(req, now).toISOString(),
  });
  if (before !== temperature) {
    await store.addEvent({
      lead_id: id,
      kind: "status_change",
      channel: null,
      body: `Tagged ${temperature ?? "untagged"} (was ${before ?? "untagged"}).`,
    });
  }
  return updated;
}

/** Closing a lead. Lost needs a reason, so the lost list is never blank. */
export async function closeLead(
  store: Store,
  id: string,
  outcome: "converted" | "lost",
  reason?: string | null,
): Promise<Lead> {
  if (outcome === "lost" && !reason?.trim()) throw new LeadError("A lost reason is required to close a lead.");
  const lead = await store.getLead(id);
  if (!lead) throw new LeadError("Lead not found");
  const updated = await store.updateLead(id, {
    status: outcome,
    lost_reason: outcome === "lost" ? reason!.trim() : null,
    next_follow_up_at: null,
  });
  await store.addEvent({
    lead_id: id,
    kind: "status_change",
    channel: null,
    body: outcome === "lost" ? `Closed as lost: ${reason!.trim()}` : "Marked converted.",
  });
  return updated;
}

/** Chetan has dealt with the money question; automation may resume. */
export async function clearChetanFlag(store: Store, id: string): Promise<Lead> {
  const updated = await store.updateLead(id, { needs_chetan: false, needs_chetan_reason: null, followups_unanswered: 0 });
  await store.addEvent({ lead_id: id, kind: "note", channel: null, body: "Chetan cleared the flag." });
  return updated;
}

export async function ensureDefaultTemplates(store: Store): Promise<void> {
  const existing = new Set((await store.listTemplates()).map((t) => t.key));
  for (const t of DEFAULT_TEMPLATES) {
    if (!existing.has(t.key)) await store.upsertTemplate({ ...t, approved_at: null });
  }
}

export async function saveTemplate(store: Store, key: string, body: string, approve: boolean, now = new Date()) {
  const t = await store.getTemplate(key);
  if (!t) throw new LeadError("Template not found");
  const problems = templateProblems(body);
  if (approve && problems.length) throw new LeadError(problems.join(" "));
  return store.upsertTemplate({
    ...t,
    body,
    approved_at: approve ? now.toISOString() : body === t.body ? t.approved_at : null,
  });
}
