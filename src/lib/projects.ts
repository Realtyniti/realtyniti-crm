import { formatBudget, formatDate } from "./format";
import { parseBudget } from "./parse";
import type { Availability, Project, ProjectInput } from "./types";

/*
 * Realtyniti Project Sheet SOP (SYS-06): one fixed way of recording every
 * developer project, plus drafts built from those fields. Drafts are for
 * Chetan to read and send himself; nothing here is sent automatically.
 */

/** Freshness limits for price and availability. Chetan can change these. */
export const FRESH_DAYS = 14;
export const STALE_DAYS = 30;

export type Freshness = "green" | "amber" | "red";

export function daysSinceConfirmed(p: Pick<Project, "last_confirmed_at">, now = new Date()): number | null {
  if (!p.last_confirmed_at) return null;
  return Math.floor((now.getTime() - new Date(p.last_confirmed_at).getTime()) / 86_400_000);
}

export function freshness(p: Pick<Project, "last_confirmed_at">, now = new Date()): Freshness {
  const d = daysSinceConfirmed(p, now);
  if (d == null || d > STALE_DAYS) return "red";
  return d > FRESH_DAYS ? "amber" : "green";
}

export const AVAILABILITY_LABEL: Record<Availability, string> = {
  available: "Available",
  limited: "Limited units",
  sold_out: "Sold out",
  on_hold: "On hold",
};

/** Offers that lapse within `days`, soonest first. */
export function offersExpiring(projects: Project[], days = 7, now = new Date()): Project[] {
  const today = now.toISOString().slice(0, 10);
  const limit = new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10);
  return projects
    .filter((p) => p.offers && p.offer_valid_until && p.offer_valid_until >= today && p.offer_valid_until <= limit)
    .sort((a, b) => a.offer_valid_until!.localeCompare(b.offer_valid_until!));
}

const asOf = (p: Project) => (p.last_confirmed_at ? ` (confirmed ${formatDate(p.last_confirmed_at)})` : " (not yet confirmed)");

/** One-page summary for a client, with the confirmation date beside every figure. Chetan checks it before sharing. */
export function clientSummary(p: Project): string {
  const lines = [
    `*${p.name}* by ${p.developer}`,
    `📍 ${[p.sector, p.micro_market].filter(Boolean).join(", ")}`,
    p.rera_number ? `RERA: ${p.rera_number}` : null,
    p.configurations ? `Homes: ${p.configurations}` : null,
    formatBudget(p.price_min_inr, p.price_max_inr) ? `Price: ${formatBudget(p.price_min_inr, p.price_max_inr)}${asOf(p)}` : null,
    p.payment_plan ? `Payment plan: ${p.payment_plan}${asOf(p)}` : null,
    p.offers ? `Offer: ${p.offers}${p.offer_valid_until ? `, valid till ${formatDate(p.offer_valid_until)}` : ""}${asOf(p)}` : null,
    p.possession ? `Possession: ${p.possession}` : null,
    p.amenities ? `Amenities: ${p.amenities}` : null,
    `Availability: ${AVAILABILITY_LABEL[p.availability]}${asOf(p)}`,
  ];
  return lines.filter(Boolean).join("\n");
}

/** WhatsApp to the developer's sales contact, asking only for the figures that go stale. */
export function developerConfirmation(p: Project): string {
  const ask: string[] = [];
  const have = (v: string | null) => (v ? ` (I have: ${v})` : "");
  ask.push(`Current price range${have(formatBudget(p.price_min_inr, p.price_max_inr))}`);
  ask.push(`Payment plan${have(p.payment_plan)}`);
  ask.push(`Any running offer and its last date${have(p.offers)}`);
  ask.push(`Availability${have(AVAILABILITY_LABEL[p.availability])}`);
  ask.push(`Possession timeline${have(p.possession)}`);
  return [
    p.developer_contact_name ? `Hi ${p.developer_contact_name.split(" ")[0]}, Chetan from Realtyniti here.` : "Hello, this is Chetan from Realtyniti.",
    `Could you please confirm the latest for ${p.name}:`,
    ...ask.map((a, i) => `${i + 1}. ${a}`),
    "Thank you!",
  ].join("\n");
}

/** Side-by-side note for a client weighing two or three projects. */
export function comparisonNote(projects: Project[]): string {
  const rows: [string, (p: Project) => string | null][] = [
    ["Location", (p) => [p.sector, p.micro_market].filter(Boolean).join(", ")],
    ["Developer", (p) => p.developer],
    ["Homes", (p) => p.configurations],
    ["Price", (p) => (formatBudget(p.price_min_inr, p.price_max_inr) ? formatBudget(p.price_min_inr, p.price_max_inr)! + asOf(p) : null)],
    ["Payment plan", (p) => p.payment_plan],
    ["Possession", (p) => p.possession],
    ["Offer", (p) => (p.offers ? `${p.offers}${p.offer_valid_until ? ` (till ${formatDate(p.offer_valid_until)})` : ""}` : null)],
    ["Availability", (p) => AVAILABILITY_LABEL[p.availability]],
  ];
  const out = [`*Comparing ${projects.map((p) => p.name).join(" vs ")}*`];
  for (const [label, get] of rows) {
    out.push(`\n_${label}_`);
    for (const p of projects) out.push(`• ${p.name}: ${get(p) ?? "not recorded"}`);
  }
  return out.join("\n");
}

function text(fd: FormData, k: string): string | null {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

const AVAILABILITY: Availability[] = ["available", "limited", "sold_out", "on_hold"];

/** Reads the Project Sheet form into the fixed fields. */
export function projectFromForm(fd: FormData): ProjectInput | { error: string } {
  const name = text(fd, "name");
  const developer = text(fd, "developer");
  const market = text(fd, "micro_market");
  if (!name || !developer || !market) return { error: "Project, developer and location are needed." };
  const price = parseBudget(text(fd, "price"));
  const availability = (text(fd, "availability") ?? "available") as Availability;
  return {
    name,
    developer,
    micro_market: market,
    sector: text(fd, "sector"),
    rera_number: text(fd, "rera_number"),
    configurations: text(fd, "configurations"),
    price_min_inr: price?.min ?? null,
    price_max_inr: price?.max ?? null,
    plc: text(fd, "plc"),
    payment_plan: text(fd, "payment_plan"),
    possession: text(fd, "possession"),
    offers: text(fd, "offers"),
    offer_valid_until: text(fd, "offer_valid_until"),
    amenities: text(fd, "amenities"),
    availability: AVAILABILITY.includes(availability) ? availability : "available",
    developer_contact_name: text(fd, "developer_contact_name"),
    developer_contact_phone: text(fd, "developer_contact_phone"),
    last_confirmed_at: null,
    confirmed_by: null,
    notes: text(fd, "notes"),
  };
}

/*
 * Freshness Check: when the developer replies, old and new figures are shown
 * side by side and Chetan accepts each change before it enters the Project Book.
 */

export type FigureKey = "price" | "payment_plan" | "offers" | "offer_valid_until" | "availability" | "possession" | "plc";

export const FIGURE_LABEL: Record<FigureKey, string> = {
  price: "Price range",
  payment_plan: "Payment plan",
  offers: "Offers",
  offer_valid_until: "Offer valid until",
  availability: "Availability",
  possession: "Possession",
  plc: "PLC",
};

export interface FigureChange {
  key: FigureKey;
  label: string;
  before: string;
  after: string;
}

function figureText(p: Pick<Project, "price_min_inr" | "price_max_inr" | "payment_plan" | "offers" | "offer_valid_until" | "availability" | "possession" | "plc">, k: FigureKey): string {
  if (k === "price") return formatBudget(p.price_min_inr, p.price_max_inr) ?? "";
  if (k === "availability") return AVAILABILITY_LABEL[p.availability];
  return p[k] ?? "";
}

/** Reads the developer's reply (same fields as the sheet) and lists what changed. */
export function figuresFromForm(fd: FormData, current: Project): Partial<ProjectInput> {
  const price = parseBudget(text(fd, "price"));
  const availability = text(fd, "availability") as Availability | null;
  return {
    price_min_inr: price ? price.min : current.price_min_inr,
    price_max_inr: price ? price.max : current.price_max_inr,
    payment_plan: text(fd, "payment_plan"),
    offers: text(fd, "offers"),
    offer_valid_until: text(fd, "offer_valid_until"),
    availability: availability && AVAILABILITY.includes(availability) ? availability : current.availability,
    possession: text(fd, "possession"),
    plc: text(fd, "plc"),
  };
}

export function figureChanges(current: Project, reply: Partial<ProjectInput>): FigureChange[] {
  const next = { ...current, ...reply };
  return (Object.keys(FIGURE_LABEL) as FigureKey[])
    .map((key) => ({ key, label: FIGURE_LABEL[key], before: figureText(current, key), after: figureText(next, key) }))
    .filter((c) => c.before !== c.after);
}

/** Only the changes Chetan ticked are written; the project is then confirmed as of now. */
export function acceptedPatch(reply: Partial<ProjectInput>, accepted: FigureKey[], confirmedBy: string | null, now = new Date()): Partial<ProjectInput> {
  const patch: Partial<ProjectInput> = { last_confirmed_at: now.toISOString(), confirmed_by: confirmedBy };
  for (const k of accepted) {
    if (k === "price") {
      patch.price_min_inr = reply.price_min_inr ?? null;
      patch.price_max_inr = reply.price_max_inr ?? null;
    } else {
      Object.assign(patch, { [k]: reply[k] ?? null });
    }
  }
  return patch;
}
