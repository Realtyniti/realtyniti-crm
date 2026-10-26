import { requirementLine } from "./catcher";
import { endOfTodayIst } from "./format";
import type { Lead } from "./types";

/**
 * Chetan's 9 AM message: what came in overnight (warm and cold; hot ones were
 * alerted at once), who asked about money, and today's follow-ups. One line per
 * lead so it also fits a single WhatsApp template parameter.
 */
export function buildDigest(leads: Lead[], now = new Date()): string | null {
  const since = new Date(now.getTime() - 24 * 3600_000).toISOString();
  const dueBy = endOfTodayIst(now).toISOString();
  const open = leads.filter((l) => l.status !== "converted" && l.status !== "lost");

  const fresh = open.filter((l) => l.created_at >= since);
  const money = open.filter((l) => l.needs_chetan);
  const due = open
    .filter((l) => l.next_follow_up_at && l.next_follow_up_at <= dueBy)
    .sort((a, b) => (a.timeline_months ?? 99) - (b.timeline_months ?? 99));

  if (!fresh.length && !money.length && !due.length) return null;

  const who = (l: Lead) => `${l.name ?? "Unnamed"} ${l.phone}${requirementLine(l) ? ` (${requirementLine(l)})` : ""}`;
  const count = (t: Lead["temperature"]) => fresh.filter((l) => l.temperature === t).length;
  const parts = [
    `Good morning. Last 24h: ${fresh.length} new (${count("hot")} hot, ${count("warm")} warm, ${count("cold")} cold, ${fresh.filter((l) => !l.temperature).length} not yet answered).`,
  ];
  if (money.length) parts.push(`Asked about money: ${money.slice(0, 5).map(who).join("; ")}.`);
  if (due.length) parts.push(`Follow up today: ${due.slice(0, 8).map(who).join("; ")}${due.length > 8 ? ` and ${due.length - 8} more` : ""}.`);
  const warm = fresh.filter((l) => l.temperature === "warm");
  if (warm.length) parts.push(`New warm: ${warm.slice(0, 5).map(who).join("; ")}.`);
  return parts.join(" ");
}
