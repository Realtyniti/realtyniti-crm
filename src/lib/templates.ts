import { checkMoney } from "./price-guard";
import type { LeadSource, MessageTemplate } from "./types";

/*
 * Starter templates for the Enquiry Script Skill (SYS-01). All start
 * UNAPPROVED: Chetan approves each once before first use (Next steps #5).
 * None may carry a price, payment plan, discount or offer.
 */
export const DEFAULT_TEMPLATES: Omit<MessageTemplate, "approved_at" | "updated_at">[] = [
  {
    key: "first_reply.meta",
    channel: "meta",
    purpose: "First reply to a Meta lead form",
    body: "Hi {{name}}, this is Chetan from Realtyniti. Thanks for your enquiry on Facebook/Instagram. I help buyers and investors across Noida, Greater Noida and the Yamuna Expressway. Can I ask a few quick questions so I share only what fits you?",
  },
  {
    key: "first_reply.youtube",
    channel: "youtube",
    purpose: "First reply to a YouTube comment asking for details",
    body: "Hi {{name}}, Chetan from Realtyniti here. Thanks for watching and asking on YouTube. Happy to help you shortlist the right project. A few quick questions first?",
  },
  {
    key: "first_reply.whatsapp",
    channel: "whatsapp",
    purpose: "First reply to a new WhatsApp message from an unknown number",
    body: "Hi {{name}}, thanks for reaching out to Realtyniti. I'm Chetan. To suggest the right projects in Noida, Greater Noida or the Yamuna Expressway, can I ask you a few quick questions?",
  },
  {
    key: "first_reply.website",
    channel: "website",
    purpose: "First reply to a website form",
    body: "Hi {{name}}, Chetan from Realtyniti here. I got your enquiry from our website. A few quick questions so I can shortlist the right projects for you?",
  },
  {
    key: "first_reply.referral",
    channel: "referral",
    purpose: "First reply to a referral",
    body: "Hi {{name}}, Chetan from Realtyniti here. {{referrer}} mentioned you're looking at property. Glad to help. Can I ask a few quick questions?",
  },
  {
    key: "money_question.hold",
    channel: null,
    purpose: "Reply when a buyer asks about price, payment plan or offers",
    body: "Good question, {{name}}. Chetan will personally share the latest sheet and details with you shortly.",
  },
  {
    key: "warm.project_overview",
    channel: null,
    purpose: "Pre-approved overview for warm leads (no figures)",
    body: "Hi {{name}}, based on what you shared, here are a few projects in {{micro_market}} worth a look. Would you like to plan a site visit this weekend?",
  },
];

const FALLBACKS: Record<string, string> = {
  name: "there",
  micro_market: "your preferred area",
  referrer: "A friend",
};

export class TemplateError extends Error {}

/** Problems that would stop a template being approved. */
export function templateProblems(body: string): string[] {
  const money = checkMoney(body);
  return money.mentionsMoney ? [`Mentions money (${money.matched.join(", ")}); Chetan sends these himself.`] : [];
}

/**
 * Fill a template for automatic sending. Refuses if the template is not
 * approved, or if the filled text mentions money (a variable could smuggle it in).
 */
export function renderForSending(t: MessageTemplate, vars: Record<string, string | null | undefined>): string {
  if (!t.approved_at) throw new TemplateError(`Template "${t.key}" is not approved yet.`);
  const text = t.body.replace(
    /\{\{(\w+)\}\}/g,
    (_, k: string) => (vars[k] ?? "").toString().trim() || FALLBACKS[k] || "",
  );
  const money = checkMoney(text);
  if (money.mentionsMoney) {
    throw new TemplateError(`Message for "${t.key}" mentions money (${money.matched.join(", ")}); held for Chetan.`);
  }
  return text.replace(/\s+([,.])/g, "$1");
}

export function firstReplyKey(source: LeadSource): string {
  const known = DEFAULT_TEMPLATES.some((t) => t.key === `first_reply.${source}`);
  return known ? `first_reply.${source}` : "first_reply.whatsapp";
}
