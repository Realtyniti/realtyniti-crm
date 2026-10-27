import Link from "next/link";
import { ChevronLeft, ChevronRight, MessageCircle, Phone, SlidersHorizontal } from "lucide-react";
import { Avatar, SOURCE_LABEL, STATUS_LABEL, TemperatureBadge } from "@/components/badges";
import { CallAssistant } from "@/components/calling/call-assistant";
import { LeadRowMenu } from "@/components/lead-row-menu";
import { formatBudget, formatDate } from "@/lib/format";
import { followUpLabel, followUpState, formatPhone, requirementFacts, whatsappUrl } from "@/lib/lead-display";
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
  // With the Calling Assistant open the list keeps only what a caller needs.
  const cols = columnClasses(!!callLead);

  return (
    <div className={callLead ? "sm:pr-[440px]" : ""}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
          <p className="mt-0.5 text-sm text-muted">
            {query.q ? (
              <>
                {total} result{total === 1 ? "" : "s"} for “{query.q}” ·{" "}
                <Link href={href(query, { q: null, page: null })} className="text-accent hover:underline">
                  clear search
                </Link>
              </>
            ) : (
              "Call, message and follow up with every enquiry."
            )}
          </p>
        </div>
      </div>

      {/* Filter bar */}
      <div className="mt-5 flex items-center gap-2">
        <div className="-mx-1 flex min-w-0 flex-1 gap-1.5 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible" role="tablist" aria-label="Lead views">
          {QUICK_VIEWS.map((v) => {
            const on = v === query.view;
            const warn = (v === "overdue" || v === "due") && counts[v] > 0;
            return (
              <Link
                key={v}
                href={href(query, { view: v === "open" ? null : v, page: null })}
                role="tab"
                aria-selected={on}
                className={`inline-flex flex-none items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium transition ${
                  on ? "border-accent bg-accent text-white" : "border-line bg-surface text-ink hover:bg-subtle"
                }`}
              >
                {VIEW_LABEL[v]}
                <span
                  className={`rounded-full px-1.5 text-[11px] tabular-nums ${
                    on ? "bg-white/20" : warn ? "bg-hot-soft text-hot" : "bg-subtle text-muted"
                  }`}
                >
                  {counts[v]}
                </span>
              </Link>
            );
          })}
        </div>

        <details className="group relative flex-none self-start">
          <summary className="btn-ghost h-9 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
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
      <div className="mt-4 overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
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
                <tr className="border-b border-line bg-subtle/60 text-left text-[11px] font-semibold tracking-[0.06em] text-muted uppercase">
                  <th className="px-4 py-2.5">Client</th>
                  <th className="px-4 py-2.5">Requirement</th>
                  <th className={`px-4 py-2.5 ${cols.budget}`}>Budget</th>
                  <th className="px-4 py-2.5">Tag</th>
                  <th className={`px-4 py-2.5 ${cols.agent}`}>Agent</th>
                  <th className="px-4 py-2.5 whitespace-nowrap">Next follow-up</th>
                  <th className={`px-4 py-2.5 ${cols.enquired}`}>Enquired</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((l) => (
                  <LeadRow key={l.id} lead={l} enquiredAt={enquired[l.id] ?? l.created_at} callHref={href(query, { call: l.id })} selected={callLead?.id === l.id} cols={cols} />
                ))}
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
    ? { budget: "hidden 2xl:table-cell", agent: "hidden", enquired: "hidden" }
    : { budget: "hidden lg:table-cell", agent: "hidden xl:table-cell", enquired: "hidden 2xl:table-cell" };
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
  const tone = state === "overdue" || state === "today" ? "font-semibold text-hot" : iso ? "text-ink" : "text-faint";
  return <span className={`tabular-nums ${tone}`}>{followUpLabel(iso)}</span>;
}

function CallButton({ href }: { href: string }) {
  return (
    <Link href={href} scroll={false} aria-label="Call" title="Call" className="grid size-8 place-items-center rounded-lg bg-accent text-white shadow-sm transition hover:bg-accent-hover">
      <Phone className="size-4" />
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
      className="grid size-8 place-items-center rounded-lg bg-wa text-white shadow-sm transition hover:bg-wa-hover"
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
}: {
  lead: Lead;
  enquiredAt: string;
  callHref: string;
  selected: boolean;
  cols: ReturnType<typeof columnClasses>;
}) {
  const req = [l.property_type, l.micro_market].filter(Boolean).join(" · ");
  return (
    <tr className={`transition ${selected ? "bg-accent-soft/70" : "hover:bg-subtle/50"}`}>
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <Avatar name={l.name} />
          <div className="min-w-0">
            <Link href={`/leads/${l.id}`} className="block max-w-[220px] truncate font-semibold text-ink hover:text-accent">
              {l.name ?? "Unnamed"}
            </Link>
            <div className="text-[12.5px] text-muted tabular-nums">{formatPhone(l.phone)}</div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        {req ? <span className="block max-w-[240px] truncate text-ink" title={req}>{req}</span> : <span className="text-faint">Not asked yet</span>}
        <div className="text-[12px] text-muted">{SOURCE_LABEL[l.first_source]}{l.needs_chetan && <span className="ml-1.5 font-medium text-hot">· needs attention</span>}</div>
      </td>
      <td className={`px-4 py-3 whitespace-nowrap tabular-nums ${cols.budget}`}>
        {formatBudget(l.budget_min_inr, l.budget_max_inr) ?? <span className="text-faint">—</span>}
      </td>
      <td className="px-4 py-3">
        <TemperatureBadge value={l.temperature} />
      </td>
      <td className={`px-4 py-3 ${cols.agent}`}>
        <span className="text-faint">Unassigned</span>
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
  const facts = [l.property_type, formatBudget(l.budget_min_inr, l.budget_max_inr), l.micro_market].filter(Boolean).join(" · ");
  return (
    <li className="px-4 py-3.5">
      <div className="flex items-start gap-3">
        <Avatar name={l.name} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <Link href={`/leads/${l.id}`} className="truncate font-semibold">
              {l.name ?? "Unnamed"}
            </Link>
            <TemperatureBadge value={l.temperature} />
          </div>
          <div className="text-[12.5px] text-muted tabular-nums">{formatPhone(l.phone)}</div>
          <div className="mt-1 text-[13px]">{facts || <span className="text-faint">Requirement not asked yet</span>}</div>
          <div className="mt-1 text-[12.5px]">
            Follow-up: <FollowUp iso={l.next_follow_up_at} />
          </div>
          <div className="mt-2.5 flex items-center gap-2">
            <Link href={callHref} scroll={false} className="btn h-9 flex-1">
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

