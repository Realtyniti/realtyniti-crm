import type { Lead, LeadSource } from "@/lib/types";

const TEMP_STYLE = {
  hot: "bg-hot-soft text-hot",
  warm: "bg-warm-soft text-warm",
  cold: "bg-cold-soft text-cold",
} as const;

const TEMP_LABEL = { hot: "Hot", warm: "Warm", cold: "Cold" } as const;

const pill = "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap";

export function TemperatureBadge({ value }: { value: Lead["temperature"] }) {
  if (!value) return <span className={`${pill} bg-subtle font-medium text-muted`}>Untagged</span>;
  return (
    <span className={`${pill} gap-1.5 ${TEMP_STYLE[value]}`}>
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {TEMP_LABEL[value]}
    </span>
  );
}

export const SOURCE_LABEL: Record<LeadSource, string> = {
  meta: "Meta ad",
  instagram: "Instagram",
  youtube: "YouTube",
  whatsapp: "WhatsApp",
  website: "Website",
  referral: "Referral",
  call: "Call",
  other: "Other",
};

export function SourceBadge({ value }: { value: LeadSource }) {
  return <span className={`${pill} bg-subtle font-medium text-muted`}>{SOURCE_LABEL[value]}</span>;
}

export const STATUS_LABEL: Record<Lead["status"], string> = {
  new: "New",
  qualifying: "Qualifying",
  qualified: "Qualified",
  site_visit: "Site visit",
  converted: "Converted",
  lost: "Lost",
};

const STATUS_STYLE: Record<Lead["status"], string> = {
  new: "bg-new-soft text-new",
  qualifying: "bg-subtle text-muted",
  qualified: "bg-accent-soft text-accent",
  site_visit: "bg-accent-soft text-accent",
  converted: "bg-good-soft text-good",
  lost: "bg-subtle text-faint",
};

export function StatusBadge({ value }: { value: Lead["status"] }) {
  return <span className={`${pill} ${STATUS_STYLE[value]}`}>{STATUS_LABEL[value]}</span>;
}

/** Initials in a circle, for customers now and agents later. */
export function Avatar({ name, size = "md" }: { name: string | null; size?: "sm" | "md" | "lg" }) {
  const initials =
    (name ?? "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "?";
  const dim = { sm: "size-7 text-[11px]", md: "size-9 text-xs", lg: "size-14 text-lg" }[size];
  return (
    <span aria-hidden className={`grid flex-none place-items-center rounded-full bg-accent-soft font-semibold text-accent ${dim}`}>
      {initials}
    </span>
  );
}
