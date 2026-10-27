/*
 * The guided calling questionnaire, version 1.
 *
 * Kept as data so that admins can later edit it from Settings: every saved
 * call will point at the version it used, so old answers stay readable after
 * the questions change. Scripts are Hinglish and optional; agents expand them
 * when they need a line to say.
 */

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
          options: opts("1BHK", "2BHK", "3BHK", "4BHK", "Villa", "Independent Floor", "Plot"),
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
          options: opts("Noida Extension", "Greater Noida", "Noida", "Ghaziabad", "Delhi NCR — Other"),
          allowOther: true,
          script:
            "Aapko kaunsa area zyada convenient lagega? Noida Extension, Greater Noida, Noida ya Ghaziabad? Office ya family ke hisaab se koi preference hai?",
        },
        {
          key: "possession",
          label: "What is your preferred possession status?",
          multi: false,
          options: opts("Ready to Move", "Under Construction", "Either", "Not Decided"),
          allowOther: false,
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
          allowOther: false,
          script: "Aap kab tak final decision lena chahte hain? Agar sahi property mil jaaye toh kya aap jaldi book karna chahenge?",
        },
        {
          key: "purpose",
          label: "What is your buying purpose?",
          multi: false,
          options: opts("Self-Use", "Investment", "Both"),
          allowOther: false,
          script: "Yeh property aap khud rehne ke liye le rahe hain, ya investment ke point of view se?",
        },
        {
          key: "finance",
          label: "How are you planning to finance the purchase?",
          multi: false,
          options: opts("Home Loan", "Self-Funding", "Combination", "Not Decided"),
          allowOther: false,
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
          allowOther: false,
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
          allowOther: false,
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
