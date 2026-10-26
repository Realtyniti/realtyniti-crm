export function formatInr(n: number | null | undefined): string {
  if (n == null) return "";
  if (n >= 10_000_000) return `₹${+(n / 10_000_000).toFixed(2)} Cr`;
  if (n >= 100_000) return `₹${+(n / 100_000).toFixed(1)} L`;
  return `₹${n.toLocaleString("en-IN")}`;
}

export function formatBudget(min: number | null, max: number | null): string | null {
  if (min == null && max == null) return null;
  if (min != null && max != null) return `${formatInr(min)} – ${formatInr(max)}`;
  return max != null ? `up to ${formatInr(max)}` : `${formatInr(min)}+`;
}

const IST: Intl.DateTimeFormatOptions = { timeZone: "Asia/Kolkata" };

export function formatDateTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-IN", { ...IST, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-IN", { ...IST, day: "numeric", month: "short" });
}

/** Today's end in India, for "due today". */
export function endOfTodayIst(now = new Date()): Date {
  const ist = new Date(now.getTime() + 5.5 * 3600_000);
  ist.setUTCHours(23, 59, 59, 999);
  return new Date(ist.getTime() - 5.5 * 3600_000);
}

export const PURPOSE_LABEL = { end_use: "End use", investment: "Investment", rental: "Rental" } as const;
