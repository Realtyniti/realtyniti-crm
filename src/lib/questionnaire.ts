/*
 * The guided calling questionnaire, version 1.
 *
 * Kept as data so that admins can later edit it from Settings: every saved
 * call will point at the version it used, so old answers stay readable after
 * the questions change. Scripts are Hinglish and optional; agents expand them
 * when they need a line to say.
 */

import type { QuestionKey } from "./intake-sop";
import type { Purpose, Requirement } from "./types";

export interface QuestionOption {
  value: string;
  label: string;
}

/** A follow-up question shown only when one of `when` is picked in its parent. */
export interface FollowUpQuestion {
  key: string;
  label: string;
  when: string[];
  kind: "choice" | "datetime";
  options?: QuestionOption[];
}

export interface Question {
  key: string;
  label: string;
  multi: boolean;
  options: QuestionOption[];
  /** Offer a free-text "Other" answer. */
  allowOther: boolean;
  script: string;
  followUps?: FollowUpQuestion[];
}

export interface QuestionSection {
  key: string;
  title: string;
  questions: Question[];
}

export interface Questionnaire {
  version: number;
  sections: QuestionSection[];
}

const opts = (...labels: string[]): QuestionOption[] =>
  labels.map((label) => ({ value: label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""), label }));

/**
 * The areas both assistants offer, in one place. `stored` is what goes on the lead card
 * (the same names the WhatsApp parser produces, so filters and reports match).
 */
export const AREAS: { label: string; stored: string }[] = [
  { label: "Noida", stored: "Noida" },
  { label: "Noida Extension / Greater Noida West", stored: "Greater Noida West" },
  { label: "Greater Noida", stored: "Greater Noida" },
  { label: "Yamuna Expressway", stored: "Yamuna Expressway" },
  { label: "Ghaziabad", stored: "Ghaziabad" },
  { label: "Delhi NCR", stored: "Delhi NCR" },
];

const NOT_INTERESTED_REASONS = opts("Budget mismatch", "Location", "Already bought", "Just exploring", "Bad timing", "Other");

export const QUESTIONNAIRE_V1: Questionnaire = {
  version: 1,
  sections: [
    {
      key: "requirements",
      title: "Property requirements",
      questions: [
        {
          key: "property_type",
          label: "What type of property are you looking for?",
          multi: true,
          options: opts("1BHK", "2BHK", "3BHK", "4BHK", "Villa", "Independent Floor", "Plot", "Studio", "Commercial"),
          allowOther: true,
          script:
            "Sir/Ma'am, aap kis type ki property dekh rahe hain? 2BHK, 3BHK, ya koi villa ya plot, taaki main aapko sahi options dikha sakun?",
        },
        {
          key: "budget",
          label: "What is your approximate budget?",
          multi: false,
          options: opts("Below ₹45 Lakhs", "₹45–55 Lakhs", "₹55–70 Lakhs", "₹70–85 Lakhs", "₹85 Lakhs–₹1 Crore", "Above ₹1 Crore"),
          allowOther: true,
          script:
            "Sir/Ma'am, aap approximately kis budget range mein property explore kar rahe hain, taaki main aapko suitable options suggest kar sakun?",
        },
        {
          key: "location",
          label: "Which location do you prefer?",
          multi: true,
          options: opts(...AREAS.map((a) => a.label)),
          allowOther: true,
          script:
            "Aapko kaunsa area zyada convenient lagega? Noida, Noida Extension, Greater Noida, Yamuna Expressway ya Ghaziabad? Office ya family ke hisaab se koi preference hai?",
        },
        {
          key: "possession",
          label: "What is your preferred possession status?",
          multi: false,
          options: opts("Ready to Move", "Under Construction", "Either", "Not Decided"),
          allowOther: true,
          script: "Aap ready-to-move property chahte hain, ya under-construction bhi chalega agar price aur payment plan achha ho?",
        },
      ],
    },
    {
      key: "intent",
      title: "Buying intent",
      questions: [
        {
          key: "timeline",
          label: "When are you planning to purchase?",
          multi: false,
          options: opts("Immediately", "Within 30 Days", "Within 1–3 Months", "Within 3–6 Months", "After 6 Months", "Just Exploring"),
          allowOther: true,
          script: "Aap kab tak final decision lena chahte hain? Agar sahi property mil jaaye toh kya aap jaldi book karna chahenge?",
        },
        {
          key: "purpose",
          label: "What is your buying purpose?",
          multi: false,
          options: opts("Self-Use", "Investment", "Both"),
          allowOther: true,
          script: "Yeh property aap khud rehne ke liye le rahe hain, ya investment ke point of view se?",
        },
        {
          key: "finance",
          label: "How are you planning to finance the purchase?",
          multi: false,
          options: opts("Home Loan", "Self-Funding", "Combination", "Not Decided"),
          allowOther: true,
          script: "Payment ke liye aap home loan lenge, ya self-funding? Taaki main aapko payment plan ke options bhi bata sakun.",
          followUps: [
            {
              key: "loan_approved",
              label: "Is the loan already approved?",
              when: ["home_loan", "combination"],
              kind: "choice",
              options: opts("Approved", "In process", "Not yet applied"),
            },
          ],
        },
        {
          key: "shortlisted",
          label: "Have you already visited or shortlisted any properties?",
          multi: false,
          options: opts("Yes", "No", "Currently Comparing"),
          allowOther: true,
          script: "Kya aapne abhi tak koi project visit ya shortlist kiya hai? Kaunse projects compare kar rahe hain?",
        },
      ],
    },
    {
      key: "next",
      title: "Next steps",
      questions: [
        {
          key: "site_visit",
          label: "Would you like to schedule a site visit?",
          multi: false,
          options: opts("Today", "Tomorrow", "This Weekend", "Next Week", "Later", "Not Interested"),
          allowOther: true,
          script:
            "Sir/Ma'am, ek baar site dekh lenge toh aapko project ka better idea milega. Kya aap is weekend ya kal visit plan kar sakte hain? Pickup bhi arrange ho sakta hai.",
          followUps: [
            { key: "visit_at", label: "Visit date and time", when: ["today", "tomorrow", "this_weekend", "next_week"], kind: "datetime" },
            { key: "visit_not_interested_reason", label: "Reason", when: ["not_interested"], kind: "choice", options: NOT_INTERESTED_REASONS },
          ],
        },
        {
          key: "next_action",
          label: "What should happen next?",
          multi: true,
          options: opts("Send Project Details", "Send Brochure", "Schedule Site Visit", "Call Back", "Follow-up Later", "Not Interested"),
          allowOther: true,
          script: "Main aapko WhatsApp par project details aur brochure bhej deta/deti hoon. Aapse dobara kab baat karna theek rahega?",
          followUps: [
            { key: "callback_at", label: "Call back on", when: ["call_back", "follow_up_later"], kind: "datetime" },
            { key: "not_interested_reason", label: "Reason", when: ["not_interested"], kind: "choice", options: NOT_INTERESTED_REASONS },
          ],
        },
      ],
    },
  ],
};

/** How a call ended. Only "connected" counts as a conversation. */
export const CALL_OUTCOMES = [
  { value: "connected", label: "Connected", conversation: true },
  { value: "no_answer", label: "No answer", conversation: false },
  { value: "busy", label: "Busy", conversation: false },
  { value: "rejected", label: "Rejected", conversation: false },
  { value: "unreachable", label: "Switched off / unreachable", conversation: false },
  { value: "wrong_number", label: "Wrong number", conversation: false },
  { value: "callback", label: "Asked to call back", conversation: true },
] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number]["value"];

export interface Answer {
  values: string[];
  other?: string;
  skipped?: boolean;
  note?: string;
  /** Answers to follow-up questions, by their key. */
  extra?: Record<string, string>;
}

export function isAnswered(a: Answer | undefined): boolean {
  return !!a && (a.skipped || a.values.length > 0 || !!a.other?.trim());
}

/*
 * One question bank for both assistants. The WhatsApp Lead Catcher asks the five
 * qualifying questions in intake-sop.ts; each one is the same question as a calling
 * question below, and both write the same fields on the lead card.
 * WhatsApp template keys stay "question.<WhatsApp key>" (e.g. question.micro_market),
 * so the templates Chetan already approved keep working.
 */
export const WHATSAPP_TO_CALL_KEY = {
  budget: "budget",
  micro_market: "location",
  property_type: "property_type",
  purpose: "purpose",
  timeline: "timeline",
} as const satisfies Record<QuestionKey, string>;

const LAKH = 100_000;
const BUDGET: Record<string, { min: number | null; max: number | null }> = {
  below_45_lakhs: { min: null, max: 45 * LAKH },
  "45_55_lakhs": { min: 45 * LAKH, max: 55 * LAKH },
  "55_70_lakhs": { min: 55 * LAKH, max: 70 * LAKH },
  "70_85_lakhs": { min: 70 * LAKH, max: 85 * LAKH },
  "85_lakhs_1_crore": { min: 85 * LAKH, max: 100 * LAKH },
  above_1_crore: { min: 100 * LAKH, max: null },
};
const TIMELINE: Record<string, number> = {
  immediately: 1,
  within_30_days: 1,
  within_1_3_months: 3,
  within_3_6_months: 6,
  after_6_months: 12,
  just_exploring: 12,
};
/** "Both" is stored as investment: the card has one purpose, and investment changes the pitch more. */
const PURPOSE: Record<string, Purpose> = { self_use: "end_use", investment: "investment", both: "investment" };
const VISIT_YES = new Set(["today", "tomorrow", "this_weekend", "next_week"]);

function labelOf(questionKey: string, value: string): string | undefined {
  for (const s of QUESTIONNAIRE_V1.sections) {
    const q = s.questions.find((x) => x.key === questionKey);
    if (q) return q.options.find((o) => o.value === value)?.label;
  }
  return undefined;
}

/**
 * The lead-card fields a set of calling answers fills in: the same fields the WhatsApp
 * Lead Catcher fills. Unanswered, skipped or "Other" answers leave a field alone.
 */
export function answersToRequirement(answers: Record<string, Answer | undefined>): Partial<Requirement> {
  const out: Partial<Requirement> = {};
  const first = (k: string) => {
    const a = answers[k];
    return a && !a.skipped ? a.values[0] : undefined;
  };

  const budget = first("budget");
  if (budget && BUDGET[budget]) {
    out.budget_min_inr = BUDGET[budget].min;
    out.budget_max_inr = BUDGET[budget].max;
  }
  const loc = first("location");
  const area = loc ? AREAS.find((a) => opts(a.label)[0].value === loc) : undefined;
  if (area) out.micro_market = area.stored;
  const type = first("property_type");
  if (type) out.property_type = labelOf("property_type", type) ?? null;
  const purpose = first("purpose");
  if (purpose && PURPOSE[purpose]) out.purpose = PURPOSE[purpose];
  const timeline = first("timeline");
  if (timeline && TIMELINE[timeline] != null) out.timeline_months = TIMELINE[timeline];
  const visit = first("site_visit");
  if (visit && VISIT_YES.has(visit)) out.agreed_site_visit = true;
  return out;
}
