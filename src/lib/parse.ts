import type { Purpose } from "./types";

/*
 * Turn free-text answers (form fields, chat replies) into card fields.
 * Anything unrecognised returns null and stays "unknown" on the card.
 */

const LAKH = 100_000;
const CRORE = 10_000_000;

function toInr(n: number, unit: string | undefined): number {
  const u = (unit ?? "").toLowerCase();
  if (/^(cr|crore|crores)$/.test(u)) return Math.round(n * CRORE);
  if (/^(l|lac|lacs|lakh|lakhs)$/.test(u)) return Math.round(n * LAKH);
  if (u === "k") return Math.round(n * 1000);
  // Bare numbers: "55" almost always means lakh in a property enquiry.
  if (n < 1000) return Math.round(n * LAKH);
  return Math.round(n);
}

/** "50 lakh", "50-60 lakh", "1.2 cr", "under 55L", "₹75,00,000" */
export function parseBudget(text: string | null | undefined): { min: number | null; max: number | null } | null {
  if (!text) return null;
  const t = text.replace(/,/g, "").replace(/₹|rs\.?|inr/gi, " ");
  const unit = "(cr|crore|crores|l|lac|lacs|lakh|lakhs|k)?";
  const range = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${unit}\\s*(?:-|to|–)\\s*(\\d+(?:\\.\\d+)?)\\s*${unit}\\b`, "i").exec(t);
  if (range) {
    const u2 = range[4];
    const u1 = range[2] ?? u2;
    const a = toInr(parseFloat(range[1]), u1);
    const b = toInr(parseFloat(range[3]), u2);
    return { min: Math.min(a, b), max: Math.max(a, b) };
  }
  const single = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${unit}\\b`, "i").exec(t);
  if (!single) return null;
  const v = toInr(parseFloat(single[1]), single[2]);
  if (/\b(under|below|upto|up to|within|max|less than)\b/i.test(t)) return { min: null, max: v };
  if (/\b(above|over|min|more than|plus)\b|\+/i.test(t)) return { min: v, max: null };
  return { min: null, max: v };
}

/** "within 2 months", "immediately", "6 months", "next year", "just exploring" */
export function parseTimelineMonths(text: string | null | undefined): number | null {
  if (!text) return null;
  const t = text.toLowerCase();
  if (/\b(immediate|immediately|asap|urgent|this month|turant|abhi)\b/.test(t)) return 1;
  const m = /(\d+(?:\.\d+)?)\s*(month|months|mahine|mahina|week|weeks|year|years|yr|yrs|saal)\b/.exec(t);
  if (m) {
    const n = parseFloat(m[1]);
    if (m[2].startsWith("week")) return Math.max(1, Math.round(n / 4));
    if (/^(year|years|yr|yrs|saal)$/.test(m[2])) return Math.round(n * 12);
    return Math.round(n);
  }
  if (/\b(next year|a year)\b/.test(t)) return 12;
  if (/\b(exploring|just looking|not sure|no hurry)\b/.test(t)) return 12;
  return null;
}

export function parsePurpose(text: string | null | undefined): Purpose | null {
  if (!text) return null;
  const t = text.toLowerCase();
  if (/\b(rent|rental|rental income)\b/.test(t)) return "rental";
  if (/\b(invest|investment|investor|appreciation|resale)\b/.test(t)) return "investment";
  if (/\b(end use|end-use|self use|self-use|own use|live|living|family|khud|rehne)\b/.test(t)) return "end_use";
  return null;
}

const MARKETS: { name: string; re: RegExp }[] = [
  { name: "Yamuna Expressway", re: /yamuna|yeida|jewar|airport|yex/i },
  { name: "Greater Noida West", re: /greater\s*noida\s*west|noida\s*extension|gnw|gaur\s*city/i },
  { name: "Greater Noida", re: /greater\s*noida|gr\.?\s*noida|pari\s*chowk/i },
  { name: "Noida", re: /noida|sector\s*\d+/i },
];

/** Keeps the sector if one was given, e.g. "Noida, Sector 150". */
export function parseMicroMarket(text: string | null | undefined): string | null {
  if (!text?.trim()) return null;
  const market = MARKETS.find((m) => m.re.test(text));
  if (!market) return text.trim();
  const sector = /sector\s*-?\s*(\d+[a-z]?)/i.exec(text);
  return sector && market.name === "Noida" ? `Noida, Sector ${sector[1].toUpperCase()}` : market.name;
}

export function parsePropertyType(text: string | null | undefined): string | null {
  if (!text?.trim()) return null;
  const bhk = /(\d)\s*\.?\s*(?:bhk|bh|bedroom)/i.exec(text);
  if (bhk) return `${bhk[1]}BHK`;
  if (/\bplot|land\b/i.test(text)) return "Plot";
  if (/\bstudio\b/i.test(text)) return "Studio";
  if (/\b(commercial|shop|office|retail)\b/i.test(text)) return "Commercial";
  if (/\bvilla\b/i.test(text)) return "Villa";
  return text.trim();
}
