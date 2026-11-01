import { displayName } from "@/lib/display-name";
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

function hue(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.codePointAt(0)!) % 360;
  return h;
}

/** Initials in a softly tinted circle (the tint follows the name), for customers now and agents later. */
export function Avatar({ name, size = "md" }: { name: string | null; size?: "sm" | "md" | "lg" | "xl" }) {
  const shown = displayName(name).name;
  const initials =
    shown
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => [...w][0]!.toUpperCase())
      .join("") || "?";
  const dim = { sm: "size-7 text-[11px]", md: "size-9 text-xs", lg: "size-13 text-base", xl: "size-16 text-xl" }[size];
  const h = hue(shown);
  return (
    <span
      aria-hidden
      className={`grid flex-none place-items-center rounded-full font-semibold ${dim}`}
      style={{ background: `hsl(${h} 32% 92%)`, color: `hsl(${h} 35% 30%)` }}
    >
      {initials}
    </span>
  );
}

/** A small champagne "!" beside names that came from a social profile and need confirming. */
export function NameFlag({ raw }: { raw: string | null }) {
  if (!raw) return null;
  return (
    <span
      title={`Name from their Instagram or Facebook profile (“${raw}”). Confirm it on the call.`}
      aria-label="Name needs confirming"
      className="inline-grid size-4 flex-none place-items-center rounded-full border border-gold-line bg-gold-soft text-[10px] font-bold text-gold-ink"
    >
      !
    </span>
  );
}
