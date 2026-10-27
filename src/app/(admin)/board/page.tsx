import Link from "next/link";
import { SOURCE_LABEL, TemperatureBadge } from "@/components/badges";
import { buildBoard } from "@/lib/board";
import { requirementLine } from "@/lib/catcher";
import { formatDate } from "@/lib/format";
import { getStore } from "@/lib/store";
import type { Lead } from "@/lib/types";
import { formatSlot, slotsWithBookings } from "@/lib/visits";

function LeadRow({ l, extra }: { l: Lead; extra?: string }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 py-1.5 text-sm">
      <Link href={`/leads/${l.id}`} className="font-medium hover:underline">
        {l.name ?? l.phone}
      </Link>
      <TemperatureBadge value={l.temperature} />
      <span className="text-muted">{requirementLine(l)}</span>
      {extra && <span className="text-muted">· {extra}</span>}
    </li>
  );
}

function Section({ title, count, children, tone }: { title: string; count: number; children: React.ReactNode; tone?: string }) {
  return (
    <section className={`panel ${tone ?? ""}`}>
      <h2 className="mb-2 flex items-baseline gap-2 font-medium">
        {title} <span className="text-sm font-normal text-muted">{count}</span>
      </h2>
      {count === 0 ? <p className="text-sm text-faint">Nothing here.</p> : children}
    </section>
  );
}

export default async function BoardPage() {
  const store = getStore();
  const now = new Date();
  const [leads, slots] = await Promise.all([store.listLeads(), slotsWithBookings(store, now)]);
  const allVisits = await store.listVisits();
  const b = buildBoard(leads, allVisits, now);
  const byId = new Map(leads.map((l) => [l.id, l]));
  const upcomingVisits = slots.flatMap((s) => s.booked.map((v) => ({ v, s })));

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Pipeline board</h1>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Follow-ups due today" count={b.dueToday.length} tone="border-stone-900">
          <p className="mb-1 text-xs text-muted">Soonest deciders first.</p>
          <ul className="divide-y divide-line">
            {b.dueToday.map((l) => (
              <LeadRow key={l.id} l={l} extra={l.timeline_months != null ? `deciding in ${l.timeline_months} mo` : undefined} />
            ))}
          </ul>
        </Section>

        <Section title="Needs you (money came up)" count={b.needsChetan.length} tone={b.needsChetan.length ? "border-red-300" : ""}>
          <ul className="divide-y divide-line">
            {b.needsChetan.map((l) => (
              <LeadRow key={l.id} l={l} extra={l.needs_chetan_reason ?? undefined} />
            ))}
          </ul>
        </Section>

        <Section title="Site visits scheduled" count={upcomingVisits.length}>
          <ul className="divide-y divide-line">
            {upcomingVisits.map(({ v, s }) => {
              const l = byId.get(v.lead_id);
              return l ? <LeadRow key={v.id} l={l} extra={`${formatSlot(s)}, ${s.area}`} /> : null;
            })}
          </ul>
        </Section>

        <Section title="New leads (last 7 days)" count={b.newLeads.length}>
          <ul className="divide-y divide-line">
            {b.newLeads.map((l) => (
              <LeadRow key={l.id} l={l} extra={SOURCE_LABEL[l.first_source]} />
            ))}
          </ul>
        </Section>

        <Section title="Upcoming follow-ups (next 7 days)" count={b.upcoming.length}>
          <ul className="divide-y divide-line">
            {b.upcoming.map((l) => (
              <LeadRow key={l.id} l={l} extra={formatDate(l.next_follow_up_at)} />
            ))}
          </ul>
        </Section>

        <Section title="Converted" count={b.converted.length}>
          <ul className="divide-y divide-line">
            {b.converted.slice(0, 10).map((l) => (
              <LeadRow key={l.id} l={l} extra={SOURCE_LABEL[l.first_source]} />
            ))}
          </ul>
        </Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Lost, by reason" count={b.lostByReason.reduce((n, g) => n + g.leads.length, 0)}>
          <ul className="space-y-2 text-sm">
            {b.lostByReason.map((g) => (
              <li key={g.reason}>
                <div className="flex justify-between">
                  <span className="font-medium">{g.reason}</span>
                  <span className="text-muted">{g.leads.length}</span>
                </div>
                <div className="text-xs text-muted">
                  {g.leads.slice(0, 6).map((l) => l.name ?? l.phone).join(", ")}
                  {g.leads.length > 6 ? "…" : ""}
                </div>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Where leads come from" count={b.sources.length}>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="py-1">Source</th>
                <th className="py-1 text-right">Leads</th>
                <th className="py-1 text-right">Hot</th>
                <th className="py-1 text-right">Visits</th>
                <th className="py-1 text-right">Converted</th>
                <th className="py-1 text-right">Lost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {b.sources.map((r) => (
                <tr key={r.source}>
                  <td className="py-1.5">{SOURCE_LABEL[r.source]}</td>
                  <td className="py-1.5 text-right tabular-nums">{r.leads}</td>
                  <td className="py-1.5 text-right tabular-nums">{r.hot}</td>
                  <td className="py-1.5 text-right tabular-nums">{r.visits}</td>
                  <td className="py-1.5 text-right tabular-nums">{r.converted}</td>
                  <td className="py-1.5 text-right tabular-nums">{r.lost}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      </div>
    </div>
  );
}
