import { endOfTodayIst } from "./format";
import { LEAD_SOURCES, type Lead, type LeadSource, type SiteVisit } from "./types";

/*
 * Realtyniti Pipeline Board (SYS-04): the single screen in place of six inboxes.
 */

export interface SourceRow {
  source: LeadSource;
  leads: number;
  hot: number;
  visits: number;
  converted: number;
  lost: number;
}

export interface Board {
  dueToday: Lead[];
  needsChetan: Lead[];
  newLeads: Lead[];
  upcoming: Lead[];
  converted: Lead[];
  lostByReason: { reason: string; leads: Lead[] }[];
  sources: SourceRow[];
}

const isOpen = (l: Lead) => l.status !== "converted" && l.status !== "lost";

/** Lost reasons are free text; group them loosely so "Budget low" and "budget too low" land together. */
export function reasonGroup(reason: string): string {
  const r = reason.toLowerCase();
  if (/budget|afford|expensive|costly|price/.test(r)) return "Budget / price";
  if (/elsewhere|another|other (broker|agent|project)|competitor|bought/.test(r)) return "Bought elsewhere";
  if (/no (reply|response)|not (replying|responding)|stopped|ghost|unreachable|switched off/.test(r)) return "Stopped responding";
  if (/location|far|distance|area/.test(r)) return "Location";
  if (/not interested|no interest|just looking|exploring/.test(r)) return "Not interested";
  if (/later|postpone|delay|next year/.test(r)) return "Postponed";
  if (/fake|wrong number|spam|junk|broker/.test(r)) return "Junk / wrong number";
  return reason.trim().replace(/^./, (c) => c.toUpperCase());
}

export function buildBoard(leads: Lead[], visits: SiteVisit[], now = new Date()): Board {
  const dueBy = endOfTodayIst(now).toISOString();
  const weekAhead = new Date(endOfTodayIst(now).getTime() + 7 * 24 * 3600_000).toISOString();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600_000).toISOString();
  const open = leads.filter(isOpen);
  const byTimeline = (a: Lead, b: Lead) => (a.timeline_months ?? 99) - (b.timeline_months ?? 99);

  const lost = leads.filter((l) => l.status === "lost");
  const groups = new Map<string, Lead[]>();
  for (const l of lost) {
    const g = reasonGroup(l.lost_reason ?? "No reason");
    groups.set(g, [...(groups.get(g) ?? []), l]);
  }

  const visitedLeads = new Set(visits.filter((v) => v.status !== "cancelled").map((v) => v.lead_id));
  const sources = LEAD_SOURCES.map((source) => {
    const ls = leads.filter((l) => l.first_source === source);
    return {
      source,
      leads: ls.length,
      hot: ls.filter((l) => l.temperature === "hot").length,
      visits: ls.filter((l) => visitedLeads.has(l.id)).length,
      converted: ls.filter((l) => l.status === "converted").length,
      lost: ls.filter((l) => l.status === "lost").length,
    };
  }).filter((r) => r.leads > 0);

  return {
    dueToday: open.filter((l) => l.next_follow_up_at && l.next_follow_up_at <= dueBy).sort(byTimeline),
    needsChetan: open.filter((l) => l.needs_chetan),
    newLeads: open.filter((l) => l.status === "new" && l.created_at >= weekAgo),
    upcoming: open
      .filter((l) => l.next_follow_up_at && l.next_follow_up_at > dueBy && l.next_follow_up_at <= weekAhead)
      .sort((a, b) => a.next_follow_up_at!.localeCompare(b.next_follow_up_at!)),
    converted: leads.filter((l) => l.status === "converted").sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    lostByReason: [...groups].map(([reason, leads]) => ({ reason, leads })).sort((a, b) => b.leads.length - a.leads.length),
    sources: sources.sort((a, b) => b.leads - a.leads),
  };
}
