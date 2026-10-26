import Link from "next/link";
import { notFound } from "next/navigation";
import { addNoteAction, clearFlagAction, markFollowedUpAction } from "@/app/actions";
import { SourceBadge, STATUS_LABEL, TemperatureBadge } from "@/components/badges";
import { CopyButton } from "@/components/copy-button";
import { bookingUrlFor } from "@/lib/catcher-config";
import { formatDate, formatDateTime } from "@/lib/format";
import { classify, nextQuestion, unansweredQuestions } from "@/lib/intake-sop";
import { getStore } from "@/lib/store";
import { formatSlot } from "@/lib/visits";
import { CloseLeadForm, EditLeadForm } from "./forms";

export const dynamic = "force-dynamic";

const EVENT_STYLE = {
  message_in: "border-sky-300",
  message_out: "border-green-300",
  note: "border-stone-300",
  status_change: "border-violet-300",
  flag: "border-red-400",
} as const;

export default async function LeadCardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = getStore();
  const lead = await store.getLead(id);
  if (!lead) notFound();
  const [touches, events, visits] = await Promise.all([
    store.listTouches(id),
    store.listEvents(id),
    store.listVisits({ leadId: id }),
  ]);
  const visitSlots = await Promise.all(visits.map((v) => store.getSlot(v.slot_id)));
  const bookingLink = bookingUrlFor(lead.id);
  const sources = [...new Set(touches.map((t) => t.source))];
  const missing = unansweredQuestions(lead);
  const ask = nextQuestion(lead);
  const why = classify(lead).reasons;
  const closed = lead.status === "lost" || lead.status === "converted";

  return (
    <div className="space-y-4">
      <Link href="/" className="text-sm text-stone-500 hover:underline">
        ← All leads
      </Link>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{lead.name ?? "Unnamed lead"}</h1>
        <TemperatureBadge value={lead.temperature} />
        <span className="text-sm text-stone-600">{STATUS_LABEL[lead.status]}</span>
        <a href={`https://wa.me/${lead.phone.replace("+", "")}`} className="font-mono text-sm text-green-700 hover:underline">
          {lead.phone}
        </a>
        <div className="flex gap-1">
          {sources.map((s) => (
            <SourceBadge key={s} value={s} />
          ))}
        </div>
        <span className="rounded bg-stone-100 px-2 py-0.5 text-xs text-stone-700" title="The name this buyer enquired with">
          {lead.brand}
        </span>
      </div>

      {lead.needs_chetan && (
        <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          <span>
            <strong>Needs Chetan:</strong> {lead.needs_chetan_reason}. No automated message will be sent until you clear
            this.
          </span>
          <form action={clearFlagAction.bind(null, lead.id)}>
            <button className="btn-ghost">I&apos;ve handled it</button>
          </form>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="panel">
            <h2 className="mb-3 font-medium">Requirement</h2>
            <EditLeadForm lead={lead} />
          </section>

          <section className="panel">
            <h2 className="mb-3 font-medium">History</h2>
            <ol className="space-y-2">
              {events.map((e) => (
                <li key={e.id} className={`border-l-2 pl-3 text-sm ${EVENT_STYLE[e.kind]}`}>
                  <div className="text-xs text-stone-500">
                    {formatDateTime(e.created_at)} · {e.kind.replace("_", " ")}
                    {e.channel ? ` · ${e.channel}` : ""}
                  </div>
                  <div className="whitespace-pre-wrap">{e.body}</div>
                </li>
              ))}
            </ol>
            <form action={addNoteAction.bind(null, lead.id)} className="mt-3 flex gap-2">
              <input name="body" className="input" placeholder="Add a call note…" />
              <button className="btn-ghost">Add</button>
            </form>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="panel space-y-2 text-sm">
            <h2 className="font-medium">Next step</h2>
            {closed ? (
              <p className="text-stone-600">
                Closed{lead.lost_reason ? `: ${lead.lost_reason}` : "."}
              </p>
            ) : (
              <>
                <p>
                  Follow up on <strong>{formatDate(lead.next_follow_up_at)}</strong>
                </p>
                <p className="text-stone-600">
                  {lead.first_reply_at
                    ? `First reply sent ${formatDateTime(lead.first_reply_at)}.`
                    : "No first reply sent yet."}
                  {lead.awaiting_question && ` Waiting for their answer on ${lead.awaiting_question.replace("_", " ")}.`}
                </p>
                <Link href={`/match?lead=${lead.id}`} className="btn-ghost text-xs">
                  Find matching projects
                </Link>
                <form action={markFollowedUpAction.bind(null, lead.id)} className="flex gap-2">
                  <input name="note" className="input" placeholder="What happened? (optional)" />
                  <button className="btn-ghost whitespace-nowrap">I followed up</button>
                </form>
                {lead.followups_unanswered > 0 && (
                  <p className="text-stone-600">
                    {lead.followups_unanswered} automatic follow-up{lead.followups_unanswered === 1 ? "" : "s"} without a reply.
                  </p>
                )}
                {ask ? (
                  <p>
                    Ask next: <em>{ask.ask}</em>
                  </p>
                ) : (
                  <p className="text-green-700">All five questions answered.</p>
                )}
              </>
            )}
          </section>

          <section className="panel space-y-2 text-sm">
            <h2 className="font-medium">Site visits</h2>
            {visits.length === 0 && <p className="text-stone-500">None booked.</p>}
            <ul className="space-y-1">
              {visits.map((v, i) => (
                <li key={v.id} className={v.status === "cancelled" ? "text-stone-400 line-through" : ""}>
                  {visitSlots[i] ? `${formatSlot(visitSlots[i]!)}, ${visitSlots[i]!.area}` : "Slot removed"} ·{" "}
                  {v.status.replace("_", "-")}
                </li>
              ))}
            </ul>
            {bookingLink ? (
              <CopyButton text={bookingLink} label="Copy booking link" />
            ) : (
              <p className="text-xs text-stone-500">Booking links need BOOKING_SECRET set.</p>
            )}
          </section>

          <section className="panel text-sm">
            <h2 className="mb-2 font-medium">Why this tag</h2>
            <ul className="list-disc space-y-1 pl-5 text-stone-700">
              {why.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            {missing.length > 0 && (
              <p className="mt-2 text-stone-500">Still unknown: {missing.map((q) => q.key.replace("_", " ")).join(", ")}</p>
            )}
          </section>

          {!closed && (
            <section className="panel">
              <h2 className="mb-2 font-medium">Close this lead</h2>
              <CloseLeadForm lead={lead} />
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
