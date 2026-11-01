"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Copy, CornerDownLeft, Info, MessageCircle, Pencil, Phone, PhoneOff, StickyNote, UserRound, X } from "lucide-react";
import { Avatar, NameFlag } from "@/components/badges";
import { displayName } from "@/lib/display-name";
import { formatPhone, whatsappUrl } from "@/lib/lead-display";
import {
  CALL_OUTCOMES,
  isAnswered,
  QUESTIONNAIRE_V1,
  type Answer,
  type CallOutcome,
  type FollowUpQuestion,
  type Question,
} from "@/lib/questionnaire";
import type { Lead } from "@/lib/types";

export interface CallLead {
  id: string;
  name: string | null;
  phone: string;
  temperature: Lead["temperature"];
  agent: string | null;
  /** What we already know, shown as chips under the name. */
  facts: string[];
}

interface Draft {
  answers: Record<string, Answer>;
  notes: string;
}

const EMPTY: Draft = { answers: {}, notes: "" };
const draftKey = (id: string) => `rn_call_draft_v${QUESTIONNAIRE_V1.version}_${id}`;

/** Every question in order, with the section it belongs to. */
const FLAT = QUESTIONNAIRE_V1.sections.flatMap((section, s) => section.questions.map((q) => ({ q, s })));
/** One past the last question: the wrap-up page with call notes. */
const WRAP_UP = FLAT.length;

function loadDraft(id: string): Draft {
  try {
    const raw = window.localStorage.getItem(draftKey(id));
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Draft) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

function answerText(q: Question, a: Answer): string {
  if (a.skipped) return "Not discussed";
  const labels = a.values.map((v) => q.options.find((o) => o.value === v)?.label ?? v);
  if (a.other?.trim()) labels.push(a.other.trim());
  return labels.join(", ");
}

/**
 * The Calling Assistant: a guided conversation, one question at a time, in a panel beside the list.
 * Calls go through the agent's own phone, so the panel never claims to know whether a call
 * connected or how long it lasted: the agent says what happened when they finish.
 */
export function CallAssistant({ lead, closeHref, readOnly }: { lead: CallLead; closeHref: string; readOnly: boolean }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [step, setStep] = useState<"questions" | "finish" | "done">("questions");
  const [cursor, setCursor] = useState(0);
  const [outcome, setOutcome] = useState<CallOutcome | null>(null);
  const [followUpAt, setFollowUpAt] = useState("");
  const [copied, setCopied] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const dn = displayName(lead.name);
  const firstName = dn.name.split(" ")[0];

  // A draft survives closing the panel or the tab, per lead, on this device.
  useEffect(() => {
    const d = loadDraft(lead.id);
    setDraft(d);
    setLoaded(true);
    setStep("questions");
    setOutcome(null);
    // Pick up where the last attempt stopped.
    const next = FLAT.findIndex(({ q }) => !isAnswered(d.answers[q.key]));
    setCursor(next === -1 ? WRAP_UP : next);
    panelRef.current?.focus();
  }, [lead.id]);

  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => {
      try {
        window.localStorage.setItem(draftKey(lead.id), JSON.stringify(draft));
        setSavedAt(Date.now());
      } catch {
        // Storage can be unavailable (private window); the panel still works.
      }
    }, 400);
    return () => clearTimeout(t);
  }, [draft, loaded, lead.id]);

  const setAnswer = useCallback((key: string, next: Answer) => setDraft((d) => ({ ...d, answers: { ...d.answers, [key]: next } })), []);
  const answered = useMemo(
    () => QUESTIONNAIRE_V1.sections.map((s) => s.questions.filter((q) => isAnswered(draft.answers[q.key])).length),
    [draft.answers],
  );
  const totalAnswered = answered.reduce((a, b) => a + b, 0);
  const current = cursor < WRAP_UP ? FLAT[cursor]! : null;

  const toggle = useCallback(
    (q: Question, value: string) => {
      const a = draft.answers[q.key] ?? { values: [] };
      const has = a.values.includes(value);
      const values = q.multi ? (has ? a.values.filter((v) => v !== value) : [...a.values, value]) : has ? [] : [value];
      // A single-choice question has one answer: picking a listed option replaces a typed one.
      setAnswer(q.key, { ...a, values, other: q.multi || has ? a.other : "", skipped: false });
    },
    [draft.answers, setAnswer],
  );

  // Keys: Esc closes, 1–9 pick an answer, Enter moves on. Typing in a field is left alone.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return router.push(closeHref, { scroll: false });
      const typing = e.target instanceof HTMLElement && (e.target.closest("input, textarea, select") || e.target.isContentEditable);
      if (typing || step !== "questions" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (current && /^[1-9]$/.test(e.key)) {
        const opt = current.q.options[Number(e.key) - 1];
        if (opt) {
          e.preventDefault();
          toggle(current.q, opt.value);
        }
      } else if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement) && !(e.target instanceof HTMLAnchorElement)) {
        e.preventDefault();
        setCursor((c) => Math.min(WRAP_UP, c + 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, closeHref, step, current, toggle]);

  function copyPhone() {
    navigator.clipboard?.writeText(lead.phone).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => undefined,
    );
  }

  function finish(connected: boolean) {
    setOutcome(connected ? "connected" : null);
    const callback = draft.answers.next_action?.extra?.callback_at;
    if (callback && !followUpAt) setFollowUpAt(callback);
    setStep("finish");
  }

  function confirmFinish() {
    if (!readOnly) {
      // Phase 4 saves the call here. Until then the draft simply clears.
    }
    try {
      window.localStorage.removeItem(draftKey(lead.id));
    } catch {}
    setStep("done");
  }

  const outcomeInfo = CALL_OUTCOMES.find((o) => o.value === outcome);
  const knownChips = FLAT.filter(({ q }) => isAnswered(draft.answers[q.key]) && !draft.answers[q.key]!.skipped);

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      role="complementary"
      aria-label={`Calling assistant for ${dn.name}`}
      className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-line bg-ground shadow-lift outline-none lg:w-[600px]"
    >
      {/* Who you're calling, who owns them, and how to dial. */}
      <div className="border-b border-line bg-surface px-5 pt-4 pb-4 sm:px-7">
        <div className="flex items-center justify-between">
          <span className="eyebrow">Calling assistant</span>
          <Link href={closeHref} scroll={false} className="-mr-2 rounded-lg p-1.5 text-muted hover:bg-subtle hover:text-ink" aria-label="Close (Esc)">
            <X className="size-[18px]" />
          </Link>
        </div>
        <div className="mt-3 flex items-center gap-3.5">
          <Avatar name={lead.name} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-serif text-[28px] leading-tight tracking-[-0.01em]">{dn.name}</span>
              <NameFlag raw={dn.raw} />
            </div>
            <button type="button" onClick={copyPhone} className="group mt-0.5 flex items-center gap-1.5 text-[13px] text-muted tabular-nums hover:text-ink" aria-label="Copy phone number">
              {formatPhone(lead.phone)}
              {copied ? (
                <span className="flex items-center gap-0.5 font-medium text-good">
                  <Check className="size-3.5" /> Copied
                </span>
              ) : (
                <Copy className="size-3.5 text-faint group-hover:text-ink" />
              )}
            </button>
          </div>
          <div className="flex flex-none gap-2">
            <a href={whatsappUrl(lead.phone)} target="_blank" rel="noreferrer" className="grid size-10 place-items-center rounded-lg bg-wa-soft text-wa hover:bg-wa hover:text-white" aria-label="Open WhatsApp chat">
              <MessageCircle className="size-[18px]" />
            </a>
            <a href={`tel:${lead.phone}`} className="btn-call h-10 px-4" aria-label={`Dial ${formatPhone(lead.phone)} on this device`}>
              <Phone className="size-4" />
              Dial
            </a>
          </div>
        </div>
        <div className="mt-3.5 flex flex-wrap gap-1.5">
          <span className={`inline-flex items-center gap-1.5 rounded-md border border-dashed px-2 py-0.5 text-[12.5px] font-medium ${lead.agent ? "border-line text-ink" : "border-gold-line text-gold-ink"}`}>
            <UserRound className="size-3.5" />
            Agent: {lead.agent ?? "Unassigned"}
          </span>
          {lead.facts.map((f) => (
            <span key={f} className="rounded-md bg-subtle px-2 py-0.5 text-[12.5px] text-ink-2">
              {f}
            </span>
          ))}
        </div>
        {dn.raw && (
          <p className="mt-3 flex gap-2 rounded-lg border border-gold-line bg-gold-soft px-3 py-2 text-[12.5px] leading-snug text-ink-2">
            <Info className="mt-px size-4 flex-none text-gold-ink" />
            <span>
              This name came from their social profile (“{dn.raw}”). Confirm it first: <b className="text-ink">“Main {firstName} ji se baat kar raha hoon?”</b>
            </span>
          </p>
        )}
      </div>

      {step === "questions" && (
        <>
          <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-7">
            {/* Where you are in the conversation */}
            <div className="flex gap-2" role="tablist" aria-label="Sections">
              {QUESTIONNAIRE_V1.sections.map((s, i) => {
                const on = current?.s === i;
                const done = answered[i] === s.questions.length;
                return (
                  <button
                    key={s.key}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => setCursor(FLAT.findIndex((f) => f.s === i))}
                    className={`flex min-w-0 flex-1 items-baseline gap-1.5 border-b-2 pb-2 text-left text-[12.5px] font-medium transition ${
                      on ? "border-gold text-ink" : done ? "border-navy text-ink-2" : "border-line text-muted hover:text-ink"
                    }`}
                  >
                    <span className="truncate" title={s.title}>{s.title.replace(/ requirements$/, "")}</span>
                    <span className="flex-none text-faint tabular-nums">
                      {answered[i]}/{s.questions.length}
                    </span>
                  </button>
                );
              })}
              <button
                type="button"
                role="tab"
                aria-selected={!current}
                onClick={() => setCursor(WRAP_UP)}
                className={`border-b-2 pb-2 text-[12.5px] font-medium transition ${!current ? "border-gold text-ink" : "border-line text-muted hover:text-ink"}`}
              >
                Wrap-up
              </button>
            </div>

            {knownChips.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted">
                <span className="mr-0.5">So far:</span>
                {knownChips.map(({ q }) => (
                  <button
                    key={q.key}
                    type="button"
                    onClick={() => setCursor(FLAT.findIndex((f) => f.q.key === q.key))}
                    title={`${q.label} (edit)`}
                    className="inline-flex max-w-[220px] items-center gap-1 rounded-full border border-line-strong bg-surface px-2.5 py-0.5 font-medium text-ink hover:border-navy"
                  >
                    <Check className="size-3 flex-none text-good" />
                    <span className="truncate">{answerText(q, draft.answers[q.key]!)}</span>
                  </button>
                ))}
              </div>
            )}

            {current ? (
              <QuestionView
                key={current.q.key}
                n={cursor + 1}
                q={current.q}
                answer={draft.answers[current.q.key]}
                onChange={(a) => setAnswer(current.q.key, a)}
                onToggle={(v) => toggle(current.q, v)}
                nextLabel={FLAT[cursor + 1]?.q.label ?? "Wrap-up and call notes"}
              />
            ) : (
              <div className="mt-6">
                <div className="text-[12.5px] text-muted">Wrap-up</div>
                <h3 className="mt-1.5 text-[24px] leading-tight font-semibold tracking-[-0.025em]">Anything else they said?</h3>
                <label htmlFor="call-notes" className="sr-only">
                  Call notes
                </label>
                <textarea
                  id="call-notes"
                  rows={5}
                  className="input mt-4 resize-none text-[14.5px]"
                  placeholder="Call notes"
                  value={draft.notes}
                  onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                />
                <p className="mt-3 text-[13px] text-muted">
                  {totalAnswered} of {FLAT.length} questions answered. When you hang up, finish the call and say how it went.
                </p>
              </div>
            )}
          </div>

          <div>
            <div className="h-[3px] bg-subtle" aria-hidden>
              <div className="h-full bg-gold transition-all" style={{ width: `${(totalAnswered / FLAT.length) * 100}%` }} />
            </div>
            <div className="flex items-center gap-2 bg-surface px-5 py-3.5 sm:px-7">
              <SaveStatus readOnly={readOnly} savedAt={savedAt} />
              <span className="flex-1" />
              <button type="button" onClick={() => finish(false)} className="btn-ghost h-10">
                <PhoneOff className="size-4" />
                <span className="hidden sm:inline">Didn&apos;t connect</span>
              </button>
              <button type="button" onClick={() => setCursor((c) => Math.max(0, c - 1))} disabled={cursor === 0} className="btn-ghost h-10 px-3" aria-label="Previous question">
                <ArrowLeft className="size-4" />
              </button>
              {current ? (
                <button type="button" onClick={() => setCursor((c) => c + 1)} className="btn h-10 px-4">
                  Next
                  <ArrowRight className="size-4" />
                </button>
              ) : (
                <button type="button" onClick={() => finish(true)} className="btn h-10 px-4">
                  <Check className="size-4" />
                  Finish call
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {step === "finish" && (
        <>
          <div className="flex-1 space-y-6 overflow-y-auto px-5 py-6 sm:px-7">
            <div>
              <h3 className="text-[22px] leading-tight font-semibold tracking-[-0.02em]">How did the call go?</h3>
              <p className="mt-1 text-[13px] text-muted">Pick what actually happened. The CRM can&apos;t tell from your phone.</p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                {CALL_OUTCOMES.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setOutcome(o.value)}
                    aria-pressed={outcome === o.value}
                    className={`flex min-h-12 items-center gap-2.5 rounded-xl border px-3.5 py-2 text-left text-[14px] font-medium transition ${
                      outcome === o.value ? "border-navy bg-navy text-white" : "border-line-strong bg-surface hover:border-navy"
                    }`}
                  >
                    <span className={`size-2 flex-none rounded-full ${o.conversation ? "bg-good" : outcome === o.value ? "bg-white/50" : "bg-faint"}`} />
                    {o.label}
                  </button>
                ))}
              </div>
              {outcomeInfo && !outcomeInfo.conversation && totalAnswered > 0 && (
                <p className="mt-3 text-[13px] text-muted">
                  The call will be recorded as not connected. Your {totalAnswered} answers stay as a draft for the next call.
                </p>
              )}
            </div>
            <div>
              <label htmlFor="follow-up-at" className="text-[15px] font-semibold">
                Next follow-up
              </label>
              <input id="follow-up-at" type="datetime-local" className="input mt-2 h-11" value={followUpAt} onChange={(e) => setFollowUpAt(e.target.value)} />
            </div>
            {outcomeInfo?.conversation && <Summary answers={draft.answers} notes={draft.notes} />}
          </div>
          <div className="flex gap-2 border-t border-line bg-surface px-5 py-3.5 sm:px-7">
            <button type="button" onClick={() => setStep("questions")} className="btn-ghost h-10 flex-1">
              Back
            </button>
            <button type="button" disabled={!outcome} onClick={confirmFinish} className="btn h-10 flex-[1.5]">
              {readOnly ? "Finish (preview)" : "Save call"}
            </button>
          </div>
        </>
      )}

      {step === "done" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-10 text-center">
          <span className="grid size-14 place-items-center rounded-full bg-gold-soft text-gold-ink">
            <Check className="size-7" />
          </span>
          <div className="font-serif text-[28px]">{outcomeInfo?.label ?? "Call finished"}</div>
          <p className="max-w-sm text-[14px] leading-relaxed text-muted">
            {readOnly
              ? "This is the read-only preview, so nothing was saved. Once saving is switched on, this call, its answers and the follow-up go on the lead's history."
              : "Call finished."}
          </p>
          <Link href={closeHref} scroll={false} className="btn mt-2 h-10 px-5">
            Close
          </Link>
        </div>
      )}
    </div>
  );
}

function SaveStatus({ readOnly, savedAt }: { readOnly: boolean; savedAt: number | null }) {
  if (readOnly) return <span className="hidden text-[12px] text-muted sm:inline">Preview: kept on this device only</span>;
  return savedAt ? (
    <span className="inline-flex items-center gap-1 text-[12px] text-muted">
      <Check className="size-3.5 text-good" /> Draft saved
    </span>
  ) : (
    <span className="text-[12px] text-faint">Not saved yet</span>
  );
}

function QuestionView({
  n,
  q,
  answer,
  onChange,
  onToggle,
  nextLabel,
}: {
  n: number;
  q: Question;
  answer?: Answer;
  onChange: (a: Answer) => void;
  onToggle: (value: string) => void;
  nextLabel: string;
}) {
  const a: Answer = answer ?? { values: [] };
  const [showOther, setShowOther] = useState(!!a.other);
  const [showNote, setShowNote] = useState(!!a.note);
  const [showScript, setShowScript] = useState(true);
  const visibleFollowUps = (q.followUps ?? []).filter((f) => f.when.some((w) => a.values.includes(w)));

  function toggleOther() {
    if (showOther) {
      setShowOther(false);
      onChange({ ...a, other: "" });
    } else {
      setShowOther(true);
      if (!q.multi) onChange({ ...a, values: [], skipped: false });
    }
  }

  return (
    <div className="mt-6">
      <div className="flex justify-between text-[12.5px] text-muted">
        <span>
          Question {n} of {FLAT.length}
        </span>
        <span>{q.multi ? "Pick any that apply" : "Pick one"}</span>
      </div>
      <h3 className="mt-1.5 text-[24px] leading-tight font-semibold tracking-[-0.025em]">{q.label}</h3>

      {showScript ? (
        <blockquote className="relative mt-4 rounded-2xl border border-line bg-surface py-3.5 pr-4 pl-5 text-[14.5px] leading-relaxed text-ink-2 before:absolute before:top-3.5 before:bottom-3.5 before:left-0 before:w-[3px] before:rounded-r before:bg-gold">
          <div className="mb-1 flex justify-between text-[11px] font-semibold tracking-[0.1em] text-gold-ink">
            SAY THIS
            <button type="button" onClick={() => setShowScript(false)} className="font-medium tracking-normal text-faint hover:text-ink">
              Hide
            </button>
          </div>
          “{q.script}”
        </blockquote>
      ) : (
        <button type="button" onClick={() => setShowScript(true)} className="mt-3 text-[13px] font-medium text-gold-ink hover:underline">
          Show what to say
        </button>
      )}

      {a.skipped ? (
        <div className="mt-4 flex items-center justify-between rounded-xl border border-dashed border-line-strong px-4 py-3 text-[14px] text-muted">
          Marked as not discussed
          <button type="button" onClick={() => onChange({ ...a, skipped: false })} className="font-medium text-ink hover:underline">
            Undo
          </button>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {q.options.map((o, i) => {
            const on = a.values.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => onToggle(o.value)}
                aria-pressed={on}
                className={`flex h-12 items-center gap-3 rounded-xl border px-3.5 text-left text-[14.5px] font-medium transition ${
                  on ? "border-navy bg-navy text-white shadow-[0_4px_12px_-4px_rgb(14_27_51/0.4)]" : "border-line-strong bg-surface hover:border-navy"
                }`}
              >
                <span className={`grid size-[22px] flex-none place-items-center rounded-md border text-[11.5px] ${on ? "border-white/25" : "border-line-strong text-muted"}`}>
                  {on ? <Check className="size-3.5" /> : i < 9 ? i + 1 : ""}
                </span>
                {o.label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={toggleOther}
            aria-pressed={showOther}
            className={`flex h-12 items-center gap-3 rounded-xl border border-dashed px-3.5 text-left text-[14.5px] font-medium transition ${
              showOther ? "border-gold bg-gold-soft text-ink" : "border-line-strong text-muted hover:border-navy hover:text-ink"
            }`}
          >
            <Pencil className="size-4 flex-none" />
            In their words…
          </button>
          {showOther && (
            <input
              autoFocus
              aria-label={`${q.label} (in their words)`}
              className="input h-12 text-[14.5px] sm:col-span-2"
              placeholder="Type what the customer said"
              value={a.other ?? ""}
              onChange={(e) => onChange({ ...a, other: e.target.value, skipped: false })}
            />
          )}
        </div>
      )}

      {visibleFollowUps.map((f) => (
        <FollowUpField
          key={f.key}
          f={f}
          value={a.extra?.[f.key] ?? ""}
          other={a.extra?.[`${f.key}_other`] ?? ""}
          onChange={(key, v) => onChange({ ...a, extra: { ...a.extra, [key]: v } })}
        />
      ))}

      <div className="mt-4 flex flex-wrap items-center gap-4 text-[13px] text-muted">
        <button type="button" onClick={() => setShowNote((s) => !s)} className="inline-flex items-center gap-1.5 hover:text-ink">
          <StickyNote className="size-3.5" />
          Note
        </button>
        {!a.skipped && (
          <button
            type="button"
            onClick={() => {
              setShowOther(false);
              onChange({ ...a, values: [], other: "", skipped: true });
            }}
            className="hover:text-ink"
          >
            Not discussed
          </button>
        )}
        <span className="ml-auto hidden items-center gap-1 text-[11.5px] text-faint lg:inline-flex">
          1–{Math.min(9, q.options.length)} to pick · <CornerDownLeft className="size-3" /> next
        </span>
      </div>
      {showNote && (
        <input
          aria-label={`${q.label} (note)`}
          className="input mt-2 h-10 text-[14px]"
          placeholder="Note on this answer"
          value={a.note ?? ""}
          onChange={(e) => onChange({ ...a, note: e.target.value })}
        />
      )}

      <div className="mt-7 border-t border-dashed border-line-strong pt-3 text-[13px] text-faint">Up next · {nextLabel}</div>
    </div>
  );
}

function FollowUpField({ f, value, other, onChange }: { f: FollowUpQuestion; value: string; other: string; onChange: (key: string, v: string) => void }) {
  return (
    <div className="mt-3 rounded-xl border border-line bg-surface px-4 py-3">
      <div className="mb-2 text-[13px] font-semibold">{f.label}</div>
      {f.kind === "datetime" ? (
        <input type="datetime-local" aria-label={f.label} className="input h-10 text-[14px]" value={value} onChange={(e) => onChange(f.key, e.target.value)} />
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {f.options!.map((o) => {
              const on = value === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onChange(f.key, on ? "" : o.value)}
                  className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-[13.5px] font-medium transition ${
                    on ? "border-navy bg-navy text-white" : "border-line-strong bg-surface hover:border-navy"
                  }`}
                >
                  {on && <Check className="-ml-0.5 size-3.5" />}
                  {o.label}
                </button>
              );
            })}
          </div>
          {value === "other" && (
            <input
              autoFocus
              aria-label={`${f.label} (other)`}
              className="input mt-2.5 h-10 text-[14px]"
              placeholder="Type the reason"
              value={other}
              onChange={(e) => onChange(`${f.key}_other`, e.target.value)}
            />
          )}
        </>
      )}
    </div>
  );
}

function Summary({ answers, notes }: { answers: Record<string, Answer>; notes: string }) {
  const rows = FLAT.filter(({ q }) => isAnswered(answers[q.key])).map(({ q }) => ({ q: q.label, v: answerText(q, answers[q.key]!) }));
  return (
    <div>
      <div className="text-[15px] font-semibold">Summary</div>
      {rows.length === 0 && !notes.trim() ? (
        <p className="mt-1 text-[13px] text-muted">No answers recorded on this call.</p>
      ) : (
        <dl className="mt-2 divide-y divide-line rounded-xl border border-line bg-surface px-4 text-[13.5px]">
          {rows.map((r) => (
            <div key={r.q} className="grid grid-cols-[1fr_auto] gap-4 py-2.5">
              <dt className="text-muted">{r.q}</dt>
              <dd className="max-w-[55%] text-right font-medium">{r.v}</dd>
            </div>
          ))}
          {notes.trim() && (
            <div className="py-2.5">
              <dt className="text-muted">Notes</dt>
              <dd className="mt-0.5 whitespace-pre-wrap">{notes.trim()}</dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}
