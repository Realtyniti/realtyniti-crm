import Link from "next/link";
import { SOURCE_LABEL } from "@/components/badges";
import { buildChannelBoard, monthKey, type Period } from "@/lib/channels";
import { formatInr } from "@/lib/format";
import { getStore } from "@/lib/store";
import { SpendForm } from "./form";

function minutes(m: number | null): string {
  if (m == null) return "–";
  if (m < 60) return `${Math.round(m)} min`;
  return `${(m / 60).toFixed(1)} h`;
}

export default async function ChannelsPage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const { p } = await searchParams;
  const period: Period = p === "week" ? "week" : "month";
  const store = getStore();
  const [leads, visits, spend] = await Promise.all([store.listLeads(), store.listVisits(), store.listSpend()]);
  const rows = buildChannelBoard(leads, visits, spend, period);
  const total = rows.reduce(
    (t, r) => ({ e: t.e + r.enquiries, q: t.q + r.qualified, h: t.h + r.hot, v: t.v + r.visits, s: t.s + (r.spend ?? 0) }),
    { e: 0, q: 0, h: 0, v: 0, s: 0 },
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Channel board</h1>
        <div className="ml-auto flex gap-2">
          {(["week", "month"] as const).map((x) => (
            <Link
              key={x}
              href={`/channels?p=${x}`}
              className={`rounded-full px-3 py-1 text-sm ring-1 ${x === period ? "bg-stone-900 text-white ring-stone-900" : "bg-white ring-stone-200"}`}
            >
              This {x}
            </Link>
          ))}
        </div>
      </div>
      <p className="max-w-3xl text-sm text-stone-600">
        What each channel produced up to the first qualified conversation. Cost per qualified lead and per site visit
        appear once you enter that month&apos;s spend. This board only shows; budget decisions stay with you.
      </p>

      <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th className="px-3 py-2">Channel</th>
              <th className="px-3 py-2 text-right">Enquiries</th>
              <th className="px-3 py-2 text-right">Qualified</th>
              <th className="px-3 py-2 text-right">Hot</th>
              <th className="px-3 py-2 text-right">Visits booked</th>
              <th className="px-3 py-2 text-right">First reply (median)</th>
              {period === "month" && (
                <>
                  <th className="px-3 py-2 text-right">Spend</th>
                  <th className="px-3 py-2 text-right">₹ / qualified</th>
                  <th className="px-3 py-2 text-right">₹ / visit</th>
                </>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100 tabular-nums">
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-4 text-stone-500">
                  No enquiries this {period} yet.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.source}>
                <td className="px-3 py-2">{SOURCE_LABEL[r.source]}</td>
                <td className="px-3 py-2 text-right">{r.enquiries}</td>
                <td className="px-3 py-2 text-right">{r.qualified}</td>
                <td className="px-3 py-2 text-right">{r.hot}</td>
                <td className="px-3 py-2 text-right">{r.visits}</td>
                <td className="px-3 py-2 text-right">{minutes(r.medianReplyMinutes)}</td>
                {period === "month" && (
                  <>
                    <td className="px-3 py-2 text-right">{r.spend != null ? formatInr(r.spend) : "–"}</td>
                    <td className="px-3 py-2 text-right">{r.perQualified != null ? formatInr(r.perQualified) : "–"}</td>
                    <td className="px-3 py-2 text-right">{r.perVisit != null ? formatInr(r.perVisit) : "–"}</td>
                  </>
                )}
              </tr>
            ))}
            {rows.length > 0 && (
              <tr className="bg-stone-50 font-medium">
                <td className="px-3 py-2">Total</td>
                <td className="px-3 py-2 text-right">{total.e}</td>
                <td className="px-3 py-2 text-right">{total.q}</td>
                <td className="px-3 py-2 text-right">{total.h}</td>
                <td className="px-3 py-2 text-right">{total.v}</td>
                <td className="px-3 py-2" />
                {period === "month" && (
                  <>
                    <td className="px-3 py-2 text-right">{total.s ? formatInr(total.s) : "–"}</td>
                    <td className="px-3 py-2 text-right">{total.s && total.q ? formatInr(Math.round(total.s / total.q)) : "–"}</td>
                    <td className="px-3 py-2 text-right">{total.s && total.v ? formatInr(Math.round(total.s / total.v)) : "–"}</td>
                  </>
                )}
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <section className="panel space-y-2">
        <h2 className="font-medium">Ad spend</h2>
        <SpendForm month={monthKey(new Date()).slice(0, 7)} />
      </section>
    </div>
  );
}
