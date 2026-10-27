import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  CalendarDays,
  Flag,
  Inbox,
  MessageCircle,
  MessageSquare,
  Phone,
  Repeat,
  Send,
  StickyNote,
  type LucideIcon,
} from "lucide-react";
import { addNoteAction, clearFlagAction, markFollowedUpAction } from "@/app/actions";
import { AssignAgent } from "@/components/assign-agent";
import { Avatar, SOURCE_LABEL, StatusBadge, TemperatureBadge } from "@/components/badges";
import { CallAssistant } from "@/components/calling/call-assistant";
import { CopyButton } from "@/components/copy-button";
import { LeadRowMenu } from "@/components/lead-row-menu";
import { bookingUrlFor } from "@/lib/catcher-config";
import { formatBudget, formatDate, formatDateTime, PURPOSE_LABEL } from "@/lib/format";
import { classify, nextQuestion, unansweredQuestions } from "@/lib/intake-sop";
import { followUpLabel, followUpState, formatPhone, requirementFacts, timelineLabel, whatsappUrl } from "@/lib/lead-display";
import { isReadOnly } from "@/lib/read-only";
import { getStore } from "@/lib/store";
import type { LeadEvent } from "@/lib/types";
import { formatSlot } from "@/lib/visits";
import { CloseLeadForm, EditLeadForm } from "./forms";

export const dynamic = "force-dynamic";

const EVENT: Record<LeadEvent["kind"], { icon: LucideIcon; tone: string; label: string }> = {
  message_in: { icon: MessageSquare, tone: "bg-cold-soft text-cold", label: "Message from buyer" },
  message_out: { icon: Send, tone: "bg-wa-soft text-wa", label: "Message sent" },
  note: { icon: StickyNote, tone: "bg-subtle text-muted", label: "Note" },
  status_change: { icon: Repeat, tone: "bg-new-soft text-new", label: "Status change" },
  flag: { icon: Flag, tone: "bg-hot-soft text-hot", label: "Flag" },
};

interface TimelineItem {
  key: string;
  kind: "message" | "other";
  at: string;
  icon: LucideIcon;
  tone: string;
  title: string;
  body?: string;
}

const FOLLOW_TONE = {
  overdue: "bg-hot-soft text-hot",
  today: "bg-warm-soft text-warm",
  upcoming: "bg-accent-soft text-accent",
} as const;
const ASK_LABEL: Record<string, string> = {
  budget: "budget",
  micro_market: "location",
  property_type: "property type",
  purpose: "purpose",
  timeline: "buying timeline",
};
const FOLLOW_LABEL = { overdue: "Overdue", today: "Due today", upcoming: "Upcoming" } as const;

export default async function LeadDetailsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ call?: string; tab?: string }>;
}) {
  const { id } = await params;
  const { call, tab: rawTab } = await searchParams;
  const tab = rawTab === "calls" || rawTab === "messages" ? rawTab : null;
  const store = getStore();
  const lead = await store.getLead(id);
  if (!lead) notFound();
  const [touches, events, visits] = await Promise.all([store.listTouches(id), store.listEvents(id), store.listVisits({ leadId: id })]);
  const visitSlots = await Promise.all(visits.map((v) => store.getSlot(v.slot_id)));
  const readOnly = isReadOnly();
  const bookingLink = bookingUrlFor(lead.id);
  const enquiredAt = touches[0]?.received_at ?? lead.created_at;
  const missing = unansweredQuestions(lead);
  const ask = nextQuestion(lead);
  const why = classify(lead).reasons;
  const closed = lead.status === "lost" || lead.status === "converted";
  const fuState = followUpState(lead.next_follow_up_at);

  const timeline: TimelineItem[] = [
    ...events.map((e): TimelineItem => ({
      key: e.id,
      kind: e.kind.startsWith("message") ? "message" : "other",
      at: e.created_at,
      icon: EVENT[e.kind].icon,
      tone: EVENT[e.kind].tone,
      title: EVENT[e.kind].label + (e.channel && e.kind.startsWith("message") ? ` · ${SOURCE_LABEL[e.channel]}` : ""),
      body: e.body,
    })),
    ...touches.map((t): TimelineItem => ({
      key: t.id,
      kind: "other",
      at: t.received_at,
      icon: Inbox,
      tone: "bg-accent-soft text-accent",
      title: `Enquiry from ${SOURCE_LABEL[t.source]}`,
    })),
    ...visits.map((v, i): TimelineItem => ({
      key: v.id,
      kind: "other",
      at: v.created_at,
      icon: CalendarDays,
      tone: "bg-good-soft text-good",
      title: `Site visit ${v.status.replace("_", "-")}`,
      body: visitSlots[i] ? `${formatSlot(visitSlots[i]!)}, ${visitSlots[i]!.area}` : undefined,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const lastMessage = events.find((e) => e.kind === "message_in" || e.kind === "message_out");
  const lastActivity = timeline[0]?.at ?? null;
  const shown = tab === "messages" ? timeline.filter((t) => t.kind === "message") : tab === "calls" ? [] : timeline;
  const tabHref = (t: string | null) => `/leads/${lead.id}${t ? `?tab=${t}` : ""}`;

  const customer: [string, React.ReactNode][] = [
    ["Phone", <span key="p" className="tabular-nums">{formatPhone(lead.phone)}</span>],
    ["Email", lead.email],
    ["Source", SOURCE_LABEL[lead.first_source]],
    ["Enquired as", lead.brand],
    ["Enquired on", formatDate(enquiredAt)],
  ];
  const requirement: [string, string | null][] = [
    ["Property type", lead.property_type],
    ["Budget", formatBudget(lead.budget_min_inr, lead.budget_max_inr)],
    ["Location", lead.micro_market],
    ["Buying timeline", timelineLabel(lead.timeline_months)],
    ["Purpose", lead.purpose ? PURPOSE_LABEL[lead.purpose] : null],
    ["Site visit", lead.agreed_site_visit ? "Agreed to visit" : null],
  ];

  return (
    <div className={`space-y-5 ${call ? "sm:pr-[500px]" : ""}`}>
      <Link href="/leads" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Back to leads
      </Link>

      {/* Header: who, how to reach them, and the four things to know before calling. */}
      <div className="panel p-0">
        <div className="flex flex-wrap items-center gap-4 p-5 sm:p-6">
          <Avatar name={lead.name} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[26px] leading-tight font-semibold tracking-tight">{lead.name ?? "Unnamed lead"}</h1>
              <TemperatureBadge value={lead.temperature} />
              <StatusBadge value={lead.status} />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
              <span className="font-medium text-ink tabular-nums">{formatPhone(lead.phone)}</span>
              <span aria-hidden>·</span>
              <span>{SOURCE_LABEL[lead.first_source]}</span>
              <span aria-hidden>·</span>
              <span>Enquired {formatDate(enquiredAt)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href={`/leads/${lead.id}?call=1`} scroll={false} className="btn h-10 px-4">
              <Phone className="size-4" /> Call
            </Link>
            <a href={whatsappUrl(lead.phone)} target="_blank" rel="noreferrer" className="btn-wa h-10 px-4">
              <MessageCircle className="size-4" /> WhatsApp
            </a>
            <LeadRowMenu leadId={lead.id} phone={lead.phone} />
          </div>
        </div>
        <dl className="grid grid-cols-2 border-t border-line lg:grid-cols-4 [&>div]:border-line [&>div]:px-5 [&>div]:py-3.5 sm:[&>div]:px-6">
          <div className="border-r border-b lg:border-b-0">
            <dt className="text-[12px] text-muted">Assigned agent</dt>
            <dd className="mt-1">
              <AssignAgent agent={null} />
            </dd>
          </div>
          <div className="border-b lg:border-r lg:border-b-0">
            <dt className="text-[12px] text-muted">Next follow-up</dt>
            <dd className={`mt-1 text-[15px] font-semibold tabular-nums ${fuState === "overdue" ? "text-hot" : closed || !lead.next_follow_up_at ? "text-faint" : ""}`}>
              {closed ? "Closed" : followUpLabel(lead.next_follow_up_at)}
            </dd>
          </div>
          <div className="border-r">
            <dt className="text-[12px] text-muted">Next action</dt>
            <dd className="mt-1 truncate text-[14px] font-medium" title={ask?.ask}>
              {closed ? <span className="text-faint">None</span> : ask ? `Ask their ${ASK_LABEL[ask.key] ?? ask.key}` : lead.agreed_site_visit ? "Book the site visit" : "Follow up"}
            </dd>
          </div>
          <div>
            <dt className="text-[12px] text-muted">Last activity</dt>
            <dd className="mt-1 text-[14px] font-medium tabular-nums">{lastActivity ? formatDateTime(lastActivity) : <span className="text-faint">None yet</span>}</dd>
          </div>
        </dl>
      </div>

      {lead.needs_chetan && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-hot/20 bg-hot-soft px-4 py-3 text-sm text-hot">
          <span>
            <strong>Needs a personal reply:</strong> {lead.needs_chetan_reason}. No automated message goes out until this is cleared.
          </span>
          <form action={clearFlagAction.bind(null, lead.id)}>
            <button className="btn-ghost h-8" disabled={readOnly}>
              I&apos;ve handled it
            </button>
          </form>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          {/* Requirement first: it's what every call is about. */}
          <section className="panel">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-[15px] font-semibold">Requirement</h2>
              <span className="text-[12.5px] text-muted tabular-nums">
                {requirement.filter(([, v]) => v).length} of {requirement.length} known
              </span>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
              {requirement.map(([k, v]) => (
                <div key={k}>
                  <dt className="text-[12px] text-muted">{k}</dt>
                  <dd className={`mt-0.5 text-[14.5px] font-semibold ${v ? "" : "font-normal text-faint"}`}>{v ?? "Not asked yet"}</dd>
                </div>
              ))}
            </dl>
            {ask && !closed && (
              <p className="mt-4 rounded-xl bg-accent-soft px-3.5 py-2.5 text-[13.5px] text-ink">
                <span className="font-semibold text-accent">Ask next:</span> {ask.ask}
              </p>
            )}
            <details className="mt-4 border-t border-line pt-3 text-[13px]">
              <summary className="cursor-pointer font-medium text-muted hover:text-ink">Why it&apos;s tagged {lead.temperature ?? "untagged"}</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
                {why.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              {missing.length > 0 && <p className="mt-2 text-muted">Still unknown: {missing.map((q) => ASK_LABEL[q.key] ?? q.key).join(", ")}.</p>}
            </details>
          </section>

          {/* Conversation: the latest message on top, then calls and the full history. */}
          <section className="panel min-w-0 p-0">
            <div className="p-5 pb-4 sm:px-6">
              <h2 className="text-[15px] font-semibold">Latest conversation</h2>
              {lastMessage ? (
                <div className={`mt-3 rounded-2xl px-4 py-3 ${lastMessage.kind === "message_in" ? "bg-subtle" : "bg-wa-soft"}`}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-[12px] text-muted">
                    <span className="font-medium">
                      {lastMessage.kind === "message_in" ? `${lead.name ?? "Buyer"} wrote` : "We sent"}
                      {lastMessage.channel ? ` on ${SOURCE_LABEL[lastMessage.channel]}` : ""}
                    </span>
                    <time className="tabular-nums">{formatDateTime(lastMessage.created_at)}</time>
                  </div>
                  <p className="mt-1 text-[14px] leading-relaxed whitespace-pre-wrap text-ink">{lastMessage.body}</p>
                </div>
              ) : (
                <p className="mt-2 text-[13.5px] text-muted">No messages with this lead yet.</p>
              )}
            </div>

            <div className="flex items-center gap-1 border-y border-line px-4 sm:px-5" role="tablist" aria-label="History">
              {[
                { key: null, label: "All activity", n: timeline.length },
                { key: "calls", label: "Calls", n: 0 },
                { key: "messages", label: "Messages", n: timeline.filter((t) => t.kind === "message").length },
              ].map((t) => {
                const on = (tab ?? null) === t.key;
                return (
                  <Link
                    key={t.label}
                    href={tabHref(t.key)}
                    scroll={false}
                    role="tab"
                    aria-selected={on}
                    className={`-mb-px border-b-2 px-2.5 py-3 text-[13.5px] font-medium transition ${on ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"}`}
                  >
                    {t.label} <span className="ml-0.5 text-faint tabular-nums">{t.n}</span>
                  </Link>
                );
              })}
            </div>

            <div className="p-5 sm:px-6">
              {tab === "calls" ? (
                <div className="rounded-xl bg-subtle px-4 py-6 text-center">
                  <div className="text-sm font-medium">No calls logged yet</div>
                  <p className="mx-auto mt-1 max-w-sm text-[13px] text-muted">
                    Once call saving is switched on, every call finished in the Calling Assistant shows here with its outcome, answers and agent.
                  </p>
                </div>
              ) : (
                <>
                  {!tab && (
                    <form action={addNoteAction.bind(null, lead.id)} className="mb-5 flex gap-2">
                      <label htmlFor="note" className="sr-only">
                        Add a note
                      </label>
                      <input id="note" name="body" className="input h-10" placeholder="Add a note…" disabled={readOnly} />
                      <button className="btn-ghost h-10" disabled={readOnly}>
                        Add
                      </button>
                    </form>
                  )}
                  {shown.length === 0 ? (
                    <p className="text-[13.5px] text-muted">Nothing here yet.</p>
                  ) : (
                    <ol className="relative space-y-5 before:absolute before:top-2 before:bottom-2 before:left-[15px] before:w-px before:bg-line">
                      {shown.map((t) => {
                        const Icon = t.icon;
                        return (
                          <li key={t.key} className="relative flex gap-3.5">
                            <span className={`relative z-10 grid size-8 flex-none place-items-center rounded-full ring-4 ring-surface ${t.tone}`}>
                              <Icon className="size-4" />
                            </span>
                            <div className="min-w-0 flex-1 pt-1">
                              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                                <span className="text-[14px] font-semibold">{t.title}</span>
                                <time className="text-[12px] text-muted tabular-nums">{formatDateTime(t.at)}</time>
                              </div>
                              {t.body && <p className="mt-0.5 text-[13.5px] leading-relaxed whitespace-pre-wrap text-muted">{t.body}</p>}
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </>
              )}
            </div>
          </section>
        </div>

        {/* Right rail: follow-up, then contact and visits, then the rarely used edits. */}
        <div className="space-y-5">
          <section className="panel">
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-semibold">Follow-up</h2>
              {fuState && !closed && <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${FOLLOW_TONE[fuState]}`}>{FOLLOW_LABEL[fuState]}</span>}
            </div>
            {closed ? (
              <p className="mt-2 text-sm text-muted">Closed{lead.lost_reason ? `: ${lead.lost_reason}` : "."}</p>
            ) : (
              <>
                <p className={`mt-2 text-xl font-semibold tracking-tight tabular-nums ${fuState === "overdue" ? "text-hot" : ""}`}>{followUpLabel(lead.next_follow_up_at)}</p>
                {lead.next_follow_up_at && <p className="text-[12.5px] text-muted">{formatDateTime(lead.next_follow_up_at)}</p>}
                <form action={markFollowedUpAction.bind(null, lead.id)} className="mt-4 space-y-2">
                  <label htmlFor="fu-note" className="sr-only">
                    What happened
                  </label>
                  <input id="fu-note" name="note" className="input h-10" placeholder="What happened? (optional)" disabled={readOnly} />
                  <button className="btn-ghost h-10 w-full" disabled={readOnly}>
                    I followed up
                  </button>
                </form>
                {lead.followups_unanswered > 0 && (
                  <p className="mt-2 text-[12.5px] text-muted">
                    {lead.followups_unanswered} automatic follow-up{lead.followups_unanswered === 1 ? "" : "s"} without a reply.
                  </p>
                )}
              </>
            )}
          </section>

          <section className="panel">
            <h2 className="text-[15px] font-semibold">Contact</h2>
            <dl className="mt-3 space-y-2.5 text-[13.5px]">
              {customer.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <dt className="text-muted">{k}</dt>
                  <dd className="truncate text-right font-medium">{v || <span className="font-normal text-faint">—</span>}</dd>
                </div>
              ))}
            </dl>
            <h3 className="mt-5 border-t border-line pt-4 text-[15px] font-semibold">Site visits</h3>
            {visits.length === 0 ? (
              <p className="mt-1.5 text-[13.5px] text-muted">None booked{lead.agreed_site_visit ? ", though they said yes to a visit." : "."}</p>
            ) : (
              <ul className="mt-2 space-y-1.5 text-[13.5px]">
                {visits.map((v, i) => (
                  <li key={v.id} className={v.status === "cancelled" ? "text-faint line-through" : ""}>
                    {visitSlots[i] ? `${formatSlot(visitSlots[i]!)}, ${visitSlots[i]!.area}` : "Slot removed"} · {v.status.replace("_", "-")}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href={`/match?lead=${lead.id}`} className="btn-ghost h-8 text-[13px]">
                Find matching projects
              </Link>
              {bookingLink && <CopyButton text={bookingLink} label="Copy booking link" />}
            </div>
          </section>

          <section className="panel divide-y divide-line p-0">
            <details className="group px-5 py-4">
              <summary className="cursor-pointer text-[14px] font-semibold">Edit details</summary>
              <fieldset disabled={readOnly} className="mt-4">
                <EditLeadForm lead={lead} />
              </fieldset>
            </details>
            {!closed && (
              <details className="px-5 py-4">
                <summary className="cursor-pointer text-[14px] font-semibold">Close this lead</summary>
                <fieldset disabled={readOnly} className="mt-4">
                  <CloseLeadForm lead={lead} />
                </fieldset>
              </details>
            )}
          </section>
        </div>
      </div>

      {call && (
        <CallAssistant
          lead={{ id: lead.id, name: lead.name, phone: lead.phone, temperature: lead.temperature, agent: null, facts: requirementFacts(lead) }}
          closeHref={`/leads/${lead.id}${tab ? `?tab=${tab}` : ""}`}
          readOnly={readOnly}
        />
      )}
    </div>
  );
}
