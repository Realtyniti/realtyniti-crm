import { SOURCE_LABEL } from "@/components/badges";
import { endOfTodayIst, formatBudget, formatDate, PURPOSE_LABEL } from "./format";
import { startOfTodayIst } from "./lead-views";
import type { Lead } from "./types";

/** +91 98765 43210 */
export function formatPhone(p: string): string {
  const m = /^\+91(\d{5})(\d{5})$/.exec(p);
  return m ? `+91 ${m[1]} ${m[2]}` : p;
}

export function whatsappUrl(phone: string, text?: string): string {
  const base = `https://wa.me/${phone.replace(/\D/g, "")}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

export function timelineLabel(months: number | null): string | null {
  if (months == null) return null;
  if (months <= 1) return "Within a month";
  if (months >= 12) return "A year or more";
  return `Within ${months} months`;
}

/** What we already know about the requirement, in the order a salesperson reads it. */
export function requirementFacts(l: Lead): string[] {
  return [
    l.property_type,
    formatBudget(l.budget_min_inr, l.budget_max_inr),
    l.micro_market,
    timelineLabel(l.timeline_months),
    l.purpose ? PURPOSE_LABEL[l.purpose] : null,
    SOURCE_LABEL[l.first_source],
  ].filter((x): x is string => !!x);
}

export type FollowUpState = "overdue" | "today" | "upcoming" | null;

export function followUpState(iso: string | null, now = new Date()): FollowUpState {
  if (!iso) return null;
  if (iso < startOfTodayIst(now).toISOString()) return "overdue";
  if (iso <= endOfTodayIst(now).toISOString()) return "today";
  return "upcoming";
}

const IST = "Asia/Kolkata";

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", { timeZone: IST, hour: "numeric", minute: "2-digit" });
}

/** "Today, 4:00 pm", "Tomorrow, 11:00 am", "2 Nov", "3 days overdue" */
export function followUpLabel(iso: string | null, now = new Date()): string {
  if (!iso) return "Not set";
  const state = followUpState(iso, now);
  if (state === "today") return `Today, ${formatTime(iso)}`;
  if (state === "overdue") {
    const days = Math.max(1, Math.round((startOfTodayIst(now).getTime() - new Date(iso).getTime()) / 86_400_000) + 1);
    return `${days} day${days === 1 ? "" : "s"} overdue`;
  }
  const tomorrowEnd = endOfTodayIst(now).getTime() + 86_400_000;
  if (new Date(iso).getTime() <= tomorrowEnd) return `Tomorrow, ${formatTime(iso)}`;
  return formatDate(iso);
}
