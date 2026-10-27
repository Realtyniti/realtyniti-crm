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
const FOLLOW_LABEL = { overdue: "Overdue", today: "Due today", upcoming: "Upcoming" } as const;

export default async function LeadDetailsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ call?: string }>;
}) {
  const { id } = await params;
  const { call } = await searchParams;
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
    ...events.map((e) => ({
      key: e.id,
      at: e.created_at,
      icon: EVENT[e.kind].icon,
      tone: EVENT[e.kind].tone,
      title: EVENT[e.kind].label + (e.channel && e.kind.startsWith("message") ? ` · ${SOURCE_LABEL[e.channel]}` : ""),
      body: e.body,
    })),
    ...touches.map((t) => ({
      key: t.id,
      at: t.received_at,
      icon: Inbox,
      tone: "bg-accent-soft text-accent",
      title: `Enquiry from ${SOURCE_LABEL[t.source]}`,
    })),
    ...visits.map((v, i) => ({
      key: v.id,
      at: v.created_at,
      icon: CalendarDays,
      tone: "bg-good-soft text-good",
      title: `Site visit ${v.status.replace("_", "-")}`,
      body: visitSlots[i] ? `${formatSlot(visitSlots[i]!)}, ${visitSlots[i]!.area}` : undefined,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const overview: [string, React.ReactNode][] = [
    ["Phone", <span key="p" className="tabular-nums">{formatPhone(lead.phone)}</span>],
    ["Email", lead.email],
    ["Source", SOURCE_LABEL[lead.first_source]],
    ["Enquired as", lead.brand],
    ["Enquired on", formatDate(enquiredAt)],
    ["Assigned agent", <span key="a" className="text-faint">Unassigned</span>],
  ];
  const requirement: [string, string | null][] = [
    ["Property type", lead.property_type],
    ["Budget", formatBudget(lead.budget_min_inr, lead.budget_max_inr)],
    ["Preferred location", lead.micro_market],
    ["Buying timeline", timelineLabel(lead.timeline_months)],
    ["Purpose", lead.purpose ? PURPOSE_LABEL[lead.purpose] : null],
    ["Site visit", lead.agreed_site_visit ? "Agreed to visit" : null],
  ];

  return (
    <div className={`space-y-5 ${call ? "sm:pr-[440px]" : ""}`}>
      <Link href="/leads" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Back to leads
      </Link>

      {/* Header */}
      <div className="panel flex flex-wrap items-center gap-4">
        <Avatar name={lead.name} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{lead.name ?? "Unnamed lead"}</h1>
            <TemperatureBadge value={lead.temperature} />
            <StatusBadge value={lead.status} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            <span className="tabular-nums">{formatPhone(lead.phone)}</span>
            <span>·</span>
            <span>{SOURCE_LABEL[lead.first_source]}</span>
            <span>·</span>
            <span>Enquired {formatDate(enquiredAt)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/leads/${lead.id}?call=1`} scroll={false} className="btn">
            <Phone className="size-4" /> Call
          </Link>
          <a href={whatsappUrl(lead.phone)} target="_blank" rel="noreferrer" className="btn-wa">
            <MessageCircle className="size-4" /> WhatsApp
          </a>
          <LeadRowMenu leadId={lead.id} phone={lead.phone} />
        </div>
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

      <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)_320px]">
        {/* Customer overview */}
        <div className="space-y-5">
          <section className="panel">
            <h2 className="eyebrow">Customer</h2>
            <dl className="mt-3 space-y-2.5 text-sm">
              {overview.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <dt className="text-muted">{k}</dt>
                  <dd className="text-right font-medium">{v || <span className="font-normal text-faint">—</span>}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section className="panel">
            <h2 className="eyebrow">Requirement</h2>
            <dl className="mt-3 space-y-2.5 text-sm">
              {requirement.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <dt className="text-muted">{k}</dt>
                  <dd className="text-right font-medium">{v ?? <span className="font-normal text-faint">Not asked yet</span>}</dd>
                </div>
              ))}
            </dl>
            <details className="mt-4 border-t border-line pt-3 text-[13px]">
              <summary className="cursor-pointer font-medium text-muted hover:text-ink">Why it&apos;s tagged {lead.temperature ?? "untagged"}</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
                {why.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              {missing.length > 0 && <p className="mt-2 text-muted">Still unknown: {missing.map((q) => q.key.replace("_", " ")).join(", ")}.</p>}
            </details>
          </section>
        </div>

        {/* Timeline */}
        <section className="panel min-w-0">
          <div className="flex items-baseline justify-between">
            <h2 className="font-semibold">Activity</h2>
            <span className="text-[12.5px] text-muted tabular-nums">{timeline.length} entries</span>
          </div>
          <form action={addNoteAction.bind(null, lead.id)} className="mt-3 flex gap-2">
            <label htmlFor="note" className="sr-only">
              Add a note
            </label>
            <input id="note" name="body" className="input" placeholder="Add a note…" disabled={readOnly} />
            <button className="btn-ghost" disabled={readOnly}>
              Add
            </button>
          </form>
          <ol className="relative mt-5 space-y-5 before:absolute before:top-2 before:bottom-2 before:left-[15px] before:w-px before:bg-line">
            {timeline.map((t) => {
              const Icon = t.icon;
              return (
                <li key={t.key} className="relative flex gap-3">
                  <span className={`relative z-10 grid size-8 flex-none place-items-center rounded-full ring-4 ring-surface ${t.tone}`}>
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1 pt-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="text-[13.5px] font-semibold">{t.title}</span>
                      <time className="text-[12px] text-muted tabular-nums">{formatDateTime(t.at)}</time>
                    </div>
                    {t.body && <p className="mt-0.5 text-[13px] whitespace-pre-wrap text-muted">{t.body}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        {/* Next steps */}
        <div className="space-y-5 lg:col-span-2 xl:col-span-1">
          <section className="panel">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Next follow-up</h2>
              {fuState && !closed && <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${FOLLOW_TONE[fuState]}`}>{FOLLOW_LABEL[fuState]}</span>}
            </div>
            {closed ? (
              <p className="mt-2 text-sm text-muted">Closed{lead.lost_reason ? `: ${lead.lost_reason}` : "."}</p>
            ) : (
              <>
                <p className={`mt-2 text-lg font-semibold tabular-nums ${fuState === "overdue" ? "text-hot" : ""}`}>{followUpLabel(lead.next_follow_up_at)}</p>
                {lead.next_follow_up_at && <p className="text-[12.5px] text-muted">{formatDateTime(lead.next_follow_up_at)}</p>}
                <form action={markFollowedUpAction.bind(null, lead.id)} className="mt-3 space-y-2">
                  <label htmlFor="fu-note" className="sr-only">
                    What happened
                  </label>
                  <input id="fu-note" name="note" className="input" placeholder="What happened? (optional)" disabled={readOnly} />
                  <button className="btn-ghost w-full" disabled={readOnly}>
                    I followed up
                  </button>
                </form>
                {lead.followups_unanswered > 0 && (
                  <p className="mt-2 text-[12.5px] text-muted">
                    {lead.followups_unanswered} automatic follow-up{lead.followups_unanswered === 1 ? "" : "s"} without a reply.
                  </p>
                )}
                {ask && (
                  <p className="mt-3 rounded-lg bg-subtle px-3 py-2 text-[13px]">
                    <span className="text-muted">Ask next:</span> {ask.ask}
                  </p>
                )}
              </>
            )}
          </section>

          <section className="panel">
            <h2 className="font-semibold">Site visits</h2>
            {visits.length === 0 ? (
              <p className="mt-2 text-sm text-muted">None booked{lead.agreed_site_visit ? ", though they said yes to a visit." : "."}</p>
            ) : (
              <ul className="mt-2 space-y-1.5 text-sm">
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

          <details className="panel group">
            <summary className="cursor-pointer font-semibold">Edit details</summary>
            <fieldset disabled={readOnly} className="mt-4">
              <EditLeadForm lead={lead} />
            </fieldset>
          </details>

          {!closed && (
            <details className="panel">
              <summary className="cursor-pointer font-semibold">Close this lead</summary>
              <fieldset disabled={readOnly} className="mt-4">
                <CloseLeadForm lead={lead} />
              </fieldset>
            </details>
          )}
        </div>
      </div>

      {call && (
        <CallAssistant
          lead={{ id: lead.id, name: lead.name, phone: lead.phone, temperature: lead.temperature, agent: null, facts: requirementFacts(lead) }}
          closeHref={`/leads/${lead.id}`}
          readOnly={readOnly}
        />
      )}
    </div>
  );
}
