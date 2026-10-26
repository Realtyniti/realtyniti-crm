/*
 * The one guardrail every automated message passes through: price, payment
 * plan, discount and offer belong to Chetan. Used two ways:
 *  - outgoing: a template or draft that mentions money is never sent automatically;
 *  - incoming: a buyer asking about money flags the card for Chetan and stops automation.
 */

const MONEY_PATTERNS: { label: string; re: RegExp; amountOnly?: boolean }[] = [
  { label: "rupee amount", amountOnly: true, re: /₹|\brs\.?\s*\d|\binr\b|\d\s*(lakh|lac|lakhs|cr|crore|crores|k)\b/i },
  { label: "lakh/crore", amountOnly: true, re: /\b(lakh|lakhs|lac|crore|crores)\b/i },
  { label: "price", re: /\b(price|prices|pricing|cost|costs|rate|rates|per\s*sq\.?\s*ft|psf)\b/i },
  { label: "payment plan", re: /\b(payment\s*plan|emi|down\s*payment|booking\s*amount|token\s*amount|instal+ments?)\b/i },
  { label: "discount", re: /\b(discount|discounts|cashback|waiver|negotiat\w*)\b/i },
  { label: "offer", re: /\b(offer|offers|deal|scheme)\b/i },
  // Hinglish: "kitne ka hai", "kya rate hai", "keemat"
  { label: "price (Hinglish)", re: /\b(kitne\s*ka|kitna\s*hai|kimat|keemat|kitne\s*mein|kitne\s*me)\b/i },
];

export interface MoneyCheck {
  mentionsMoney: boolean;
  matched: string[];
}

/**
 * Outgoing (default): any rupee figure counts. Incoming: a buyer stating their
 * own budget ("around 55 lakh") is an answer, not a price question, so bare
 * amounts are ignored and only price, payment plan, discount and offer count.
 */
export function checkMoney(text: string | null | undefined, opts: { incoming?: boolean } = {}): MoneyCheck {
  if (!text) return { mentionsMoney: false, matched: [] };
  const matched = MONEY_PATTERNS.filter((p) => !(opts.incoming && p.amountOnly) && p.re.test(text)).map((p) => p.label);
  return { mentionsMoney: matched.length > 0, matched };
}
