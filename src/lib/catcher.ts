import { createHash } from "node:crypto";
import { classify, QUALIFYING_QUESTIONS, type QuestionKey } from "./intake-sop";
import { captureLead, closeLead, updateRequirement } from "./leads";
import { parseBudget, parseMicroMarket, parsePropertyType, parsePurpose, parseTimelineMonths } from "./parse";
import { checkMoney } from "./price-guard";
import type { Store } from "./store/types";
import { DEFAULT_BRAND, firstReplyKey, renderForSending, TemplateError } from "./templates";
import { formatBudget } from "./format";
import type { Lead, Requirement, WaMessage } from "./types";
import { applyStatus, type SendProblem } from "./wa-gate";
import { windowOpen, type InboundMessage, type SendResult, type StatusUpdate, type WhatsAppSender } from "./whatsapp";

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
/**
 * Adds a flag to the lead's timeline once. The flag's key is the lead plus a hash of its text, and
 * the store inserts it atomically against a unique key, so repeated hourly runs and overlapping
 * cron runs of the same blocked message create exactly one flag.
 */
export async function addFlagOnce(store: Store, leadId: string, body: string): Promise<void> {
  const key = `flag:${leadId}:${createHash("sha256").update(body).digest("hex").slice(0, 32)}`;
  await store.addEventOnce({ lead_id: leadId, kind: "flag", channel: "whatsapp", body }, key);
}

async function recordSend(store: Store, lead: Lead, r: SendResult, what: string): Promise<boolean> {
  // Already sent (or being sent) by an earlier trigger of the same message: nothing new to record.
  if (r.duplicate) return false;
  if (r.status === "blocked") {
    // A retried job (e.g. a reminder kept pending while sending is off) does not repeat the same flag.
    await addFlagOnce(store, lead.id, `Not sent: ${r.error ?? "blocked"} (${what.slice(0, 80)})`);
    return false;
  }
  // Failed or uncertain: the send gate has already flagged the lead for Chetan and alerted him (once).
  if (r.status === "failed" || r.status === "uncertain" || r.status === "sending") return false;
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
  /** What caused this message, e.g. "in:<wamid>" or "followup:<lead>:<due>". With the template key it is the message's send key. */
  trigger: string,
  vars: Record<string, string | null | undefined> = {},
): Promise<boolean> {
  const r = await sendApprovedResult(store, cfg, lead, key, trigger, vars);
  return !!r && !r.duplicate && (r.status === "sent" || r.status === "dry_run");
}

/**
 * Like sendApproved, but returns WhatsApp's result (null when the template is missing or not
 * approved), so a caller can tell "sent", "blocked, try later", "failed or uncertain" and
 * "already sent by another run" apart.
 */
export async function sendApprovedResult(
  store: Store,
  cfg: CatcherConfig,
  lead: Lead,
  key: string,
  trigger: string,
  vars: Record<string, string | null | undefined> = {},
): Promise<SendResult | null> {
  const t = await store.getTemplate(key);
  let text: string;
  try {
    if (!t) throw new TemplateError(`Template "${key}" does not exist.`);
    text = renderForSending(t, { name: lead.name?.split(" ")[0], micro_market: lead.micro_market, brand: lead.brand, ...vars });
  } catch (e) {
    if (!(e instanceof TemplateError)) throw e;
    await addFlagOnce(store, lead.id, `Not sent: ${e.message}`);
    return null;
  }
  const r = await cfg.sender.sendText(lead.phone, text, { leadId: lead.id, automated: true, actor: "bot", sendKey: `${trigger}:${key}` });
  if ((await recordSend(store, lead, r, text)) && !lead.first_reply_at) await store.updateLead(lead.id, { first_reply_at: new Date().toISOString() });
  return r;
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

/** `sendKey` is the alert's stable identity: the same alert is never sent twice. */
export async function alertChetan(store: Store, cfg: CatcherConfig, lead: Lead, line: string, sendKey: string): Promise<void> {
  if (!cfg.chetanPhone) {
    await store.addEvent({ lead_id: lead.id, kind: "flag", channel: null, body: `Alert not sent (CHETAN_WHATSAPP not set): ${line}` });
    return;
  }
  const ctx = { automated: true, actor: "system" as const, sendKey: `alert:${sendKey}` };
  const r = cfg.alertTemplate
    ? await cfg.sender.sendTemplate(cfg.chetanPhone, { ...cfg.alertTemplate, params: [line] }, ctx)
    : await cfg.sender.sendText(cfg.chetanPhone, line, ctx);
  if (r.duplicate) return;
  const prefix = r.status === "sent" ? "" : r.status === "dry_run" ? "[dry run] " : `[not sent: ${r.error ?? r.status}] `;
  await store.addEvent({ lead_id: lead.id, kind: "note", channel: null, body: `${prefix}Alert to Chetan: ${line}` });
}

/**
 * A message to a buyer may not have arrived. Puts it in front of Chetan: a flag on the timeline,
 * the "Needs a personal reply" banner (which also pauses the bot and the Follow-up Clock for this
 * lead until he clears it) and one alert. Nothing is ever resent.
 * Callers make sure this runs once per problem (a won reservation or compare-and-set); the alert
 * also carries a send key, so even a repeat could not alert twice.
 */
export async function flagForReview(store: Store, cfg: CatcherConfig, leadId: string, reason: string, sendKey: string): Promise<void> {
  const lead = await store.getLead(leadId);
  if (!lead) return;
  await store.addEvent({ lead_id: lead.id, kind: "flag", channel: "whatsapp", body: reason });
  if (!lead.needs_chetan) await store.updateLead(lead.id, { needs_chetan: true, needs_chetan_reason: reason });
  await alertChetan(store, cfg, lead, `⚠️ ${lead.name ?? lead.phone} ${lead.phone}: ${reason}`, sendKey);
}

const PROBLEM_TEXT: Record<SendProblem, string> = {
  failed: "WhatsApp refused the message, so it was not delivered",
  uncertain: "WhatsApp did not confirm the message; it may or may not have arrived. Check before sending again",
};

/** The send gate's report of a buyer message that may not have arrived (wired up in catcher-config). */
export async function reportSendProblem(store: Store, cfg: CatcherConfig, m: WaMessage, problem: SendProblem): Promise<void> {
  if (!m.lead_id) return;
  const why = m.error ? ` (${m.error.slice(0, 160)})` : "";
  await flagForReview(store, cfg, m.lead_id, `${PROBLEM_TEXT[problem]}${why}.`, `problem:${m.id}`);
}

/**
 * A delivery receipt from Meta. When a message Meta had accepted is later marked failed, the lead is
 * flagged and Chetan alerted, exactly once even if Meta repeats the webhook. Nothing is resent.
 */
export async function handleReceipt(store: Store, cfg: CatcherConfig, update: StatusUpdate): Promise<void> {
  const r = await applyStatus(store, update);
  if (!r?.newlyFailed || !r.message.lead_id || r.message.direction !== "out") return;
  if (cfg.chetanPhone && r.message.phone === cfg.chetanPhone) return;
  const why = update.error ?? "no reason given";
  await flagForReview(store, cfg, r.message.lead_id, `WhatsApp message failed to deliver (${why}).`, `failed:${update.wamid}`);
}

/** How long a reservation may stay "sending" before it is treated as uncertain. */
export const STUCK_AFTER_MS = 10 * 60_000;

/**
 * Hourly: a message still "sending" after ten minutes never got a recorded answer (the server stopped,
 * or the database write failed after Meta accepted it). It becomes "uncertain" and Chetan reviews it.
 * The compare-and-set means overlapping runs report each message once.
 */
export async function sweepStuckSends(store: Store, cfg: CatcherConfig, now = new Date()): Promise<number> {
  let n = 0;
  for (const m of await store.listStuckSending(new Date(now.getTime() - STUCK_AFTER_MS).toISOString())) {
    const updated = await store.updateWaMessageIf(m.id, ["sending"], {
      status: "uncertain",
      error: "The CRM has no record of WhatsApp's answer (it may have been sent)",
    });
    if (!updated) continue;
    n++;
    if (!(cfg.chetanPhone && m.phone === cfg.chetanPhone)) await reportSendProblem(store, cfg, updated, "uncertain");
  }
  return n;
}

function nextStep(lead: Lead): Step | null {
  for (const q of QUALIFYING_QUESTIONS) {
    if (!q.isAnswered(lead) && !lead.asked_questions.includes(q.key)) return q.key;
  }
  if (!lead.agreed_site_visit && !lead.asked_questions.includes(SITE_VISIT)) return SITE_VISIT;
  return null;
}

/** Ask the next unanswered question, or wrap up and route by tag when none are left. */
async function advance(store: Store, cfg: CatcherConfig, lead: Lead, trigger: string): Promise<Lead> {
  const step = nextStep(lead);
  if (step) {
    const key = `question.${step}${lead.prefers_hinglish ? ".hi" : ""}`;
    if (await sendApproved(store, cfg, lead, key, trigger)) {
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
    if (link) await sendApproved(store, cfg, lead, "catcher.hot_booking", trigger, { booking_link: link });
    else await sendApproved(store, cfg, lead, "catcher.hot_handoff", trigger);
    await alertChetan(store, cfg, lead, `🔥 Hot lead: ${lead.name ?? "Unnamed"} ${lead.phone} · ${requirementLine(lead)} · via ${lead.first_source}${lead.brand !== DEFAULT_BRAND ? ` (${lead.brand})` : ""}`, `${trigger}:hot`);
  } else if (temperature === "warm") {
    await sendApproved(store, cfg, lead, "warm.project_overview", trigger);
  } else {
    await sendApproved(store, cfg, lead, "catcher.cold_nurture", trigger);
  }
  return lead;
}

/**
 * A new lead arrived from Meta, the website or a manual entry. Outside the 24h
 * window only a Meta-registered opener template may be sent; the questions start
 * once the buyer replies.
 */
export async function greetNewLead(store: Store, cfg: CatcherConfig, lead: Lead, now = new Date()): Promise<void> {
  // One greeting per lead, ever: a repeated intake webhook cannot greet twice.
  const trigger = `greet:${lead.id}`;
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
    await alertChetan(store, cfg, lead, `💬 ${lead.name ?? lead.phone} asked about money in their enquiry: ${lead.needs_chetan_reason}`, `${trigger}:money`);
    return;
  }
  if (windowOpen(lead.last_inbound_at, now)) {
    if (await sendApproved(store, cfg, lead, firstReplyKey(lead.first_source), trigger)) await advance(store, cfg, lead, trigger);
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
    { leadId: lead.id, automated: true, actor: "bot", sendKey: `${trigger}:opener` },
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
    send_key: null,
    created_at: msg.timestamp,
  });
  if (!logged) return r.lead;
  // Everything sent because of this message carries its wamid, so reprocessing it cannot send twice.
  const trigger = `in:${msg.id}`;

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
    await alertChetan(store, cfg, lead, `💬 WhatsApp from ${lead.name ?? "a lead"} ${lead.phone}: "${msg.text.slice(0, 200)}"`, trigger);
    return lead;
  }

  if (lead.needs_chetan) {
    // Hold reply and alert only once, when the money question first appears.
    if (!flaggedBefore && checkMoney(msg.text, { incoming: true }).mentionsMoney) {
      await sendApproved(store, cfg, lead, "money_question.hold", trigger);
      await alertChetan(store, cfg, lead, `💬 Price question from ${lead.name ?? "a lead"} ${lead.phone}: "${msg.text.slice(0, 200)}"`, `${trigger}:price`);
    }
    return lead;
  }

  if (r.created || !lead.first_reply_at) {
    if (!(await sendApproved(store, cfg, lead, firstReplyKey(lead.first_source), trigger))) return lead;
    lead = (await store.getLead(lead.id))!;
    return advance(store, cfg, lead, trigger);
  }

  if (lead.awaiting_question) {
    const answer = answerFor(lead.awaiting_question as Step, msg.text);
    if (Object.keys(answer).length) lead = await updateRequirement(store, lead.id, answer, now);
    lead = await store.updateLead(lead.id, { awaiting_question: null });
    return advance(store, cfg, lead, trigger);
  }

  // Qualification already finished: the conversation is Chetan's (Niti takes this over in Phase 5).
  if (lead.status !== "new" && lead.status !== "qualifying" && nextStep(lead) === null) {
    await alertChetan(store, cfg, lead, `↩️ ${lead.name ?? lead.phone} replied: "${msg.text.slice(0, 200)}"`, trigger);
    return lead;
  }
  return advance(store, cfg, lead, trigger);
}
