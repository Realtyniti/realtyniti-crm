import Link from "next/link";
import { Fragment } from "react";
import { AlarmClock, CalendarDays, ChevronLeft, ChevronRight, MessageCircle, Phone, Plus, Search, SlidersHorizontal, Upload } from "lucide-react";
import { Avatar, NameFlag, SOURCE_LABEL, STATUS_LABEL, TemperatureBadge } from "@/components/badges";
import { AssignAgent } from "@/components/assign-agent";
import { CallAssistant } from "@/components/calling/call-assistant";
import { LeadRowMenu } from "@/components/lead-row-menu";
import { formatDate } from "@/lib/format";
import {
  BUCKET_LABEL,
  budgetLabel,
  displayName,
  followUpBucket,
  followUpLabel,
  followUpState,
  formatPhone,
  propertyLabel,
  requirementFacts,
  timelineLabel,
  whatsappUrl,
} from "@/lib/lead-display";
import { LEAD_VIEWS, VIEW_LABEL, type LeadQuery, type LeadView } from "@/lib/lead-views";
import { isReadOnly } from "@/lib/read-only";
import { getStore } from "@/lib/store";
import { LEAD_SOURCES, type Lead, type LeadSource, type LeadStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
/** Always on screen; the rest sit behind Filters. */
const QUICK_VIEWS: LeadView[] = ["open", "due", "overdue", "hot", "warm", "cold", "new", "all"];
const STATUSES = Object.keys(STATUS_LABEL) as LeadStatus[];

type Params = Record<string, string | undefined>;

function parse(p: Params): Required<Pick<LeadQuery, "view" | "page" | "sort">> & LeadQuery {
  return {
    view: (LEAD_VIEWS as readonly string[]).includes(p.view ?? "") ? (p.view as LeadView) : "open",
    q: p.q?.trim() || null,
    source: LEAD_SOURCES.includes(p.source as LeadSource) ? (p.source as LeadSource) : null,
    status: STATUSES.includes(p.status as LeadStatus) ? (p.status as LeadStatus) : null,
    budget: p.budget === "known" || p.budget === "unknown" ? p.budget : null,
    sort: p.sort === "recent" ? "recent" : "followup",
    page: Math.max(1, Number(p.page) || 1),
    pageSize: PAGE_SIZE,
  };
}

function href(q: ReturnType<typeof parse>, patch: Partial<Record<keyof LeadQuery | "call", string | number | null>>) {
  const merged: Record<string, string | number | null | undefined> = {
    view: q.view === "open" ? null : q.view,
    q: q.q,
    source: q.source,
    status: q.status,
    budget: q.budget,
    sort: q.sort === "followup" ? null : q.sort,
    page: q.page === 1 ? null : q.page,
    ...patch,
  };
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) if (v != null && v !== "") sp.set(k, String(v));
  const s = sp.toString();
  return s ? `/leads?${s}` : "/leads";
}

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const query = parse(params);
  const store = getStore();
  const [{ rows, total }, counts, callLead] = await Promise.all([
    store.queryLeads(query),
    store.countLeads(QUICK_VIEWS),
    params.call ? store.getLead(params.call) : Promise.resolve(null),
  ]);
  const enquired = await store.firstTouchAt(rows.map((r) => r.id));
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const advanced = [query.source, query.status, query.budget, query.sort === "recent" ? "x" : null].filter(Boolean).length;
  const from = total === 0 ? 0 : (query.page - 1) * PAGE_SIZE + 1;
  // With the Calling Assistant open the list keeps only what a caller needs; the panel shows the requirement.
  const cols = columnClasses(!!callLead);
  // Sorted by follow-up, rows fall into Overdue / Today / Tomorrow / … groups.
  const grouped = query.sort === "followup";

  return (
    <div className={callLead ? "lg:pr-[600px]" : ""}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="eyebrow">Pipeline</div>
          <h1 className="page-title mt-2">Leads</h1>
          {query.q && (
            <p className="mt-2 text-sm text-muted">
              {total} result{total === 1 ? "" : "s"} for “{query.q}” ·{" "}
              <Link href={href(query, { q: null, page: null })} className="text-accent hover:underline">
                clear search
              </Link>
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Link href="/import" className="btn-ghost h-9">
            <Upload className="size-4" />
            Import
          </Link>
          <Link href="/leads/new" className="btn h-9">
            <Plus className="size-4" />
            Add lead
          </Link>
        </div>
      </div>

      {/* Views */}
      <div className="mt-6 -mx-1 flex gap-0.5 overflow-x-auto border-b border-line px-1" role="tablist" aria-label="Lead views">
        {QUICK_VIEWS.map((v) => {
          const on = v === query.view;
          const warn = v === "overdue" && counts[v] > 0;
          return (
            <Link
              key={v}
              href={href(query, { view: v === "open" ? null : v, page: null })}
              role="tab"
              aria-selected={on}
              className={`-mb-px flex flex-none items-center gap-1.5 border-b-2 px-2.5 pt-2 pb-2.5 text-[13.5px] font-medium transition ${
                on ? "border-navy text-ink" : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {VIEW_LABEL[v]}
              <span className={`text-xs tabular-nums ${warn ? "font-semibold text-hot" : "text-faint"}`}>{counts[v]}</span>
            </Link>
          );
        })}
      </div>

      {/* Search and filters */}
      <div className="mt-3 flex items-center gap-2">
        <form action="/leads" role="search" className="relative w-full max-w-[280px]">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-faint" />
          <label htmlFor="leads-search" className="sr-only">
            Search by name or phone
          </label>
          <input id="leads-search" name="q" type="search" defaultValue={query.q ?? ""} placeholder="Name or phone" className="input h-9 pl-8 text-[13px]" />
          {query.view !== "open" && <input type="hidden" name="view" value={query.view} />}
        </form>
        <div className="flex-1" />
        <details className="group relative flex-none self-start">
          <summary className="btn-ghost h-9 cursor-pointer text-[13px] list-none [&::-webkit-details-marker]:hidden">
            <SlidersHorizontal className="size-4" />
            Filters
            {advanced > 0 && <span className="rounded-full bg-accent px-1.5 text-[11px] text-white">{advanced}</span>}
          </summary>
          <form action="/leads" className="absolute right-0 z-20 mt-2 w-72 space-y-3 rounded-xl border border-line bg-surface p-4 shadow-lift">
            {query.q && <input type="hidden" name="q" value={query.q} />}
            <div>
              <label htmlFor="f-view" className="label">
                Show
              </label>
              <select id="f-view" name="view" defaultValue={query.view} className="input">
                {LEAD_VIEWS.map((v) => (
                  <option key={v} value={v}>
                    {VIEW_LABEL[v]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="f-source" className="label">
                Source
              </label>
              <select id="f-source" name="source" defaultValue={query.source ?? ""} className="input">
                <option value="">Any source</option>
                {LEAD_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {SOURCE_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="f-status" className="label">
                Status
              </label>
              <select id="f-status" name="status" defaultValue={query.status ?? ""} className="input">
                <option value="">Any status</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="f-budget" className="label">
                Budget
              </label>
              <select id="f-budget" name="budget" defaultValue={query.budget ?? ""} className="input">
                <option value="">Known or not</option>
                <option value="known">Budget known</option>
                <option value="unknown">Budget not asked yet</option>
              </select>
            </div>
            <div>
              <label htmlFor="f-sort" className="label">
                Sort by
              </label>
              <select id="f-sort" name="sort" defaultValue={query.sort} className="input">
                <option value="followup">Next follow-up first</option>
                <option value="recent">Newest first</option>
              </select>
            </div>
            <div className="flex gap-2 pt-1">
              <Link href={href(query, { source: null, status: null, budget: null, sort: null, page: null })} className="btn-ghost flex-1">
                Reset
              </Link>
              <button className="btn flex-1">Apply</button>
            </div>
          </form>
        </details>
      </div>

      {/* Desktop table */}
      <div className="mt-3 overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
        {rows.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <div className="text-[15px] font-semibold">No leads in this view</div>
            <p className="mt-1 text-sm text-muted">
              {query.view === "due" || query.view === "overdue" ? "Nothing to chase right now." : "Try another view or clear the filters."}
            </p>
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-[#fcfbf8] text-left text-[12px] font-medium text-muted">
                  <th className="px-4 py-3">Client</th>
                  <th className={`px-4 py-3 ${cols.req}`}>Looking for</th>
                  <th className={`px-4 py-3 ${cols.budget}`}>Budget</th>
                  <th className={`px-4 py-3 ${cols.tag}`}>Tag</th>
                  <th className={`px-4 py-3 ${cols.agent}`}>Agent</th>
                  <th className="px-4 py-3 whitespace-nowrap">Next follow-up</th>
                  <th className={`px-4 py-3 ${cols.enquired}`}>Enquired</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l, i) => {
                  const bucket = followUpBucket(l.next_follow_up_at);
                  const newGroup = grouped && (i === 0 || followUpBucket(rows[i - 1]!.next_follow_up_at) !== bucket);
                  return (
                    <Fragment key={l.id}>
                      {newGroup && (
                        <tr>
                          <td colSpan={8} className={`px-4 pt-4 pb-1.5 text-xs font-semibold ${bucket === "overdue" ? "text-hot" : "text-ink-2"}`}>
                            <span className="flex items-center gap-1.5">
                              {bucket === "overdue" ? <AlarmClock className="size-3.5" /> : <CalendarDays className="size-3.5" />}
                              {BUCKET_LABEL[bucket]}
                            </span>
                          </td>
                        </tr>
                      )}
                      <LeadRow lead={l} enquiredAt={enquired[l.id] ?? l.created_at} callHref={href(query, { call: l.id })} selected={callLead?.id === l.id} cols={cols} first={newGroup} />
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            </div>

            {/* Phones and small tablets: cards */}
            <ul className="divide-y divide-line md:hidden">
              {rows.map((l) => (
                <LeadCard key={l.id} lead={l} callHref={href(query, { call: l.id })} />
              ))}
            </ul>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-[13px] text-muted">
              <span className="tabular-nums">
                Showing {from}–{from + rows.length - 1} of {total}
              </span>
              {pages > 1 && (
                <nav className="flex items-center gap-1" aria-label="Pages">
                  <PageLink disabled={query.page <= 1} to={href(query, { page: query.page - 1 })} label="Previous page">
                    <ChevronLeft className="size-4" />
                  </PageLink>
                  {Array.from({ length: pages }, (_, i) => i + 1)
                    .filter((p) => p === 1 || p === pages || Math.abs(p - query.page) <= 1)
                    .map((p, i, arr) => (
                      <span key={p} className="flex items-center gap-1">
                        {i > 0 && p - arr[i - 1]! > 1 && <span className="px-1">…</span>}
                        <Link
                          href={href(query, { page: p })}
                          aria-current={p === query.page ? "page" : undefined}
                          className={`grid size-8 place-items-center rounded-lg tabular-nums ${
                            p === query.page ? "bg-accent font-semibold text-white" : "hover:bg-subtle"
                          }`}
                        >
                          {p}
                        </Link>
                      </span>
                    ))}
                  <PageLink disabled={query.page >= pages} to={href(query, { page: query.page + 1 })} label="Next page">
                    <ChevronRight className="size-4" />
                  </PageLink>
                </nav>
              )}
            </div>
          </>
        )}
      </div>

      {callLead && (
        <CallAssistant
          lead={{
            id: callLead.id,
            name: callLead.name,
            phone: callLead.phone,
            temperature: callLead.temperature,
            agent: null,
            facts: requirementFacts(callLead),
          }}
          closeHref={href(query, { call: null })}
          readOnly={isReadOnly()}
        />
      )}
    </div>
  );
}

function columnClasses(compact: boolean) {
  return compact
    ? { req: "hidden", budget: "hidden", tag: "hidden 2xl:table-cell", agent: "hidden 2xl:table-cell", enquired: "hidden" }
    : { req: "", budget: "hidden", tag: "", agent: "hidden lg:table-cell", enquired: "hidden 2xl:table-cell" };
}

function PageLink({ disabled, to, label, children }: { disabled: boolean; to: string; label: string; children: React.ReactNode }) {
  if (disabled) {
    return (
      <span aria-hidden className="grid size-8 place-items-center rounded-lg opacity-40">
        {children}
      </span>
    );
  }
  return (
    <Link href={to} aria-label={label} className="grid size-8 place-items-center rounded-lg hover:bg-subtle">
      {children}
    </Link>
  );
}

function FollowUp({ iso }: { iso: string | null }) {
  const state = followUpState(iso);
  const tone = state === "overdue" ? "font-semibold text-hot" : state === "today" ? "font-semibold text-ink" : iso ? "text-ink-2" : "text-faint";
  const dot = state === "overdue" ? "bg-hot" : state === "today" ? "bg-gold" : iso ? "bg-navy/70" : "bg-line-strong";
  return (
    <span className={`inline-flex items-center gap-2 text-[13px] tabular-nums ${tone}`}>
      <span className={`size-1.5 flex-none rounded-full ${dot}`} />
      {followUpLabel(iso)}
    </span>
  );
}

function CallButton({ href }: { href: string }) {
  return (
    <Link
      href={href}
      scroll={false}
      title="Open the Calling Assistant"
      className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent-soft px-3 text-[13px] font-semibold text-accent transition group-hover:bg-accent group-hover:text-white hover:bg-accent-hover hover:text-white"
    >
      <Phone className="size-3.5" />
      Call
    </Link>
  );
}

function WhatsAppButton({ phone }: { phone: string }) {
  return (
    <a
      href={whatsappUrl(phone)}
      target="_blank"
      rel="noreferrer"
      aria-label="Open WhatsApp chat"
      title="WhatsApp"
      className="grid size-8 place-items-center rounded-lg bg-wa-soft text-wa transition hover:bg-wa hover:text-white"
    >
      <MessageCircle className="size-4" />
    </a>
  );
}

function LeadRow({
  lead: l,
  enquiredAt,
  callHref,
  selected,
  cols,
  first,
}: {
  lead: Lead;
  enquiredAt: string;
  callHref: string;
  selected: boolean;
  cols: ReturnType<typeof columnClasses>;
  first: boolean;
}) {
  const dn = displayName(l.name);
  const tags = [propertyLabel(l.property_type), budgetLabel(l), timelineLabel(l.timeline_months)].filter(Boolean) as string[];
  return (
    <tr className={`group relative transition ${first ? "" : "border-t border-subtle"} ${selected ? "bg-gold-soft shadow-[inset_3px_0_0_var(--color-gold)]" : "hover:bg-[#fcfaf6]"}`}>
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <Avatar name={l.name} />
          <div className="min-w-0">
            <Link href={`/leads/${l.id}`} className="flex max-w-[230px] items-center gap-1.5 text-[14px] font-semibold text-ink hover:text-accent">
              <span className="truncate">{dn.name}</span>
              <NameFlag raw={dn.raw} />
            </Link>
            <div className="text-[12px] text-faint tabular-nums">{formatPhone(l.phone)}</div>
          </div>
        </div>
      </td>
      <td className={`px-4 py-3 ${cols.req}`}>
        <div className="flex max-w-[320px] flex-wrap gap-1.5">
          {tags.map((t) => (
            <span key={t} className="rounded-md bg-subtle px-2 py-0.5 text-[12.5px] whitespace-nowrap text-ink-2">
              {t}
            </span>
          ))}
          {!budgetLabel(l) && <span className="rounded-md border border-dashed border-line-strong px-2 py-0.5 text-[12.5px] whitespace-nowrap text-faint">Budget not asked</span>}
          {l.needs_chetan && <span className="rounded-md bg-hot-soft px-2 py-0.5 text-[12.5px] font-medium whitespace-nowrap text-hot">Needs reply</span>}
        </div>
      </td>
      <td className={`px-4 py-3 whitespace-nowrap tabular-nums ${cols.budget}`}>{budgetLabel(l) ?? <span className="text-faint">—</span>}</td>
      <td className={`px-4 py-3 ${cols.tag}`}>
        <TemperatureBadge value={l.temperature} />
      </td>
      <td className={`px-4 py-3 ${cols.agent}`}>
        <AssignAgent agent={null} />
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <FollowUp iso={l.next_follow_up_at} />
      </td>
      <td className={`px-4 py-3 whitespace-nowrap text-muted tabular-nums ${cols.enquired}`}>{formatDate(enquiredAt)}</td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1.5">
          <CallButton href={callHref} />
          <WhatsAppButton phone={l.phone} />
          <LeadRowMenu leadId={l.id} phone={l.phone} />
        </div>
      </td>
    </tr>
  );
}

function LeadCard({ lead: l, callHref }: { lead: Lead; callHref: string }) {
  const facts = [propertyLabel(l.property_type), budgetLabel(l), l.micro_market].filter(Boolean).join(" · ");
  return (
    <li className="px-4 py-3.5">
      <div className="flex items-start gap-3">
        <Avatar name={l.name} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <Link href={`/leads/${l.id}`} className="flex min-w-0 items-center gap-1.5 font-semibold">
              <span className="truncate">{displayName(l.name).name}</span>
              <NameFlag raw={displayName(l.name).raw} />
            </Link>
            <TemperatureBadge value={l.temperature} />
          </div>
          <div className="text-[12.5px] text-muted tabular-nums">{formatPhone(l.phone)}</div>
          <div className="mt-1 text-[13px]">{facts || <span className="text-faint">Requirement not asked yet</span>}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
            <span>
              Follow-up: <FollowUp iso={l.next_follow_up_at} />
            </span>
            <AssignAgent agent={null} compact />
          </div>
          <div className="mt-2.5 flex items-center gap-2">
            <Link href={callHref} scroll={false} className="btn-call h-9 flex-1">
              <Phone className="size-4" /> Call
            </Link>
            <a href={whatsappUrl(l.phone)} target="_blank" rel="noreferrer" className="btn-wa h-9 flex-1">
              <MessageCircle className="size-4" /> WhatsApp
            </a>
            <LeadRowMenu leadId={l.id} phone={l.phone} />
          </div>
        </div>
      </div>
    </li>
  );
}

