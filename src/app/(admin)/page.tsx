import Link from "next/link";
import { SourceBadge, STATUS_LABEL, TemperatureBadge } from "@/components/badges";
import { endOfTodayIst, formatBudget, formatDate, formatDateTime } from "@/lib/format";
import { getStore } from "@/lib/store";
import { DEFAULT_BRAND } from "@/lib/templates";
import type { Lead } from "@/lib/types";

const FILTERS = [
  { key: "open", label: "Open" },
  { key: "due", label: "Due today" },
  { key: "chetan", label: "Needs Chetan" },
  { key: "hot", label: "Hot" },
  { key: "warm", label: "Warm" },
  { key: "cold", label: "Cold" },
  { key: "lost", label: "Lost" },
  { key: "all", label: "All" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

const isOpen = (l: Lead) => l.status !== "converted" && l.status !== "lost";

function applyFilter(leads: Lead[], f: FilterKey): Lead[] {
  const dueBy = endOfTodayIst().toISOString();
  switch (f) {
    case "open":
      return leads.filter(isOpen);
    case "due":
      return leads
        .filter((l) => isOpen(l) && l.next_follow_up_at && l.next_follow_up_at <= dueBy)
        // Client deciding soonest is called first.
        .sort((a, b) => (a.timeline_months ?? 99) - (b.timeline_months ?? 99));
    case "chetan":
      return leads.filter((l) => isOpen(l) && l.needs_chetan);
    case "hot":
    case "warm":
    case "cold":
      return leads.filter((l) => isOpen(l) && l.temperature === f);
    case "lost":
      return leads.filter((l) => l.status === "lost");
    default:
      return leads;
  }
}

export const dynamic = "force-dynamic";

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const { f } = await searchParams;
  const filter = (FILTERS.find((x) => x.key === f)?.key ?? "open") as FilterKey;
  const all = await getStore().listLeads();
  const leads = applyFilter(all, filter);
  const counts = Object.fromEntries(FILTERS.map((x) => [x.key, applyFilter(all, x.key).length]));

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Leads</h1>
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((x) => (
          <Link
            key={x.key}
            href={`/?f=${x.key}`}
            className={`rounded-full px-3 py-1 text-sm ring-1 ${
              x.key === filter ? "bg-stone-900 text-white ring-stone-900" : "bg-white text-stone-700 ring-stone-200"
            }`}
          >
            {x.label} <span className="opacity-60">{counts[x.key]}</span>
          </Link>
        ))}
      </div>

      {leads.length === 0 ? (
        <p className="panel text-sm text-stone-500">No leads here yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-3 py-2">Client</th>
                <th className="px-3 py-2">Tag</th>
                <th className="px-3 py-2">Requirement</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Next follow-up</th>
                <th className="px-3 py-2">Arrived</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {leads.map((l) => (
                <tr key={l.id} className="hover:bg-stone-50">
                  <td className="px-3 py-2">
                    <Link href={`/leads/${l.id}`} className="font-medium hover:underline">
                      {l.name ?? "Unnamed"}
                    </Link>
                    <div className="font-mono text-xs text-stone-500">{l.phone}</div>
                    {l.needs_chetan && (
                      <div className="mt-1 text-xs font-medium text-red-700">Needs Chetan: {l.needs_chetan_reason}</div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <TemperatureBadge value={l.temperature} />
                  </td>
                  <td className="px-3 py-2 text-stone-700">
                    {[formatBudget(l.budget_min_inr, l.budget_max_inr), l.property_type, l.micro_market]
                      .filter(Boolean)
                      .join(" · ") || <span className="text-stone-400">not asked yet</span>}
                  </td>
                  <td className="px-3 py-2">
                    <SourceBadge value={l.first_source} />
                    {l.brand !== DEFAULT_BRAND && <div className="mt-1 text-xs text-stone-500">{l.brand}</div>}
                  </td>
                  <td className="px-3 py-2">
                    {STATUS_LABEL[l.status]}
                    {l.status === "lost" && <div className="text-xs text-stone-500">{l.lost_reason}</div>}
                  </td>
                  <td className="px-3 py-2">{formatDate(l.next_follow_up_at)}</td>
                  <td className="px-3 py-2 text-stone-500">{formatDateTime(l.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
