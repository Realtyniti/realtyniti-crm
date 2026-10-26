import type { Lead, LeadSource } from "@/lib/types";

const TEMP_STYLE = {
  hot: "bg-red-100 text-red-800",
  warm: "bg-amber-100 text-amber-800",
  cold: "bg-sky-100 text-sky-800",
} as const;

export function TemperatureBadge({ value }: { value: Lead["temperature"] }) {
  if (!value) return <span className="rounded px-2 py-0.5 text-xs text-stone-500 ring-1 ring-stone-200">untagged</span>;
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${TEMP_STYLE[value]}`}>{value}</span>;
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
  return <span className="rounded bg-stone-100 px-2 py-0.5 text-xs text-stone-700">{SOURCE_LABEL[value]}</span>;
}

export const STATUS_LABEL: Record<Lead["status"], string> = {
  new: "New",
  qualifying: "Qualifying",
  qualified: "Qualified",
  site_visit: "Site visit",
  converted: "Converted",
  lost: "Lost",
};
