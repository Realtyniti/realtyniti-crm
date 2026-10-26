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

/** HMAC of the token with the app secret; Meta requires it when "Require app secret" is on. */
export function appsecretProof(token: string, appSecret: string | null | undefined): string | null {
  return appSecret ? createHmac("sha256", appSecret).update(token).digest("hex") : null;
}

/** One Graph API call, with appsecret_proof whenever the app secret is known. */
export async function graph<T>(
  path: string,
  token: string,
  appSecret: string | null | undefined,
  init: { method?: "GET" | "POST"; params?: Record<string, string> } = {},
): Promise<T> {
  const params = new URLSearchParams(init.params);
  params.set("access_token", token);
  const proof = appsecretProof(token, appSecret);
  if (proof) params.set("appsecret_proof", proof);
  const url = path.startsWith("http") ? path : `${GRAPH_API}/${path.replace(/^\//, "")}`;
  const res =
    init.method === "POST"
      ? await fetch(url, { method: "POST", body: params })
      : await fetch(`${url}${url.includes("?") ? "&" : "?"}${params}`);
  if (!res.ok) throw new Error(`Meta Graph API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

const LEAD_FIELDS = "id,created_time,ad_id,form_id,platform,field_data";

export async function fetchMetaLead(leadgenId: string, pageToken: string, appSecret?: string | null): Promise<MetaLead> {
  return graph<MetaLead>(`${encodeURIComponent(leadgenId)}?fields=${LEAD_FIELDS}`, pageToken, appSecret);
}

/** The lead form's name ("Grand Estate"), so Chetan sees which ad the buyer answered. */
export async function formName(formId: string | undefined, pageToken: string, appSecret?: string | null): Promise<string | null> {
  if (!formId) return null;
  try {
    return (await graph<{ name?: string }>(`${encodeURIComponent(formId)}?fields=name`, pageToken, appSecret)).name ?? null;
  } catch {
    return null;
  }
}

export interface MetaForm {
  id: string;
  name: string;
  status?: string;
}

/** Every lead on every form of a Page, oldest pages of results first. Used to bring past leads onto cards. */
export async function* pageLeads(pageId: string, pageToken: string, appSecret?: string | null): AsyncGenerator<{ form: MetaForm; lead: MetaLead }> {
  let next: string | null = `${encodeURIComponent(pageId)}/leadgen_forms?fields=id,name,status&limit=100`;
  const forms: MetaForm[] = [];
  while (next) {
    const page: { data: MetaForm[]; paging?: { next?: string } } = await graph(next, pageToken, appSecret);
    forms.push(...page.data);
    next = page.paging?.next ? stripAuth(page.paging.next) : null;
  }
  for (const form of forms) {
    let url: string | null = `${encodeURIComponent(form.id)}/leads?fields=${LEAD_FIELDS}&limit=100`;
    while (url) {
      const page: { data: MetaLead[]; paging?: { next?: string } } = await graph(url, pageToken, appSecret);
      for (const lead of page.data) yield { form, lead: { ...lead, form_id: lead.form_id ?? form.id } };
      url = page.paging?.next ? stripAuth(page.paging.next) : null;
    }
  }
}

/** Paging links carry the token; graph() adds it back, so drop it to avoid sending it twice. */
function stripAuth(link: string): string {
  const u = new URL(link);
  u.searchParams.delete("access_token");
  u.searchParams.delete("appsecret_proof");
  return u.toString();
}

/**
 * Lead retrieval wants a Page access token. A system-user token assigned to the
 * Page can mint one; if that fails the token is used as it is.
 */
export async function pageAccessToken(pageId: string, token: string, appSecret?: string | null): Promise<string> {
  try {
    const body = await graph<{ access_token?: string }>(`${encodeURIComponent(pageId)}?fields=access_token`, token, appSecret);
    return body.access_token ?? token;
  } catch {
    return token;
  }
}

export interface LeadgenSetup {
  appId: string;
  appSecret: string;
  pageId: string;
  token: string;
  callbackUrl: string;
  verifyToken: string;
}

/**
 * One-time wiring: subscribe the app to Page leadgen webhooks, then subscribe the
 * Page to the app. Safe to run again; Meta treats both calls as updates.
 */
export async function connectLeadgen(s: LeadgenSetup): Promise<{ step: string; ok: boolean; detail: string }[]> {
  const out: { step: string; ok: boolean; detail: string }[] = [];
  const run = async (step: string, call: () => Promise<unknown>) => {
    try {
      out.push({ step, ok: true, detail: JSON.stringify(await call()).slice(0, 300) });
      return true;
    } catch (e) {
      out.push({ step, ok: false, detail: (e as Error).message });
      return false;
    }
  };
  const appToken = `${s.appId}|${s.appSecret}`;
  const appOk = await run("app webhook (leadgen)", () =>
    graph(`${s.appId}/subscriptions`, appToken, null, {
      method: "POST",
      params: { object: "page", callback_url: s.callbackUrl, fields: "leadgen", verify_token: s.verifyToken },
    }),
  );
  if (!appOk) return out;
  const pageToken = await pageAccessToken(s.pageId, s.token, s.appSecret);
  await run("Page subscribed to app", () =>
    graph(`${s.pageId}/subscribed_apps`, pageToken, s.appSecret, { method: "POST", params: { subscribed_fields: "leadgen" } }),
  );
  return out;
}

/** Custom form questions are matched loosely by their field name. */
function pick(fields: Map<string, string>, ...patterns: RegExp[]): string | null {
  for (const p of patterns) for (const [k, v] of fields) if (p.test(k)) return v;
  return null;
}

/**
 * Chetan runs ads from more than one Facebook Page (Tathya Homes, Realtyniti),
 * each with its own Page access token. META_PAGE_BRANDS maps Page ids to the
 * brand name buyers saw: "111=Tathya Homes,222=Realtyniti".
 */
export interface MetaPage {
  brand: string | null;
  token: string | null;
}

export function metaPageFor(pageId: string | undefined, env: Record<string, string | undefined>): MetaPage {
  const brands = new Map(
    (env.META_PAGE_BRANDS ?? "")
      .split(",")
      .map((pair) => pair.split("=").map((s) => s.trim()))
      .filter(([id, name]) => id && name) as [string, string][],
  );
  return {
    brand: (pageId && brands.get(pageId)) || null,
    token: (pageId && env[`META_PAGE_ACCESS_TOKEN_${pageId}`]) || env.META_PAGE_ACCESS_TOKEN || null,
  };
}

export function metaLeadToInput(lead: MetaLead, brand: string | null = null): LeadInput {
  const fields = new Map(lead.field_data.map((f) => [f.name.toLowerCase(), f.values.join(", ")]));
  const budget = parseBudget(pick(fields, /budget/));
  const first = pick(fields, /^first_name$/);
  const last = pick(fields, /^last_name$/);
  return {
    // Meta reports "ig" for Instagram lead ads; both are paid Meta leads.
    source: "meta",
    brand,
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
