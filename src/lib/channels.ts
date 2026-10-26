import { LEAD_SOURCES, type ChannelSpend, type Lead, type LeadSource, type SiteVisit } from "./types";

/*
 * Realtyniti Channel Board (SYS-07): what each channel produces before a lead
 * reaches the pipeline, so next month's budget is chosen from buyers, not clicks.
 * It only shows; any budget change is Chetan's decision.
 */

export type Period = "week" | "month";

export interface ChannelRow {
  source: LeadSource;
  enquiries: number;
  qualified: number;
  hot: number;
  visits: number;
  medianReplyMinutes: number | null;
  spend: number | null;
  perQualified: number | null;
  perVisit: number | null;
}

export function periodStart(period: Period, now = new Date()): Date {
  // Calendar periods in India time.
  const ist = new Date(now.getTime() + 5.5 * 3600_000);
  ist.setUTCHours(0, 0, 0, 0);
  if (period === "month") ist.setUTCDate(1);
  else ist.setUTCDate(ist.getUTCDate() - ((ist.getUTCDay() + 6) % 7)); // Monday
  return new Date(ist.getTime() - 5.5 * 3600_000);
}

export function monthKey(d: Date): string {
  const ist = new Date(d.getTime() + 5.5 * 3600_000);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** A lead counts as qualified once it has a hot, warm or cold tag. */
export const isQualified = (l: Lead) => l.temperature != null;

export function buildChannelBoard(
  leads: Lead[],
  visits: SiteVisit[],
  spend: ChannelSpend[],
  period: Period,
  now = new Date(),
): ChannelRow[] {
  const from = periodStart(period, now).toISOString();
  const inPeriod = leads.filter((l) => l.created_at >= from);
  const month = monthKey(now);

  return LEAD_SOURCES.map((source) => {
    const ls = inPeriod.filter((l) => l.first_source === source);
    const ids = new Set(ls.map((l) => l.id));
    const qualified = ls.filter(isQualified).length;
    const visitCount = new Set(visits.filter((v) => v.status !== "cancelled" && ids.has(v.lead_id)).map((v) => v.lead_id)).size;
    const replies = ls
      .filter((l) => l.first_reply_at)
      .map((l) => (new Date(l.first_reply_at!).getTime() - new Date(l.created_at).getTime()) / 60_000);
    const s = period === "month" ? (spend.find((x) => x.source === source && x.month === month)?.amount_inr ?? null) : null;
    return {
      source,
      enquiries: ls.length,
      qualified,
      hot: ls.filter((l) => l.temperature === "hot").length,
      visits: visitCount,
      medianReplyMinutes: median(replies),
      spend: s,
      perQualified: s != null && qualified ? Math.round(s / qualified) : null,
      perVisit: s != null && visitCount ? Math.round(s / visitCount) : null,
    };
  }).filter((r) => r.enquiries > 0 || r.spend != null);
}
