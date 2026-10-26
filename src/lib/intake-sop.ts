import type { Requirement, Temperature } from "./types";

/*
 * Realtyniti Intake SOP (SYS-01), as code.
 *
 * PLACEHOLDER RULES: the blueprint asks Chetan to write the five questions in
 * his order and his hot/warm/cold rules as plain sentences (Next steps #2).
 * Until he does, these follow the blueprint's own examples. Change them here;
 * every system reads them from this one place.
 */

export type QuestionKey = "budget" | "micro_market" | "property_type" | "purpose" | "timeline";

export interface QualifyingQuestion {
  key: QuestionKey;
  /** Asked one at a time on WhatsApp, in this order. */
  ask: string;
  askHinglish: string;
  isAnswered: (r: Requirement) => boolean;
}

export const QUALIFYING_QUESTIONS: QualifyingQuestion[] = [
  {
    key: "budget",
    ask: "What budget range are you considering?",
    askHinglish: "Aapka budget kitna hai, roughly kis range mein?",
    isAnswered: (r) => r.budget_max_inr != null || r.budget_min_inr != null,
  },
  {
    key: "micro_market",
    ask: "Which area do you prefer: Noida sectors, Greater Noida West, or the Yamuna Expressway near the airport?",
    askHinglish: "Aap kaunsa area prefer karenge: Noida sectors, Greater Noida West, ya Yamuna Expressway (airport ke paas)?",
    isAnswered: (r) => !!r.micro_market,
  },
  {
    key: "property_type",
    ask: "What are you looking for: 2BHK, 3BHK, plot, studio or commercial?",
    askHinglish: "Aap kya dekh rahe hain: 2BHK, 3BHK, plot, studio ya commercial?",
    isAnswered: (r) => !!r.property_type,
  },
  {
    key: "purpose",
    ask: "Is this for your own use or as an investment?",
    askHinglish: "Yeh khud rehne ke liye hai ya investment ke liye?",
    isAnswered: (r) => !!r.purpose,
  },
  {
    key: "timeline",
    ask: "When are you planning to decide?",
    askHinglish: "Aap kab tak decide karna chahte hain?",
    isAnswered: (r) => r.timeline_months != null,
  },
];

export function unansweredQuestions(r: Requirement): QualifyingQuestion[] {
  return QUALIFYING_QUESTIONS.filter((q) => !q.isAnswered(r));
}

/** The one question to ask next, or null when all five are answered. */
export function nextQuestion(r: Requirement): QualifyingQuestion | null {
  return unansweredQuestions(r)[0] ?? null;
}

/** A buyer deciding within this many months is "deciding soon". */
export const DECIDING_SOON_MONTHS = 2;
export const WARM_TIMELINE_MONTHS = 6;

export interface Classification {
  temperature: Temperature;
  /** Plain-sentence reasons, shown on the card so Chetan can check the rule. */
  reasons: string[];
}

/**
 * Hot: budget given, location fixed, deciding within the window, and agreed to a site visit.
 * Warm: budget and location given, and deciding within six months or agreed to a visit.
 * Cold: everything else.
 *
 * The blueprint's hot rule also says "budget fits an active project"; that check
 * joins this function once the Project Book exists (Phase 5).
 */
export function classify(r: Requirement): Classification {
  const hasBudget = r.budget_max_inr != null || r.budget_min_inr != null;
  const hasLocation = !!r.micro_market;
  const timeline = r.timeline_months;

  const reasons: string[] = [];
  reasons.push(hasBudget ? "Budget given." : "Budget unknown.");
  reasons.push(hasLocation ? `Location fixed: ${r.micro_market}.` : "Location not fixed.");
  reasons.push(
    timeline == null ? "Timeline unknown." : `Deciding within ${timeline} month${timeline === 1 ? "" : "s"}.`,
  );
  reasons.push(r.agreed_site_visit ? "Agreed to a site visit." : "No site visit agreed yet.");

  if (hasBudget && hasLocation && timeline != null && timeline <= DECIDING_SOON_MONTHS && r.agreed_site_visit) {
    return { temperature: "hot", reasons };
  }
  if (hasBudget && hasLocation && ((timeline != null && timeline <= WARM_TIMELINE_MONTHS) || r.agreed_site_visit)) {
    return { temperature: "warm", reasons };
  }
  return { temperature: "cold", reasons };
}

/**
 * Follow-up cadence rule: a client deciding within two months is contacted on a
 * tighter rhythm than one who is only exploring. Days until next contact.
 */
export function followUpGapDays(r: Pick<Requirement, "timeline_months">): number {
  const t = r.timeline_months;
  if (t == null) return 3;
  if (t <= DECIDING_SOON_MONTHS) return 2;
  if (t <= WARM_TIMELINE_MONTHS) return 7;
  return 21;
}

export function nextFollowUpDate(r: Pick<Requirement, "timeline_months">, from: Date = new Date()): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + followUpGapDays(r));
  return d;
}
