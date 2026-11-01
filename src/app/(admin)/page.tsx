import Link from "next/link";
import { redirect } from "next/navigation";
import { AlarmClock, ArrowRight, CalendarDays, Phone, Plus } from "lucide-react";
import { Avatar, NameFlag } from "@/components/badges";
import { formatDate } from "@/lib/format";
import {
  BUCKET_LABEL,
  budgetLabel,
  countWord,
  displayName,
  followUpBucket,
  followUpLabel,
  formatTime,
  propertyLabel,
  timelineLabel,
  type FollowUpBucket,
} from "@/lib/lead-display";
import { getStore } from "@/lib/store";
import type { LeadFacts } from "@/lib/store/types";
import type { Lead } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Old Leads links (/?f=hot) now live at /leads. */
const OLD_FILTER: Record<string, string> = { open: "open", due: "due", chetan: "chetan", hot: "hot", warm: "warm", cold: "cold", lost: "lost", all: "all" };

const QUEUE_SIZE = 8;

/** Budget bands for the market brief, from what the forms actually collect. */
function budgetBand(f: LeadFacts): string {
  const v = f.budget_max_inr ?? f.budget_min_inr;
  if (v == null) return "Not asked";
  if (v < 5_000_000) return "Under ₹50 L";
  if (v < 6_000_000) return "₹50–60 L";
  if (v < 10_000_000) return "₹60 L–1 Cr";
  return "₹1 Cr+";
}

function tally(values: string[], order?: string[]): [string, number][] {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  const rows = [...m.entries()];
  return order ? rows.sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])) : rows.sort((a, b) => b[1] - a[1]);
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const { f } = await searchParams;
  if (f && OLD_FILTER[f]) redirect(OLD_FILTER[f] === "open" ? "/leads" : `/leads?view=${OLD_FILTER[f]}`);

  const store = getStore();
  const now = new Date();
  const weekAhead = new Date(now.getTime() + 7 * 86_400_000).toISOString();

  const [counts, queue, facts, slots, booked] = await Promise.all([
    store.countLeads(["all", "open", "hot", "due", "overdue", "chetan"]),
    store.queryLeads({ view: "open", pageSize: QUEUE_SIZE }),
    store.leadFacts(),
    store.listSlots({ from: now.toISOString() }),
    store.listVisits({ status: "booked" }),
  ]);

  const slotById = new Map(slots.map((s) => [s.id, s]));
  const upcoming = booked
    .map((v) => ({ v, slot: slotById.get(v.slot_id) }))
    .filter((x): x is { v: typeof x.v; slot: NonNullable<typeof x.slot> } => !!x.slot)
    .sort((a, b) => a.slot.starts_at.localeCompare(b.slot.starts_at));
  const visitsThisWeek = upcoming.filter((x) => x.slot.starts_at <= weekAhead).length;
  const visitLeads = new Map(
    (await Promise.all(upcoming.slice(0, 4).map((x) => store.getLead(x.v.lead_id)))).filter((l): l is Lead => !!l).map((l) => [l.id, l]),
  );

  // The call queue: the next leads to call, grouped by when they're due.
  const groups: { bucket: FollowUpBucket; leads: Lead[] }[] = [];
  for (const l of queue.rows) {
    const bucket = followUpBucket(l.next_follow_up_at, now);
    const last = groups.at(-1);
    if (last?.bucket === bucket) last.leads.push(l);
    else groups.push({ bucket, leads: [l] });
  }

  const openFacts = facts.filter((x) => x.status !== "converted" && x.status !== "lost");
  const types = tally(openFacts.map((x) => propertyLabel(x.property_type) ?? "Not asked"));
  const budgets = tally(openFacts.map(budgetBand), ["Under ₹50 L", "₹50–60 L", "₹60 L–1 Cr", "₹1 Cr+", "Not asked"]);
  const noLocation = openFacts.filter((x) => !x.micro_market).length;
  const noBudget = openFacts.filter((x) => x.budget_min_inr == null && x.budget_max_inr == null).length;

  const hour = Number(now.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", hour12: false }));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const today = now.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long" });
  const plural = (n: number, w: string) => `${countWord(n)} ${w}${n === 1 ? "" : "s"}`;

  return (
    <div className="grid gap-14 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0">
        <div className="eyebrow">{today}</div>
        <p className="mt-4 max-w-[700px] font-serif text-[32px] leading-[1.18] tracking-[-0.015em] sm:text-[38px]">
          {greeting}. You have{" "}
          {counts.overdue > 0 ? <span className="text-hot">{plural(counts.overdue, "overdue follow-up")}</span> : "no overdue follow-ups"} and{" "}
          {counts.due > 0 ? `${countWord(counts.due)} due` : "nothing due"} today,{" "}
          <span className="text-muted">
            with {counts.open} open lead{counts.open === 1 ? "" : "s"} in the pipeline.
          </span>
        </p>
        <div className="mt-6 flex flex-wrap gap-2.5">
          <Link href={counts.overdue > 0 ? "/leads?view=overdue" : counts.due > 0 ? "/leads?view=due" : "/leads"} className="btn h-10 px-4">
            <Phone className="size-4" />
            Start calling
          </Link>
          <Link href="/leads/new" className="btn-ghost h-10 px-4">
            <Plus className="size-4" />
            Add lead
          </Link>
        </div>

        <dl className="mt-8 grid grid-cols-2 border-y border-line sm:grid-cols-5">
          <Figure href="/leads" value={counts.open} label="Open leads" />
          <Figure href="/leads?view=overdue" value={counts.overdue} label="Overdue" alert={counts.overdue > 0} />
          <Figure href="/leads?view=due" value={counts.due} label="Due today" />
          <Figure href="/leads?view=hot" value={counts.hot} label="Hot leads" />
          <Figure href="/visits" value={visitsThisWeek} label="Site visits this week" />
        </dl>

        <div className="mt-10 flex items-baseline justify-between">
          <h2 className="text-[15px] font-semibold">Call queue</h2>
          <Link href="/leads" className="flex items-center gap-1 text-[13px] text-muted hover:text-ink">
            All leads <ArrowRight className="size-3.5" />
          </Link>
        </div>
        {groups.length === 0 ? (
          <p className="mt-4 text-sm text-muted">No open leads. New enquiries will appear here.</p>
        ) : (
          <ul className="mt-1">
            {groups.map((g) => (
              <li key={g.bucket}>
                <div className={`flex items-center gap-2 pt-4 pb-1.5 text-xs font-semibold ${g.bucket === "overdue" ? "text-hot" : "text-muted"}`}>
                  {g.bucket === "overdue" ? <AlarmClock className="size-3.5" /> : <CalendarDays className="size-3.5" />}
                  {BUCKET_LABEL[g.bucket]}
                  {g.bucket === "overdue" && <span className="font-medium">· {counts.overdue}</span>}
                </div>
                <ul>
                  {g.leads.map((l) => (
                    <QueueRow key={l.id} lead={l} bucket={g.bucket} />
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>

      <aside className="space-y-9 xl:pt-1">
        <section>
          <div className="eyebrow">Market brief</div>
          <h3 className="mt-3 mb-2 text-[13px] font-semibold">What buyers want</h3>
          <Bars rows={types} total={openFacts.length} />
          <h3 className="mt-6 mb-2 text-[13px] font-semibold">Budget</h3>
          <Bars rows={budgets} total={openFacts.length} gold />
        </section>

        {(noLocation > 0 || counts.chetan > 0) && (
          <section>
            <h3 className="mb-2.5 text-[13px] font-semibold">Worth knowing</h3>
            <div className="space-y-2.5">
              {noLocation > 0 && (
                <p className="rounded-xl border border-gold-line bg-gold-soft px-4 py-3 text-[13px] leading-relaxed text-ink-2">
                  <b className="text-ink">{noLocation === openFacts.length ? `None of the ${noLocation}` : noLocation}</b> open lead
                  {noLocation === 1 ? " has" : "s have"} a location recorded, and <b className="text-ink">{noBudget}</b> have no budget. A lead
                  needs both before it can be Warm or Hot, so ask these on the next call.
                </p>
              )}
              {counts.chetan > 0 && (
                <Link href="/leads?view=chetan" className="block rounded-xl border border-hot/20 bg-hot-soft px-4 py-3 text-[13px] text-hot hover:underline">
                  {counts.chetan} lead{counts.chetan === 1 ? "" : "s"} asked about price or offers and need a personal reply.
                </Link>
              )}
            </div>
          </section>
        )}

        <section>
          <div className="mb-2.5 flex items-baseline justify-between">
            <h3 className="text-[13px] font-semibold">Upcoming site visits</h3>
            <Link href="/visits" className="text-[12.5px] text-muted hover:text-ink">
              All visits
            </Link>
          </div>
          {upcoming.length === 0 ? (
            <p className="text-[13px] text-muted">
              None booked.{" "}
              <Link href="/visits" className="text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink">
                Open visit slots
              </Link>
            </p>
          ) : (
            <ul className="space-y-2.5">
              {upcoming.slice(0, 4).map(({ v, slot }) => {
                const lead = visitLeads.get(v.lead_id);
                return (
                  <li key={v.id} className="flex items-center gap-3">
                    <div className="w-12 flex-none rounded-lg border border-line bg-surface py-1 text-center">
                      <div className="text-[10px] font-semibold text-gold-ink uppercase">{formatDate(slot.starts_at).split(" ")[1]}</div>
                      <div className="text-[15px] leading-tight font-semibold tabular-nums">{formatDate(slot.starts_at).split(" ")[0]}</div>
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-[13.5px] font-semibold">{displayName(lead?.name).name}</div>
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
      </aside>
    </div>
  );
}

function Figure({ href, value, label, alert = false }: { href: string; value: number; label: string; alert?: boolean }) {
  return (
    <Link href={href} className="group border-line py-4 pr-4 transition hover:bg-surface/60 sm:border-l sm:pl-4 sm:first:border-l-0 sm:first:pl-0">
      <dd className={`text-[28px] leading-none font-semibold tracking-[-0.03em] tabular-nums ${alert ? "text-hot" : "text-ink"}`}>{value}</dd>
      <dt className="mt-1.5 text-[12.5px] text-muted group-hover:text-ink">{label}</dt>
    </Link>
  );
}

function QueueRow({ lead: l, bucket }: { lead: Lead; bucket: FollowUpBucket }) {
  const dn = displayName(l.name);
  const facts = [propertyLabel(l.property_type), budgetLabel(l), timelineLabel(l.timeline_months)].filter(Boolean).join(" · ");
  const when =
    bucket === "overdue"
      ? followUpLabel(l.next_follow_up_at).replace(" overdue", " late")
      : bucket === "today" || bucket === "tomorrow"
        ? formatTime(l.next_follow_up_at!)
        : bucket === "none"
          ? "—"
          : formatDate(l.next_follow_up_at!);
  return (
    <li className="group -mx-2.5 grid grid-cols-[64px_auto_minmax(0,1fr)_auto] items-center gap-3.5 rounded-xl px-2.5 py-2.5 transition hover:bg-surface hover:shadow-card sm:grid-cols-[78px_auto_minmax(0,1fr)_110px_auto]">
      <span className={`text-[12.5px] tabular-nums ${bucket === "overdue" ? "font-semibold text-hot" : "text-muted"}`}>{when}</span>
      <Avatar name={l.name} />
      <div className="min-w-0">
        <Link href={`/leads/${l.id}`} className="flex items-center gap-1.5 text-sm font-semibold hover:text-accent">
          <span className="truncate">{dn.name}</span>
          <NameFlag raw={dn.raw} />
        </Link>
        <div className="truncate text-[12.5px] text-muted">{facts || "Requirement not asked yet"}</div>
      </div>
      <span className="hidden text-[12.5px] text-faint sm:block">Unassigned</span>
      <Link
        href={`/leads?view=open&call=${l.id}`}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent-soft px-3 text-[13px] font-semibold text-accent transition group-hover:bg-accent group-hover:text-white"
      >
        <Phone className="size-3.5" />
        Call
      </Link>
    </li>
  );
}

function Bars({ rows, total, gold = false }: { rows: [string, number][]; total: number; gold?: boolean }) {
  return (
    <ul className="space-y-2">
      {rows.map(([label, n]) => (
        <li key={label} className="grid grid-cols-[96px_minmax(0,1fr)_32px] items-center gap-2.5 text-[13px]">
          <span className="truncate">{label}</span>
          <span className="h-1.5 overflow-hidden rounded-full bg-subtle">
            <span className={`block h-full rounded-full ${gold ? "bg-gold" : "bg-navy"}`} style={{ width: `${(n / Math.max(1, total)) * 100}%` }} />
          </span>
          <span className="text-right text-muted tabular-nums">{n}</span>
        </li>
      ))}
    </ul>
  );
}
