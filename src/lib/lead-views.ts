import { endOfTodayIst } from "./format";
import type { Lead, LeadSource, LeadStatus } from "./types";

/*
 * The saved views on the Leads page and the dashboard counts. Each view is
 * written once as a plain predicate (memory store, tests) and once as database
 * filters (Supabase store), and the two are kept side by side here.
 */

export const LEAD_VIEWS = ["open", "all", "new", "hot", "warm", "cold", "due", "overdue", "chetan", "lost"] as const;
export type LeadView = (typeof LEAD_VIEWS)[number];

export const VIEW_LABEL: Record<LeadView, string> = {
  open: "Open",
  all: "All",
  new: "New",
  hot: "Hot",
  warm: "Warm",
  cold: "Cold",
  due: "Due today",
  overdue: "Overdue",
  chetan: "Needs attention",
  lost: "Lost",
};

export interface LeadQuery {
  view: LeadView;
  q?: string | null;
  source?: LeadSource | null;
  status?: LeadStatus | null;
  budget?: "known" | "unknown" | null;
  sort?: "followup" | "recent";
  page?: number;
  pageSize?: number;
}

export interface LeadPage {
  rows: Lead[];
  total: number;
}

export function startOfTodayIst(now = new Date()): Date {
  return new Date(endOfTodayIst(now).getTime() - 24 * 3600_000 + 1);
}

export function viewWindow(now = new Date()) {
  return { start: startOfTodayIst(now).toISOString(), end: endOfTodayIst(now).toISOString() };
}

const isOpen = (l: Lead) => l.status !== "converted" && l.status !== "lost";

export function matchesView(l: Lead, view: LeadView, now = new Date()): boolean {
  const { start, end } = viewWindow(now);
  const fu = l.next_follow_up_at;
  switch (view) {
    case "all":
      return true;
    case "open":
      return isOpen(l);
    case "new":
      return l.status === "new";
    case "hot":
    case "warm":
    case "cold":
      return isOpen(l) && l.temperature === view;
    case "due":
      return isOpen(l) && !!fu && fu >= start && fu <= end;
    case "overdue":
      return isOpen(l) && !!fu && fu < start;
    case "chetan":
      return isOpen(l) && l.needs_chetan;
    case "lost":
      return l.status === "lost";
  }
}

/** Search text is matched against name and phone; strip characters that mean something to the query language. */
export function cleanSearch(q: string | null | undefined): string | null {
  const t = (q ?? "").replace(/[%,()*\\]/g, " ").trim();
  return t ? t.slice(0, 60) : null;
}

export function matchesQuery(l: Lead, query: LeadQuery, now = new Date()): boolean {
  if (!matchesView(l, query.view, now)) return false;
  if (query.source && l.first_source !== query.source) return false;
  if (query.status && l.status !== query.status) return false;
  const hasBudget = l.budget_min_inr != null || l.budget_max_inr != null;
  if (query.budget === "known" && !hasBudget) return false;
  if (query.budget === "unknown" && hasBudget) return false;
  const q = cleanSearch(query.q);
  if (q) {
    const digits = q.replace(/\D/g, "");
    const hit = (l.name ?? "").toLowerCase().includes(q.toLowerCase()) || (digits.length >= 3 && l.phone.includes(digits));
    if (!hit) return false;
  }
  return true;
}

export function compareLeads(sort: LeadQuery["sort"] = "followup") {
  return (a: Lead, b: Lead) => {
    if (sort === "followup") {
      const fa = a.next_follow_up_at ?? "9999";
      const fb = b.next_follow_up_at ?? "9999";
      if (fa !== fb) return fa.localeCompare(fb);
    }
    return b.created_at.localeCompare(a.created_at);
  };
}
