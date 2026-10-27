"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Copy,
  Info,
  MessageSquareText,
  Phone,
  PhoneOff,
  StickyNote,
  X,
} from "lucide-react";
import { Avatar, TemperatureBadge } from "@/components/badges";
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

function loadDraft(id: string): Draft {
  try {
    const raw = window.localStorage.getItem(draftKey(id));
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Draft) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

function formatPhone(p: string) {
  const m = /^\+91(\d{5})(\d{5})$/.exec(p);
  return m ? `+91 ${m[1]} ${m[2]}` : p;
}

/**
 * The Calling Assistant. Opens beside the Leads list (or a lead card) without
 * leaving the page. Calls go through the agent's own phone, so the panel never
 * claims to know whether a call connected or how long it lasted: the agent
 * says what happened when they finish.
 */
export function CallAssistant({ lead, closeHref, readOnly }: { lead: CallLead; closeHref: string; readOnly: boolean }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [step, setStep] = useState<"questions" | "finish" | "done">("questions");
  const [openSection, setOpenSection] = useState<string | null>(QUESTIONNAIRE_V1.sections[0]!.key);
  const [outcome, setOutcome] = useState<CallOutcome | null>(null);
  const [followUpAt, setFollowUpAt] = useState("");
  const [copied, setCopied] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // A draft survives closing the panel or the tab, per lead, on this device.
  useEffect(() => {
    setDraft(loadDraft(lead.id));
    setLoaded(true);
    setStep("questions");
    setOutcome(null);
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") router.push(closeHref, { scroll: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, closeHref]);

  const setAnswer = (key: string, next: Answer) => setDraft((d) => ({ ...d, answers: { ...d.answers, [key]: next } }));
  const answered = useMemo(
    () => Object.fromEntries(QUESTIONNAIRE_V1.sections.map((s) => [s.key, s.questions.filter((q) => isAnswered(draft.answers[q.key])).length])),
    [draft.answers],
  );
  const totalAnswered = Object.values(answered).reduce((a, b) => a + b, 0);

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
    const nextAction = draft.answers.next_action?.extra?.callback_at;
    if (nextAction && !followUpAt) setFollowUpAt(nextAction);
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

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      role="complementary"
      aria-label={`Calling assistant for ${lead.name ?? "lead"}`}
      className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-line bg-surface shadow-lift outline-none sm:w-[440px]"
    >
      {/* Header */}
      <div className="border-b border-line px-5 pt-4 pb-4">
        <div className="flex items-center justify-between">
          <span className="eyebrow">Calling assistant</span>
          <Link href={closeHref} scroll={false} className="-mr-2 rounded-lg p-1.5 text-muted hover:bg-subtle hover:text-ink" aria-label="Close">
            <X className="size-[18px]" />
          </Link>
        </div>
        <div className="mt-3 flex items-start gap-3">
          <Avatar name={lead.name} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-[16px] font-semibold">{lead.name ?? "Unnamed lead"}</span>
              <TemperatureBadge value={lead.temperature} />
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-sm text-muted tabular-nums">
              {formatPhone(lead.phone)}
              <button type="button" onClick={copyPhone} className="rounded p-1 hover:bg-subtle hover:text-ink" aria-label="Copy phone number">
                {copied ? <Check className="size-3.5 text-good" /> : <Copy className="size-3.5" />}
              </button>
            </div>
            <div className="mt-0.5 text-xs text-muted">Agent: {lead.agent ?? "Unassigned"}</div>
          </div>
          <a href={`tel:${lead.phone}`} className="btn h-9 flex-none" aria-label={`Dial ${formatPhone(lead.phone)} on this device`}>
            <Phone className="size-4" />
            Dial
          </a>
        </div>
        {lead.facts.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {lead.facts.map((f) => (
              <span key={f} className="rounded-md bg-subtle px-2 py-0.5 text-xs font-medium text-muted">
                {f}
              </span>
            ))}
          </div>
        )}
      </div>

      {step === "questions" && (
        <>
          <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
            <div className="flex gap-2.5 rounded-xl bg-subtle px-3 py-2.5 text-[12.5px] leading-snug text-muted">
              <Info className="mt-0.5 size-4 flex-none text-accent" />
              <span>
                <b className="font-semibold text-ink">Calling from your phone.</b> The CRM can&apos;t see the call, so there&apos;s no live
                status or timer. Ask what you can, skip the rest, and say how the call went when you finish.
              </span>
            </div>

            {QUESTIONNAIRE_V1.sections.map((section, si) => {
              const open = openSection === section.key;
              return (
                <section key={section.key} className="rounded-xl border border-line">
                  <button
                    type="button"
                    onClick={() => setOpenSection(open ? null : section.key)}
                    aria-expanded={open}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                  >
                    <span className="text-sm font-semibold">
                      <span className="mr-2 text-muted">{String.fromCharCode(65 + si)}</span>
                      {section.title}
                    </span>
                    <span className="flex items-center gap-2 text-xs text-muted tabular-nums">
                      {answered[section.key]}/{section.questions.length}
                      <ChevronDown className={`size-4 transition ${open ? "rotate-180" : ""}`} />
                    </span>
                  </button>
                  {open && (
                    <div className="space-y-5 border-t border-line px-4 py-4">
                      {section.questions.map((q, qi) => (
                        <QuestionBlock
                          key={q.key}
                          n={QUESTIONNAIRE_V1.sections.slice(0, si).reduce((a, s) => a + s.questions.length, 0) + qi + 1}
                          q={q}
                          answer={draft.answers[q.key]}
                          onChange={(a) => setAnswer(q.key, a)}
                        />
                      ))}
                    </div>
                  )}
                </section>
              );
            })}

            <div>
              <label htmlFor="call-notes" className="label">
                Call notes
              </label>
              <textarea
                id="call-notes"
                rows={3}
                className="input resize-none"
                placeholder="Anything else the customer said"
                value={draft.notes}
                onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
              />
            </div>
          </div>

          <div className="border-t border-line px-5 py-3">
            <div className="mb-2.5 flex items-center justify-between text-xs">
              <span className="text-muted tabular-nums">{totalAnswered} of 10 answered</span>
              <SaveStatus readOnly={readOnly} savedAt={savedAt} />
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => finish(false)} className="btn-ghost flex-1">
                <PhoneOff className="size-4" />
                Didn&apos;t connect
              </button>
              <button type="button" onClick={() => finish(true)} className="btn flex-1">
                <Check className="size-4" />
                Finish call
              </button>
            </div>
          </div>
        </>
      )}

      {step === "finish" && (
        <>
          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
            <div>
              <div className="label">How did the call go?</div>
              <div className="grid grid-cols-2 gap-2">
                {CALL_OUTCOMES.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setOutcome(o.value)}
                    aria-pressed={outcome === o.value}
                    className={`rounded-lg border px-3 py-2 text-left text-[13px] font-medium transition ${
                      outcome === o.value ? "border-accent bg-accent-soft text-accent" : "border-line hover:bg-subtle"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              {outcomeInfo && !outcomeInfo.conversation && totalAnswered > 0 && (
                <p className="mt-2 text-xs text-muted">
                  The call will be recorded as not connected. Your {totalAnswered} answers stay as a draft for the next call.
                </p>
              )}
            </div>
            <div>
              <label htmlFor="follow-up-at" className="label">
                Next follow-up
              </label>
              <input id="follow-up-at" type="datetime-local" className="input" value={followUpAt} onChange={(e) => setFollowUpAt(e.target.value)} />
            </div>
            {outcomeInfo?.conversation && (
              <Summary answers={draft.answers} />
            )}
          </div>
          <div className="flex gap-2 border-t border-line px-5 py-3">
            <button type="button" onClick={() => setStep("questions")} className="btn-ghost flex-1">
              Back
            </button>
            <button type="button" disabled={!outcome} onClick={confirmFinish} className="btn flex-1">
              {readOnly ? "Finish (preview)" : "Save call"}
            </button>
          </div>
        </>
      )}

      {step === "done" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-good-soft text-good">
            <Check className="size-6" />
          </span>
          <div className="text-[15px] font-semibold">{outcomeInfo?.label ?? "Call finished"}</div>
          <p className="text-sm text-muted">
            {readOnly
              ? "This is the read-only preview, so nothing was saved. Once calling is switched on, this call, its answers and the follow-up go on the lead's history."
              : "Call finished."}
          </p>
          <Link href={closeHref} scroll={false} className="btn mt-2">
            Close
          </Link>
        </div>
      )}
    </div>
  );
}

function SaveStatus({ readOnly, savedAt }: { readOnly: boolean; savedAt: number | null }) {
  if (readOnly) {
    return <span className="text-muted">Preview: draft kept on this device only</span>;
  }
  return savedAt ? (
    <span className="flex items-center gap-1 text-good">
      <Check className="size-3.5" /> Draft saved
    </span>
  ) : (
    <span className="text-muted">Not saved yet</span>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-lg border px-2.5 py-1 text-[12.5px] font-medium transition ${
        on ? "border-accent bg-accent text-white" : "border-line bg-surface text-ink hover:border-accent/40 hover:bg-accent-soft"
      }`}
    >
      {children}
    </button>
  );
}

function QuestionBlock({ n, q, answer, onChange }: { n: number; q: Question; answer?: Answer; onChange: (a: Answer) => void }) {
  const a: Answer = answer ?? { values: [] };
  const [showScript, setShowScript] = useState(false);
  const [showNote, setShowNote] = useState(!!a.note);
  const [showOther, setShowOther] = useState(!!a.other);

  function toggle(value: string) {
    const has = a.values.includes(value);
    const values = q.multi ? (has ? a.values.filter((v) => v !== value) : [...a.values, value]) : has ? [] : [value];
    onChange({ ...a, values, skipped: false });
  }

  const visibleFollowUps = (q.followUps ?? []).filter((f) => f.when.some((w) => a.values.includes(w)));

  return (
    <div className={a.skipped ? "opacity-60" : ""}>
      <div className="flex items-start justify-between gap-3">
        <div className="text-[13.5px] font-medium leading-snug">
          <span className="mr-1.5 text-muted tabular-nums">{n}.</span>
          {q.label}
          {q.multi && <span className="ml-1.5 text-xs font-normal text-muted">pick any</span>}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {q.options.map((o) => (
          <Chip key={o.value} on={a.values.includes(o.value)} onClick={() => toggle(o.value)}>
            {o.label}
          </Chip>
        ))}
        {q.allowOther && (
          <Chip on={showOther} onClick={() => setShowOther((s) => !s)}>
            Other
          </Chip>
        )}
      </div>
      {showOther && (
        <input
          aria-label={`${q.label} — other answer`}
          className="input mt-2 h-8 text-[13px]"
          placeholder="Type their answer"
          value={a.other ?? ""}
          onChange={(e) => onChange({ ...a, other: e.target.value, skipped: false })}
        />
      )}
      {visibleFollowUps.map((f) => (
        <FollowUpField key={f.key} f={f} value={a.extra?.[f.key] ?? ""} onChange={(v) => onChange({ ...a, extra: { ...a.extra, [f.key]: v } })} />
      ))}
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
        <button type="button" onClick={() => setShowScript((s) => !s)} className="flex items-center gap-1 font-medium text-accent hover:underline" aria-expanded={showScript}>
          <MessageSquareText className="size-3.5" />
          {showScript ? "Hide script" : "Suggested script"}
        </button>
        <button type="button" onClick={() => setShowNote((s) => !s)} className="flex items-center gap-1 text-muted hover:text-ink">
          <StickyNote className="size-3.5" />
          Note
        </button>
        <button
          type="button"
          onClick={() => onChange({ ...a, values: [], other: "", skipped: !a.skipped })}
          className="text-muted hover:text-ink"
          aria-pressed={!!a.skipped}
        >
          {a.skipped ? "Not discussed ✓" : "Skip"}
        </button>
      </div>
      {showScript && (
        <blockquote className="mt-2 rounded-lg border-l-2 border-accent bg-accent-soft/60 px-3 py-2 text-[12.5px] leading-relaxed text-ink">
          “{q.script}”
        </blockquote>
      )}
      {showNote && (
        <input
          aria-label={`${q.label} — note`}
          className="input mt-2 h-8 text-[13px]"
          placeholder="Note on this answer"
          value={a.note ?? ""}
          onChange={(e) => onChange({ ...a, note: e.target.value })}
        />
      )}
    </div>
  );
}

function FollowUpField({ f, value, onChange }: { f: FollowUpQuestion; value: string; onChange: (v: string) => void }) {
  return (
    <div className="mt-2.5 rounded-lg bg-subtle px-3 py-2.5">
      <div className="mb-1.5 text-xs font-medium text-muted">{f.label}</div>
      {f.kind === "datetime" ? (
        <input type="datetime-local" aria-label={f.label} className="input h-8 text-[13px]" value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {f.options!.map((o) => (
            <Chip key={o.value} on={value === o.value} onClick={() => onChange(value === o.value ? "" : o.value)}>
              {o.label}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}

function Summary({ answers }: { answers: Record<string, Answer> }) {
  const rows = QUESTIONNAIRE_V1.sections.flatMap((s) =>
    s.questions
      .filter((q) => isAnswered(answers[q.key]))
      .map((q) => {
        const a = answers[q.key]!;
        const labels = a.values.map((v) => q.options.find((o) => o.value === v)?.label ?? v);
        if (a.other?.trim()) labels.push(a.other.trim());
        return { q: q.label, v: a.skipped ? "Not discussed" : labels.join(", ") };
      }),
  );
  if (rows.length === 0) return <p className="text-sm text-muted">No answers recorded on this call.</p>;
  return (
    <div>
      <div className="label">Summary</div>
      <dl className="divide-y divide-line rounded-xl border border-line text-[13px]">
        {rows.map((r) => (
          <div key={r.q} className="grid grid-cols-[1fr_auto] gap-3 px-3 py-2">
            <dt className="text-muted">{r.q}</dt>
            <dd className="text-right font-medium">{r.v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
