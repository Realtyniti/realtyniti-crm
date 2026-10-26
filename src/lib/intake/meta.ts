import { createHmac, timingSafeEqual } from "node:crypto";
import { parseBudget, parseMicroMarket, parsePropertyType, parsePurpose, parseTimelineMonths } from "../parse";
import type { LeadInput } from "../types";

/*
 * Meta lead forms (Facebook / Instagram ads). Meta posts a "leadgen" webhook
 * with only an id; the answers are fetched from the Graph API.
 */

export const GRAPH_API = "https://graph.facebook.com/v21.0";

/** Checks the X-Hub-Signature-256 header Meta sends with every webhook. */
export function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const given = header.slice("sha256=".length);
  if (given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given, "hex"), Buffer.from(expected, "hex"));
}

export interface LeadgenChange {
  leadgen_id: string;
  form_id?: string;
  page_id?: string;
  ad_id?: string;
  created_time?: number;
}

/** Pulls every leadgen change out of a webhook body. */
export function leadgenChanges(body: unknown): LeadgenChange[] {
  const out: LeadgenChange[] = [];
  const entries = (body as { entry?: { changes?: { field?: string; value?: LeadgenChange }[] }[] })?.entry ?? [];
  for (const e of entries) {
    for (const c of e.changes ?? []) {
      if (c.field === "leadgen" && c.value?.leadgen_id) out.push(c.value);
    }
  }
  return out;
}

export interface MetaLead {
  id: string;
  created_time?: string;
  ad_id?: string;
  form_id?: string;
  platform?: string;
  field_data: { name: string; values: string[] }[];
}

export async function fetchMetaLead(leadgenId: string, pageAccessToken: string): Promise<MetaLead> {
  const url = `${GRAPH_API}/${encodeURIComponent(leadgenId)}?fields=id,created_time,ad_id,form_id,platform,field_data`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${pageAccessToken}` } });
  if (!res.ok) throw new Error(`Meta Graph API ${res.status}: ${await res.text()}`);
  return (await res.json()) as MetaLead;
}

/** Custom form questions are matched loosely by their field name. */
function pick(fields: Map<string, string>, ...patterns: RegExp[]): string | null {
  for (const p of patterns) for (const [k, v] of fields) if (p.test(k)) return v;
  return null;
}

export function metaLeadToInput(lead: MetaLead): LeadInput {
  const fields = new Map(lead.field_data.map((f) => [f.name.toLowerCase(), f.values.join(", ")]));
  const budget = parseBudget(pick(fields, /budget/));
  const first = pick(fields, /^first_name$/);
  const last = pick(fields, /^last_name$/);
  return {
    // Meta reports "ig" for Instagram lead ads; both are paid Meta leads.
    source: "meta",
    phone: pick(fields, /^phone_number$/, /phone|mobile|whatsapp/) ?? "",
    name: pick(fields, /^full_name$/) ?? ([first, last].filter(Boolean).join(" ") || null),
    email: pick(fields, /^email$/),
    budget_min_inr: budget?.min ?? null,
    budget_max_inr: budget?.max ?? null,
    micro_market: parseMicroMarket(pick(fields, /location|area|city|sector|market/)),
    property_type: parsePropertyType(pick(fields, /property|bhk|config|type/)),
    purpose: parsePurpose(pick(fields, /purpose|use|invest/)),
    timeline_months: parseTimelineMonths(pick(fields, /timeline|when|time|plan/)),
    external_id: lead.id,
    received_at: lead.created_time ? new Date(lead.created_time).toISOString() : undefined,
    raw: lead,
  };
}
