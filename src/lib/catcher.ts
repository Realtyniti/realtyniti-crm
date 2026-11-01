import { classify, QUALIFYING_QUESTIONS, type QuestionKey } from "./intake-sop";
import { captureLead, closeLead, updateRequirement } from "./leads";
import { parseBudget, parseMicroMarket, parsePropertyType, parsePurpose, parseTimelineMonths } from "./parse";
import { checkMoney } from "./price-guard";
import type { Store } from "./store/types";
import { DEFAULT_BRAND, firstReplyKey, renderForSending, TemplateError } from "./templates";
import { formatBudget } from "./format";
import type { Lead, Requirement } from "./types";
import { windowOpen, type InboundMessage, type SendResult, type WhatsAppSender } from "./whatsapp";

/*
 * Realtyniti Lead Catcher (SYS-02). Greets every new enquiry, asks the five
 * qualifying questions one at a time on WhatsApp, tags hot/warm/cold, and puts
 * hot leads in front of Chetan. Stops the moment money comes up.
 */

export interface CatcherConfig {
  sender: WhatsAppSender;
  /** Chetan's own WhatsApp number, for hot-lead and price-question alerts. */
  chetanPhone: string | null;
  /** Meta-registered template for first contact outside the 24h window; {{1}} = buyer name, {{2}} = brand. */
  openerTemplate: { name: string; language: string } | null;
  /** Meta-registered template for alerts to Chetan; {{1}} = the alert line. */
  alertTemplate: { name: string; language: string } | null;
  /** Meta-registered follow-up template for outside the 24h window; {{1}} = buyer first name, {{2}} = brand. */
  followupTemplate?: { name: string; language: string } | null;
  /** Site Visit Booker link for a lead, when bookings are set up. */
  bookingUrl?: (leadId: string) => string | null;
  /**
   * Whether the bot may message this lead on its own: global switches plus Chetan's
   * per-lead OK (see wa-gate.ts). Absent means yes, which only tests rely on.
   */
  canAutomate?: (lead: Lead) => Promise<boolean>;
}

/** Writes what happened to an outgoing message on the card. Returns true when it went out. */
async function recordSend(store: Store, lead: Lead, r: SendResult, what: string): Promise<boolean> {
  if (r.status === "blocked") {
    await store.addEvent({ lead_id: lead.id, kind: "flag", channel: "whatsapp", body: `Not sent: ${r.error ?? "blocked"} (${what.slice(0, 80)})` });
    return false;
  }
  if (r.status === "failed") {
    await store.addEvent({ lead_id: lead.id, kind: "flag", channel: "whatsapp", body: `WhatsApp message failed: ${r.error ?? "unknown error"}` });
    return false;
  }
  await store.addEvent({
    lead_id: lead.id,
    kind: "message_out",
    channel: "whatsapp",
    body: r.status === "sent" ? what : `[dry run, WhatsApp not connected] ${what}`,
  });
  return true;
}

const SITE_VISIT = "site_visit";
type Step = QuestionKey | typeof SITE_VISIT;

const HINGLISH = /\b(hai|hain|kya|mein|chahiye|nahi|nahin|haan|ji|aap|kitna|kab|ghar|mujhe|hum|bhai|accha|achha|theek|lena|dekhna)\b/i;

export function looksHinglish(text: string): boolean {
  return HINGLISH.test(text);
}

const YES = /\b(yes|yeah|yep|yup|haan|han|ha|sure|ok|okay|definitely|zaroor|jarur|ji)\b/i;
const STOP = /^\s*(stop|unsubscribe|band karo|mat bhejo)\s*[.!]*\s*$/i;
const NO = /\b(no|nope|nahi|nahin|not now|later|baad mein)\b/i;

/** Reads the buyer's reply to the question we asked into card fields. */
export function answerFor(step: Step, text: string): Partial<Requirement> {
  switch (step) {
    case "budget": {
      const b = parseBudget(text);
      return b ? { budget_min_inr: b.min, budget_max_inr: b.max } : {};
    }
    case "micro_market":
      return { micro_market: parseMicroMarket(text) };
    case "property_type":
      return { property_type: parsePropertyType(text) };
    case "purpose": {
      const p = parsePurpose(text);
      return p ? { purpose: p } : {};
    }
    case "timeline": {
      const t = parseTimelineMonths(text);
      return t != null ? { timeline_months: t } : {};
    }
    case SITE_VISIT:
      if (NO.test(text)) return { agreed_site_visit: false };
      return YES.test(text) ? { agreed_site_visit: true } : {};
  }
}

/** Sends one of Chetan's approved templates as free text. Holds it (and says so on the card) if not approved. */
export async function sendApproved(
  store: Store,
  cfg: CatcherConfig,
  lead: Lead,
  key: string,
  vars: Record<string, string | null | undefined> = {},
): Promise<boolean> {
  const t = await store.getTemplate(key);
  let text: string;
  try {
    if (!t) throw new TemplateError(`Template "${key}" does not exist.`);
    text = renderForSending(t, { name: lead.name?.split(" ")[0], micro_market: lead.micro_market, brand: lead.brand, ...vars });
  } catch (e) {
    if (!(e instanceof TemplateError)) throw e;
    await store.addEvent({ lead_id: lead.id, kind: "flag", channel: "whatsapp", body: `Not sent: ${e.message}` });
    return false;
  }
  const r = await cfg.sender.sendText(lead.phone, text, { leadId: lead.id, automated: true, actor: "bot" });
  if (!(await recordSend(store, lead, r, text))) return false;
  if (!lead.first_reply_at) await store.updateLead(lead.id, { first_reply_at: new Date().toISOString() });
  return true;
}

export function requirementLine(l: Lead): string {
  return [
    formatBudget(l.budget_min_inr, l.budget_max_inr),
    l.property_type,
    l.micro_market,
    l.timeline_months != null ? `deciding in ${l.timeline_months} mo` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export async function alertChetan(store: Store, cfg: CatcherConfig, lead: Lead, line: string): Promise<void> {
  if (!cfg.chetanPhone) {
    await store.addEvent({ lead_id: lead.id, kind: "flag", channel: null, body: `Alert not sent (CHETAN_WHATSAPP not set): ${line}` });
    return;
  }
  const ctx = { automated: true, actor: "system" as const };
  const r = cfg.alertTemplate
    ? await cfg.sender.sendTemplate(cfg.chetanPhone, { ...cfg.alertTemplate, params: [line] }, ctx)
    : await cfg.sender.sendText(cfg.chetanPhone, line, ctx);
  const prefix = r.status === "sent" ? "" : r.status === "dry_run" ? "[dry run] " : `[not sent: ${r.error ?? r.status}] `;
  await store.addEvent({ lead_id: lead.id, kind: "note", channel: null, body: `${prefix}Alert to Chetan: ${line}` });
}

function nextStep(lead: Lead): Step | null {
  for (const q of QUALIFYING_QUESTIONS) {
    if (!q.isAnswered(lead) && !lead.asked_questions.includes(q.key)) return q.key;
  }
  if (!lead.agreed_site_visit && !lead.asked_questions.includes(SITE_VISIT)) return SITE_VISIT;
  return null;
}

/** Ask the next unanswered question, or wrap up and route by tag when none are left. */
async function advance(store: Store, cfg: CatcherConfig, lead: Lead): Promise<Lead> {
  const step = nextStep(lead);
  if (step) {
    const key = `question.${step}${lead.prefers_hinglish ? ".hi" : ""}`;
    if (await sendApproved(store, cfg, lead, key)) {
      return store.updateLead(lead.id, {
        awaiting_question: step,
        asked_questions: [...lead.asked_questions, step],
        status: lead.status === "new" ? "qualifying" : lead.status,
      });
    }
    return lead;
  }

  const { temperature } = classify(lead);
  lead = await store.updateLead(lead.id, {
    awaiting_question: null,
    temperature,
    status: lead.status === "new" || lead.status === "qualifying" ? "qualified" : lead.status,
  });
  if (temperature === "hot") {
    // Hot leads get the Site Visit Booker link when bookings are set up.
    const link = cfg.bookingUrl?.(lead.id);
    if (link) await sendApproved(store, cfg, lead, "catcher.hot_booking", { booking_link: link });
    else await sendApproved(store, cfg, lead, "catcher.hot_handoff");
    await alertChetan(store, cfg, lead, `🔥 Hot lead: ${lead.name ?? "Unnamed"} ${lead.phone} · ${requirementLine(lead)} · via ${lead.first_source}${lead.brand !== DEFAULT_BRAND ? ` (${lead.brand})` : ""}`);
  } else if (temperature === "warm") {
    await sendApproved(store, cfg, lead, "warm.project_overview");
  } else {
    await sendApproved(store, cfg, lead, "catcher.cold_nurture");
  }
  return lead;
}

/**
 * A new lead arrived from Meta, the website or a manual entry. Outside the 24h
 * window only a Meta-registered opener template may be sent; the questions start
 * once the buyer replies.
 */
export async function greetNewLead(store: Store, cfg: CatcherConfig, lead: Lead, now = new Date()): Promise<void> {
  if (cfg.canAutomate && !(await cfg.canAutomate(lead))) {
    await store.addEvent({
      lead_id: lead.id,
      kind: "note",
      channel: "whatsapp",
      body: "No automatic WhatsApp sent: automatic messages are switched off or not allowed for this lead. Call or message them yourself.",
    });
    return;
  }
  if (lead.needs_chetan) {
    await alertChetan(store, cfg, lead, `💬 ${lead.name ?? lead.phone} asked about money in their enquiry: ${lead.needs_chetan_reason}`);
    return;
  }
  if (windowOpen(lead.last_inbound_at, now)) {
    if (await sendApproved(store, cfg, lead, firstReplyKey(lead.first_source))) await advance(store, cfg, lead);
    return;
  }
  if (!cfg.openerTemplate) {
    await store.addEvent({
      lead_id: lead.id,
      kind: "flag",
      channel: "whatsapp",
      body: "No first message sent: the WhatsApp opener template is not set up yet. Call or message this lead yourself.",
    });
    return;
  }
  const r = await cfg.sender.sendTemplate(
    lead.phone,
    { ...cfg.openerTemplate, params: [lead.name?.split(" ")[0] ?? "there", lead.brand] },
    { leadId: lead.id, automated: true, actor: "bot" },
  );
  if (await recordSend(store, lead, r, `Sent WhatsApp opener (${cfg.openerTemplate.name}).`)) {
    await store.updateLead(lead.id, { first_reply_at: now.toISOString() });
  }
}

/** A buyer wrote to Chetan's business WhatsApp number. */
export async function handleInbound(store: Store, cfg: CatcherConfig, msg: InboundMessage, now = new Date()): Promise<Lead> {
  const flaggedBefore = (await store.findLeadByPhone(msg.from))?.needs_chetan ?? false;
  const r = await captureLead(
    store,
    {
      source: "whatsapp",
      phone: msg.from,
      name: msg.name,
      message: msg.text,
      external_id: msg.id,
      received_at: msg.timestamp,
      autoWhatsApp: true,
    },
    now,
  );
  if (r.duplicateDelivery) return r.lead;
  // The message log keeps every inbound message once (wamid is unique); a duplicate stops here too.
  const logged = await store.addWaMessage({
    lead_id: r.lead.id,
    wamid: msg.id,
    direction: "in",
    phone: msg.from,
    kind: msg.kind ?? "text",
    body: msg.text,
    template_name: null,
    status: "received",
    error: null,
    actor: "buyer",
    automated: false,
    client_ref: null,
    created_at: msg.timestamp,
  });
  if (!logged) return r.lead;

  // "STOP" opts the buyer out: no reply, no follow-ups, and Chetan can see why on the card.
  if (STOP.test(msg.text)) {
    await store.updateLead(r.lead.id, { last_inbound_at: msg.timestamp, awaiting_question: null, wa_auto_allowed: false });
    return closeLead(store, r.lead.id, "lost", "Asked to stop messages");
  }

  let lead = await store.updateLead(r.lead.id, {
    last_inbound_at: msg.timestamp,
    followups_unanswered: 0,
    prefers_hinglish: r.lead.prefers_hinglish || looksHinglish(msg.text),
  });

  // Automation off, or Chetan hasn't allowed it for this lead: the message is on the card, Chetan hears about it, the bot stays quiet.
  if (cfg.canAutomate && !(await cfg.canAutomate(lead))) {
    await alertChetan(store, cfg, lead, `💬 WhatsApp from ${lead.name ?? "a lead"} ${lead.phone}: "${msg.text.slice(0, 200)}"`);
    return lead;
  }

  if (lead.needs_chetan) {
    // Hold reply and alert only once, when the money question first appears.
    if (!flaggedBefore && checkMoney(msg.text, { incoming: true }).mentionsMoney) {
      await sendApproved(store, cfg, lead, "money_question.hold");
      await alertChetan(store, cfg, lead, `💬 Price question from ${lead.name ?? "a lead"} ${lead.phone}: "${msg.text.slice(0, 200)}"`);
    }
    return lead;
  }

  if (r.created || !lead.first_reply_at) {
    if (!(await sendApproved(store, cfg, lead, firstReplyKey(lead.first_source)))) return lead;
    lead = (await store.getLead(lead.id))!;
    return advance(store, cfg, lead);
  }

  if (lead.awaiting_question) {
    const answer = answerFor(lead.awaiting_question as Step, msg.text);
    if (Object.keys(answer).length) lead = await updateRequirement(store, lead.id, answer, now);
    lead = await store.updateLead(lead.id, { awaiting_question: null });
    return advance(store, cfg, lead);
  }

  // Qualification already finished: the conversation is Chetan's (Niti takes this over in Phase 5).
  if (lead.status !== "new" && lead.status !== "qualifying" && nextStep(lead) === null) {
    await alertChetan(store, cfg, lead, `↩️ ${lead.name ?? lead.phone} replied: "${msg.text.slice(0, 200)}"`);
    return lead;
  }
  return advance(store, cfg, lead);
}
