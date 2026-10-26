import { captureLead, closeLead } from "./leads";
import { parseBudget, parseMicroMarket, parsePropertyType, parsePurpose, parseTimelineMonths } from "./parse";
import type { Store } from "./store/types";
import type { LeadSource } from "./types";

/*
 * Moving existing leads onto cards (blueprint weeks 5 to 8). Accepts a CSV
 * pasted from Excel or Google Sheets, with loosely named headers.
 */

/** Minimal CSV parser: commas or tabs, double-quoted fields, "" escapes. */
export function parseCsv(text: string): string[][] {
  const delim = text.split("\n")[0].includes("\t") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim()));
}

const COLUMNS: Record<string, RegExp> = {
  name: /^(name|full ?name|client|customer|lead ?name)$/i,
  phone: /phone|mobile|number|contact|whatsapp/i,
  email: /e-?mail/i,
  source: /source|platform|channel|from/i,
  budget: /budget/i,
  location: /location|area|sector|city|market/i,
  property_type: /property|type|bhk|config/i,
  purpose: /purpose|use|investment/i,
  timeline: /timeline|when|time ?frame/i,
  status: /^status|stage$/i,
  lost_reason: /lost|reason/i,
  notes: /note|remark|comment|message|requirement/i,
};

export function sourceFrom(text: string | undefined, fallback: LeadSource): LeadSource {
  const t = (text ?? "").toLowerCase();
  if (/insta|\big\b/.test(t)) return "instagram";
  if (/facebook|\bfb\b|meta/.test(t)) return "meta";
  if (/youtube|\byt\b/.test(t)) return "youtube";
  if (/whats ?app|\bwa\b/.test(t)) return "whatsapp";
  if (/web|site|google|form/.test(t)) return "website";
  if (/refer/.test(t)) return "referral";
  if (/call/.test(t)) return "call";
  return fallback;
}

export interface ImportResult {
  created: number;
  merged: number;
  closed: number;
  errors: string[];
}

export async function importLeads(store: Store, csv: string, fallbackSource: LeadSource): Promise<ImportResult> {
  const [header, ...rows] = parseCsv(csv);
  const result: ImportResult = { created: 0, merged: 0, closed: 0, errors: [] };
  if (!header) return result;

  const index: Partial<Record<keyof typeof COLUMNS, number>> = {};
  for (const [key, re] of Object.entries(COLUMNS) as [keyof typeof COLUMNS, RegExp][]) {
    const i = header.findIndex((h, j) => re.test(h.trim()) && !Object.values(index).includes(j));
    if (i >= 0) index[key] = i;
  }
  if (index.phone === undefined) {
    result.errors.push("No phone column found in the first row");
    return result;
  }

  for (const [n, r] of rows.entries()) {
    const get = (k: keyof typeof COLUMNS) => (index[k] !== undefined ? r[index[k]!]?.trim() || undefined : undefined);
    const budget = parseBudget(get("budget"));
    try {
      const { lead, created } = await captureLead(store, {
        source: sourceFrom(get("source"), fallbackSource),
        phone: get("phone") ?? "",
        name: get("name"),
        email: get("email"),
        budget_min_inr: budget?.min ?? null,
        budget_max_inr: budget?.max ?? null,
        micro_market: parseMicroMarket(get("location")),
        property_type: parsePropertyType(get("property_type")),
        purpose: parsePurpose(get("purpose")),
        timeline_months: parseTimelineMonths(get("timeline")),
        message: get("notes"),
      });
      if (created) result.created++;
      else result.merged++;

      const status = get("status")?.toLowerCase() ?? "";
      if (/lost|closed|dead|not interested/.test(status)) {
        const reason = get("lost_reason") ?? (/not interested/.test(status) ? "Not interested" : undefined);
        if (reason) {
          await closeLead(store, lead.id, "lost", reason);
          result.closed++;
        } else {
          result.errors.push(`row ${n + 2} kept open: marked lost but no reason given`);
        }
      } else if (/convert|booked|won|sold/.test(status)) {
        await closeLead(store, lead.id, "converted");
      }
    } catch (e) {
      result.errors.push(`row ${n + 2}: ${(e as Error).message}`);
    }
  }
  return result;
}
