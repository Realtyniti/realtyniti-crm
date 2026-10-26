import { formatBudget, formatDate } from "./format";
import { freshness, type Freshness } from "./projects";
import type { Project, Requirement } from "./types";

/*
 * Realtyniti Match Finder: a buyer's requirement against Chetan's own Project
 * Book, ranked by fit, with stale figures flagged. The shortlist message is a
 * draft for Chetan to check; nothing is sent.
 */

/** A project up to this much above the buyer's top budget is shown as a near miss. */
export const BUDGET_STRETCH = 0.1;

export interface Match {
  project: Project;
  score: number;
  reasons: string[];
  /** Why it is only a near miss, if it is one. */
  miss: string | null;
  freshness: Freshness;
}

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

function locationFit(want: string | null, p: Project): "exact" | "area" | "none" | "unknown" {
  if (!want) return "unknown";
  const market = norm(p.micro_market);
  // "Noida, Sector 150" matches a project in Sector 150 exactly, other Noida projects as nearby.
  const wantSector = /sector\s*-?\s*(\d+[a-z]?)/i.exec(want)?.[1]?.toLowerCase();
  if (wantSector && norm(p.sector) === `sector${wantSector}`) return "exact";
  const wantMarket = norm(want.replace(/,?\s*sector\s*-?\s*\d+[a-z]?/i, ""));
  if (market === wantMarket) return wantSector ? "area" : "exact";
  // Greater Noida and Greater Noida West: same corridor, not the same place.
  if (market.startsWith("greaternoida") && wantMarket.startsWith("greaternoida")) return "area";
  return "none";
}

function typeFit(want: string | null, p: Project): boolean | null {
  if (!want) return null;
  return norm(p.configurations).includes(norm(want));
}

function budgetFit(r: Requirement, p: Project): "fits" | "stretch" | "over" | "under" | "unknown" {
  const max = r.budget_max_inr;
  const min = r.budget_min_inr;
  if (max == null && min == null) return "unknown";
  const lo = p.price_min_inr ?? p.price_max_inr;
  const hi = p.price_max_inr ?? p.price_min_inr;
  if (lo == null || hi == null) return "unknown";
  if (max != null && lo > max) return lo <= max * (1 + BUDGET_STRETCH) ? "stretch" : "over";
  if (min != null && hi < min) return "under";
  return "fits";
}

export function matchProjects(r: Requirement, projects: Project[], now = new Date()): { matches: Match[]; nearMisses: Match[] } {
  const all: Match[] = [];
  for (const p of projects) {
    if (p.availability === "sold_out" || p.availability === "on_hold") continue;
    const reasons: string[] = [];
    let score = 0;
    let miss: string | null = null;

    const b = budgetFit(r, p);
    if (b === "fits") {
      score += 40;
      reasons.push("Within budget");
    } else if (b === "stretch") {
      score += 20;
      miss = "Slightly above budget";
    } else if (b === "over" || b === "under") {
      continue;
    } else {
      score += 10;
      reasons.push("Price not compared");
    }

    const l = locationFit(r.micro_market, p);
    if (l === "exact") {
      score += 30;
      reasons.push(`In ${p.sector ?? p.micro_market}`);
    } else if (l === "area") {
      score += 15;
      reasons.push(`Nearby: ${p.micro_market}`);
    } else if (l === "none") {
      if (miss) continue;
      miss = `Different location: ${p.micro_market}`;
    } else {
      score += 10;
    }

    const t = typeFit(r.property_type, p);
    if (t === true) {
      score += 20;
      reasons.push(`Has ${r.property_type}`);
    } else if (t === false) {
      if (miss) continue;
      miss = `No ${r.property_type} listed`;
    } else {
      score += 5;
    }

    if (r.timeline_months != null && r.timeline_months <= 3 && /ready/i.test(p.possession ?? "")) {
      score += 10;
      reasons.push("Ready to move");
    }
    if (p.availability === "limited") reasons.push("Limited units");

    all.push({ project: p, score, reasons, miss, freshness: freshness(p, now) });
  }
  const byScore = (a: Match, b: Match) => b.score - a.score || a.project.name.localeCompare(b.project.name);
  return {
    matches: all.filter((m) => !m.miss).sort(byScore),
    nearMisses: all.filter((m) => m.miss).sort(byScore),
  };
}

/** Draft WhatsApp shortlist for the client. Held for Chetan to review; every price carries its confirmation date. */
export function shortlistMessage(name: string | null, matches: Match[]): string {
  const lines = [`Hi ${name?.split(" ")[0] ?? "there"}, based on what you shared, here are a few projects worth a look:`];
  matches.slice(0, 5).forEach((m, i) => {
    const p = m.project;
    const price = formatBudget(p.price_min_inr, p.price_max_inr);
    lines.push(
      `\n${i + 1}. *${p.name}* (${p.developer}), ${[p.sector, p.micro_market].filter(Boolean).join(", ")}` +
        (p.configurations ? `\n   ${p.configurations}` : "") +
        (price ? `\n   ${price}${p.last_confirmed_at ? ` (as of ${formatDate(p.last_confirmed_at)})` : " (to be confirmed)"}` : "") +
        (p.possession ? `\n   Possession: ${p.possession}` : ""),
    );
  });
  lines.push("\nWould you like to see any of these this weekend?");
  return lines.join("\n");
}
