import Link from "next/link";
import { redirect } from "next/navigation";
import { AlarmClock, ArrowRight, CalendarCheck, CalendarDays, Flame, Phone, Users } from "lucide-react";
import { Avatar, STATUS_LABEL, TemperatureBadge } from "@/components/badges";
import { followUpLabel, followUpState, formatTime } from "@/lib/lead-display";
import { formatDate } from "@/lib/format";
import { getStore } from "@/lib/store";
import type { Lead, LeadStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Old Leads links (/?f=hot) now live at /leads. */
const OLD_FILTER: Record<string, string> = { open: "open", due: "due", chetan: "chetan", hot: "hot", warm: "warm", cold: "cold", lost: "lost", all: "all" };

const PIPELINE: { status: LeadStatus; color: string }[] = [
  { status: "new", color: "bg-new" },
  { status: "qualifying", color: "bg-faint" },
  { status: "qualified", color: "bg-accent/60" },
  { status: "site_visit", color: "bg-accent" },
  { status: "converted", color: "bg-good" },
  { status: "lost", color: "bg-line" },
];

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const { f } = await searchParams;
  if (f && OLD_FILTER[f]) redirect(OLD_FILTER[f] === "open" ? "/leads" : `/leads?view=${OLD_FILTER[f]}`);

  const store = getStore();
  const now = new Date();
  const weekAhead = new Date(now.getTime() + 7 * 86_400_000).toISOString();

  const [counts, statusTotals, overdue, due, nextUp, slots, booked] = await Promise.all([
    store.countLeads(["all", "open", "hot", "warm", "cold", "due", "overdue", "chetan"]),
    Promise.all(PIPELINE.map(async (p) => (await store.queryLeads({ view: "all", status: p.status, pageSize: 1 })).total)),
    store.queryLeads({ view: "overdue", pageSize: 6 }),
    store.queryLeads({ view: "due", pageSize: 6 }),
    store.queryLeads({ view: "open", pageSize: 1 }),
    store.listSlots({ from: now.toISOString() }),
    store.listVisits({ status: "booked" }),
  ]);

  const slotById = new Map(slots.map((s) => [s.id, s]));
  const upcoming = booked
    .map((v) => ({ v, slot: slotById.get(v.slot_id) }))
    .filter((x): x is { v: typeof x.v; slot: NonNullable<typeof x.slot> } => !!x.slot)
    .sort((a, b) => a.slot.starts_at.localeCompare(b.slot.starts_at));
  const upcomingWeek = upcoming.filter((x) => x.slot.starts_at <= weekAhead).length;
  const visitLeads = new Map(
    (await Promise.all(upcoming.slice(0, 5).map((x) => store.getLead(x.v.lead_id)))).filter((l): l is Lead => !!l).map((l) => [l.id, l]),
  );

  const todays = [...overdue.rows, ...due.rows].slice(0, 6);
  const next = nextUp.rows[0];
  const pipelineTotal = statusTotals.reduce((a, b) => a + b, 0);
  const hour = Number(now.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", hour12: false }));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const today = now.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[13px] font-medium text-muted">{today}</p>
          <h1 className="mt-0.5 text-[26px] font-semibold tracking-tight">{greeting}</h1>
        </div>
        <Link href={counts.overdue > 0 ? "/leads?view=overdue" : "/leads?view=due"} className="btn h-10 px-4">
          <Phone className="size-4" />
          Start today&apos;s calls
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat href="/leads?view=all" icon={Users} tone="accent" value={counts.all} label="Total leads" note={`${counts.open} open`} />
        <Stat href="/leads?view=hot" icon={Flame} tone="hot" value={counts.hot} label="Hot leads" note={`${counts.warm} warm · ${counts.cold} cold`} />
        <Stat href="/leads?view=due" icon={CalendarCheck} tone="accent" value={counts.due} label="Follow-ups due today" note={counts.due > 0 ? "Open the call list" : "Nothing due today"} />
        <Stat
          href="/leads?view=overdue"
          icon={AlarmClock}
          tone={counts.overdue > 0 ? "hot" : "muted"}
          value={counts.overdue}
          label="Overdue follow-ups"
          note={counts.overdue > 0 ? "Call these first" : "All caught up"}
          alert={counts.overdue > 0}
        />
        <Stat href="/visits" icon={CalendarDays} tone="good" value={upcomingWeek} label="Site visits this week" note={`${upcoming.length} booked in total`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <section className="panel lg:col-span-3">
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-semibold">Today&apos;s follow-ups</h2>
            <Link href="/leads?view=due" className="flex items-center gap-1 text-[13px] font-medium text-accent hover:underline">
              View all <ArrowRight className="size-3.5" />
            </Link>
          </div>
          {todays.length === 0 ? (
            <div className="mt-4 rounded-xl bg-subtle px-4 py-6 text-center">
              <div className="text-sm font-medium">No follow-ups due today</div>
              {next?.next_follow_up_at && (
                <p className="mt-1 text-[13px] text-muted">
                  Next one is {nextLabel(next.next_follow_up_at)}:{" "}
                  <Link href={`/leads/${next.id}`} className="font-medium text-ink hover:text-accent">
                    {next.name ?? "Unnamed"}
                  </Link>
                </p>
              )}
            </div>
          ) : (
            <ul className="mt-3 space-y-0.5">
              {todays.map((l) => {
                const overdueRow = followUpState(l.next_follow_up_at) === "overdue";
                return (
                  <li key={l.id} className="-mx-2 flex items-center gap-3 rounded-xl px-2 py-2.5 transition hover:bg-subtle/70">
                    <Avatar name={l.name} />
                    <div className="min-w-0 flex-1">
                      <Link href={`/leads/${l.id}`} className="block truncate text-sm font-semibold hover:text-accent">
                        {l.name ?? "Unnamed"}
                      </Link>
                      <div className="truncate text-[12.5px] text-muted">
                        {[l.property_type, l.micro_market].filter(Boolean).join(" · ") || "Requirement not asked yet"}
                      </div>
                    </div>
                    <TemperatureBadge value={l.temperature} />
                    <span className={`w-28 text-right text-[12.5px] tabular-nums ${overdueRow ? "font-semibold text-hot" : "text-ink"}`}>
                      {followUpLabel(l.next_follow_up_at)}
                    </span>
                    <Link
                      href={`/leads?view=${overdueRow ? "overdue" : "due"}&call=${l.id}`}
                      aria-label={`Call ${l.name ?? "lead"}`}
                      className="inline-flex h-8 flex-none items-center gap-1.5 rounded-lg bg-accent px-3 text-[13px] font-medium text-white shadow-sm hover:bg-accent-hover"
                    >
                      <Phone className="size-3.5" />
                      Call
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="panel lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-semibold">Upcoming site visits</h2>
            <Link href="/visits" className="flex items-center gap-1 text-[13px] font-medium text-accent hover:underline">
              Site visits <ArrowRight className="size-3.5" />
            </Link>
          </div>
          {upcoming.length === 0 ? (
            <div className="mt-4 rounded-xl bg-subtle px-4 py-6 text-center">
              <div className="text-sm font-medium">No site visits booked</div>
              <p className="mt-1 text-[13px] text-muted">Open visit slots so buyers can book, or book one during a call.</p>
              <Link href="/visits" className="btn-ghost mt-3 h-8 text-[13px]">
                Open visit slots
              </Link>
            </div>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {upcoming.slice(0, 5).map(({ v, slot }) => {
                const lead = visitLeads.get(v.lead_id);
                return (
                  <li key={v.id} className="flex items-center gap-3 py-2.5">
                    <div className="w-14 flex-none rounded-lg bg-accent-soft py-1 text-center text-accent">
                      <div className="text-[11px] font-semibold uppercase">{formatDate(slot.starts_at).split(" ")[1]}</div>
                      <div className="text-base leading-tight font-semibold tabular-nums">{formatDate(slot.starts_at).split(" ")[0]}</div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{lead?.name ?? "Lead"}</div>
                      <div className="truncate text-[12.5px] text-muted">
                        {formatTime(slot.starts_at)} · {v.project_interest ?? slot.area}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <section className="panel">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[15px] font-semibold">Lead pipeline</h2>
          <span className="text-[13px] text-muted tabular-nums">{pipelineTotal} leads by stage</span>
        </div>
        <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-subtle" role="img" aria-label="Leads by stage">
          {PIPELINE.map((p, i) =>
            statusTotals[i]! > 0 ? (
              <div key={p.status} className={`${p.color} h-full`} style={{ width: `${(statusTotals[i]! / Math.max(1, pipelineTotal)) * 100}%` }} />
            ) : null,
          )}
        </div>
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {PIPELINE.map((p, i) => (
            <li key={p.status}>
              <Link href={`/leads?view=all&status=${p.status}`} className="group block rounded-xl px-1 py-1 hover:bg-subtle">
                <div className="flex items-center gap-2 text-[12.5px] text-muted">
                  <span className={`size-2.5 rounded-full ${p.color}`} />
                  {STATUS_LABEL[p.status]}
                </div>
                <div className="mt-0.5 pl-[18px] text-xl font-semibold tabular-nums">{statusTotals[i]}</div>
              </Link>
            </li>
          ))}
        </ul>
        {counts.chetan > 0 && (
          <p className="mt-4 border-t border-line pt-3 text-[13px]">
            <Link href="/leads?view=chetan" className="font-medium text-hot hover:underline">
              {counts.chetan} lead{counts.chetan === 1 ? "" : "s"} asked about price or offers and need a personal reply
            </Link>
          </p>
        )}
      </section>
    </div>
  );
}

/** "today, 4:00 pm" mid-sentence, but "29 Oct" keeps its capital. */
function nextLabel(iso: string) {
  const label = followUpLabel(iso);
  return /^\d/.test(label) ? `on ${label}` : label.toLowerCase();
}

const TONE = {
  accent: "bg-accent-soft text-accent",
  hot: "bg-hot-soft text-hot",
  good: "bg-good-soft text-good",
  muted: "bg-subtle text-muted",
} as const;

function Stat({
  href,
  icon: Icon,
  tone,
  value,
  label,
  note,
  alert = false,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: keyof typeof TONE;
  value: number;
  label: string;
  note?: string;
  alert?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`panel group relative flex flex-col p-5 transition hover:-translate-y-px hover:shadow-lift ${alert ? "border-hot/30" : "hover:border-accent/30"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[13px] leading-snug font-medium text-muted">{label}</span>
        <span className={`grid size-8 flex-none place-items-center rounded-lg ${TONE[tone]}`}>
          <Icon className="size-4" />
        </span>
      </div>
      <div className={`mt-2 text-[32px] leading-none font-semibold tracking-tight tabular-nums ${alert ? "text-hot" : "text-ink"}`}>{value}</div>
      <div className="mt-2 flex items-center justify-between gap-2 text-[12.5px] text-muted">
        <span className="truncate">{note ?? "\u00a0"}</span>
        <ArrowRight className="size-3.5 flex-none text-faint opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
      </div>
    </Link>
  );
}
