"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  MessageCircle,
  MessageSquareText,
  Phone,
  PhoneOff,
  Plus,
  StickyNote,
  UserRound,
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
import { formatPhone, whatsappUrl } from "@/lib/lead-display";
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

  const total = QUESTIONNAIRE_V1.sections.reduce((a, s) => a + s.questions.length, 0);

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      role="complementary"
      aria-label={`Calling assistant for ${lead.name ?? "lead"}`}
      className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-line bg-ground shadow-lift outline-none sm:w-[500px]"
    >
      {/* Header: who you are calling, who owns the lead, and how to dial. */}
      <div className="border-b border-line bg-surface px-6 pt-4 pb-4">
        <div className="flex items-center justify-between">
          <span className="eyebrow flex items-center gap-1.5">
            <Phone className="size-3.5 text-accent" />
            Calling assistant
          </span>
          <Link href={closeHref} scroll={false} className="-mr-2 rounded-lg p-1.5 text-muted hover:bg-subtle hover:text-ink" aria-label="Close (Esc)">
            <X className="size-[18px]" />
          </Link>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Avatar name={lead.name} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-[18px] font-semibold tracking-tight">{lead.name ?? "Unnamed lead"}</span>
              <TemperatureBadge value={lead.temperature} />
            </div>
            <button
              type="button"
              onClick={copyPhone}
              className="group mt-0.5 flex items-center gap-1.5 rounded text-[14px] text-ink tabular-nums hover:text-accent"
              aria-label={`Copy ${formatPhone(lead.phone)}`}
            >
              {formatPhone(lead.phone)}
              {copied ? (
                <span className="flex items-center gap-0.5 text-xs font-medium text-good">
                  <Check className="size-3.5" /> Copied
                </span>
              ) : (
                <Copy className="size-3.5 text-faint group-hover:text-accent" />
              )}
            </button>
          </div>
        </div>

        <dl className="mt-3.5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line text-[13px]">
          <div className="bg-surface px-3.5 py-2.5">
            <dt className="text-[11.5px] text-muted">Assigned agent</dt>
            <dd className={`mt-0.5 flex items-center gap-1.5 font-medium ${lead.agent ? "text-ink" : "text-muted"}`}>
              <UserRound className="size-3.5" />
              {lead.agent ?? "Unassigned"}
            </dd>
          </div>
          <div className="bg-surface px-3.5 py-2.5">
            <dt className="text-[11.5px] text-muted">Looking for</dt>
            <dd className="mt-0.5 truncate font-medium">{lead.facts.length > 0 ? lead.facts.join(" · ") : <span className="text-muted">Not asked yet</span>}</dd>
          </div>
        </dl>

        <div className="mt-3 flex gap-2">
          <a href={`tel:${lead.phone}`} className="btn h-10 flex-1 text-[14px]" aria-label={`Dial ${formatPhone(lead.phone)} on this device`}>
            <Phone className="size-4" />
            Dial {formatPhone(lead.phone)}
          </a>
          <a href={whatsappUrl(lead.phone)} target="_blank" rel="noreferrer" className="btn-ghost h-10 px-3" aria-label="Open WhatsApp chat">
            <MessageCircle className="size-4 text-wa" />
          </a>
        </div>
        <p className="mt-2 text-center text-[12px] text-muted">Dial on your phone. The CRM can&apos;t detect the call, so you log how it went.</p>
      </div>

      {step === "questions" && (
        <>
          <div className="flex-1 space-y-3 overflow-y-auto px-6 py-5">
            {QUESTIONNAIRE_V1.sections.map((section, si) => {
              const open = openSection === section.key;
              const done = answered[section.key] === section.questions.length;
              return (
                <section key={section.key} className={`overflow-hidden rounded-2xl border bg-surface shadow-card transition ${open ? "border-accent/30" : "border-line"}`}>
                  <button
                    type="button"
                    onClick={() => setOpenSection(open ? null : section.key)}
                    aria-expanded={open}
                    className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-subtle/60"
                  >
                    <span
                      className={`grid size-7 flex-none place-items-center rounded-full text-[12px] font-semibold ${
                        done ? "bg-good text-white" : open ? "bg-accent text-white" : "bg-subtle text-muted"
                      }`}
                    >
                      {done ? <Check className="size-3.5" /> : si + 1}
                    </span>
                    <span className="flex-1 text-[15px] font-semibold">{section.title}</span>
                    <span className="text-[12.5px] text-muted tabular-nums">
                      {answered[section.key]} of {section.questions.length}
                    </span>
                    <ChevronDown className={`size-4 text-muted transition ${open ? "rotate-180" : ""}`} />
                  </button>
                  {open && (
                    <div className="divide-y divide-line border-t border-line">
                      {section.questions.map((q, qi) => (
                        <QuestionBlock
                          key={q.key}
                          n={QUESTIONNAIRE_V1.sections.slice(0, si).reduce((a, s) => a + s.questions.length, 0) + qi + 1}
                          q={q}
                          answer={draft.answers[q.key]}
                          onChange={(a) => setAnswer(q.key, a)}
                        />
                      ))}
                      {si < QUESTIONNAIRE_V1.sections.length - 1 && (
                        <div className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => setOpenSection(QUESTIONNAIRE_V1.sections[si + 1]!.key)}
                            className="flex items-center gap-1 text-[13px] font-medium text-accent hover:underline"
                          >
                            Next: {QUESTIONNAIRE_V1.sections[si + 1]!.title}
                            <ChevronRight className="size-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </section>
              );
            })}

            <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
              <label htmlFor="call-notes" className="text-[14px] font-semibold">
                Call notes
              </label>
              <textarea
                id="call-notes"
                rows={3}
                className="input mt-2 resize-none text-[14px]"
                placeholder="Anything else the customer said"
                value={draft.notes}
                onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
              />
            </div>
          </div>

          <div className="border-t border-line bg-surface px-6 pt-3 pb-4">
            <div className="mb-3 flex items-center gap-3 text-[12.5px]">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-subtle" aria-hidden>
                <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(totalAnswered / total) * 100}%` }} />
              </div>
              <span className="text-muted tabular-nums">
                {totalAnswered} of {total} answered
              </span>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => finish(false)} className="btn-ghost h-11 flex-1 text-[14px]">
                <PhoneOff className="size-4" />
                Didn&apos;t connect
              </button>
              <button type="button" onClick={() => finish(true)} className="btn h-11 flex-[1.4] text-[14px]">
                <Check className="size-4" />
                Finish call
              </button>
            </div>
            <div className="mt-2.5 text-center text-[12px]">
              <SaveStatus readOnly={readOnly} savedAt={savedAt} />
            </div>
          </div>
        </>
      )}

      {step === "finish" && (
        <>
          <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
            <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
              <div className="text-[15px] font-semibold">How did the call go?</div>
              <p className="mt-0.5 text-[12.5px] text-muted">Pick what actually happened on the call.</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {CALL_OUTCOMES.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setOutcome(o.value)}
                    aria-pressed={outcome === o.value}
                    className={`flex min-h-11 items-center gap-2 rounded-xl border px-3.5 py-2 text-left text-[14px] font-medium transition ${
                      outcome === o.value ? "border-accent bg-accent-soft text-accent ring-1 ring-accent" : "border-line hover:border-accent/40 hover:bg-subtle"
                    }`}
                  >
                    <span className={`size-2 flex-none rounded-full ${o.conversation ? "bg-good" : "bg-faint"}`} />
                    {o.label}
                  </button>
                ))}
              </div>
              {outcomeInfo && !outcomeInfo.conversation && totalAnswered > 0 && (
                <p className="mt-3 text-[12.5px] text-muted">
                  The call will be recorded as not connected. Your {totalAnswered} answers stay as a draft for the next call.
                </p>
              )}
            </div>
            <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
              <label htmlFor="follow-up-at" className="text-[15px] font-semibold">
                Next follow-up
              </label>
              <input id="follow-up-at" type="datetime-local" className="input mt-2 h-10" value={followUpAt} onChange={(e) => setFollowUpAt(e.target.value)} />
            </div>
            {outcomeInfo?.conversation && <Summary answers={draft.answers} />}
          </div>
          <div className="flex gap-2 border-t border-line bg-surface px-6 py-4">
            <button type="button" onClick={() => setStep("questions")} className="btn-ghost h-11 flex-1 text-[14px]">
              Back
            </button>
            <button type="button" disabled={!outcome} onClick={confirmFinish} className="btn h-11 flex-[1.4] text-[14px]">
              {readOnly ? "Finish (preview)" : "Save call"}
            </button>
          </div>
        </>
      )}

      {step === "done" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-10 text-center">
          <span className="grid size-14 place-items-center rounded-full bg-good-soft text-good">
            <Check className="size-7" />
          </span>
          <div className="text-[17px] font-semibold">{outcomeInfo?.label ?? "Call finished"}</div>
          <p className="text-[14px] leading-relaxed text-muted">
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
  if (readOnly) {
    return <span className="text-muted">Preview: answers stay on this device only, nothing is saved to the CRM</span>;
  }
  return savedAt ? (
    <span className="inline-flex items-center gap-1 text-muted">
      <Check className="size-3.5 text-good" /> Draft saved on this device
    </span>
  ) : (
    <span className="text-faint">Not saved yet</span>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13.5px] font-medium transition ${
        on ? "border-accent bg-accent text-white shadow-sm hover:bg-accent-hover" : "border-line bg-surface text-ink hover:border-accent/50 hover:bg-accent-soft"
      }`}
    >
      {on && <Check className="-ml-0.5 size-3.5" />}
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
    // A single-choice question has one answer: picking a listed option replaces a typed one.
    const other = q.multi || has ? a.other : "";
    if (!q.multi && !has) setShowOther(false);
    onChange({ ...a, values, other, skipped: false });
  }

  function toggleOther() {
    if (showOther) {
      setShowOther(false);
      onChange({ ...a, other: "" });
    } else {
      setShowOther(true);
      if (!q.multi) onChange({ ...a, values: [], skipped: false });
    }
  }

  const visibleFollowUps = (q.followUps ?? []).filter((f) => f.when.some((w) => a.values.includes(w)));

  return (
    <div className={`px-4 py-4 ${a.skipped ? "bg-subtle/50" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className={`text-[14.5px] leading-snug font-semibold ${a.skipped ? "text-muted" : ""}`}>
          <span className="mr-1.5 font-medium text-faint tabular-nums">{n}.</span>
          {q.label}
        </div>
        {q.multi && <span className="mt-0.5 flex-none rounded-full bg-subtle px-2 py-0.5 text-[11px] font-medium text-muted">Pick any</span>}
      </div>
      {!a.skipped && (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            {q.options.map((o) => (
              <Chip key={o.value} on={a.values.includes(o.value)} onClick={() => toggle(o.value)}>
                {o.label}
              </Chip>
            ))}
            {q.allowOther && (
              <Chip on={showOther} onClick={toggleOther}>
                {!showOther && <Plus className="-ml-0.5 size-3.5" />}
                Other
              </Chip>
            )}
          </div>
          {showOther && (
            <input
              autoFocus
              aria-label={`${q.label} (other answer)`}
              className="input mt-2.5 h-10 text-[14px]"
              placeholder="Type what the customer said"
              value={a.other ?? ""}
              onChange={(e) => onChange({ ...a, other: e.target.value, skipped: false })}
            />
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
        </>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-1 text-[12.5px]">
        <button
          type="button"
          onClick={() => setShowScript((s) => !s)}
          className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium transition ${showScript ? "bg-accent-soft text-accent" : "text-accent hover:bg-accent-soft"}`}
          aria-expanded={showScript}
        >
          <MessageSquareText className="size-3.5" />
          {showScript ? "Hide script" : "What to say"}
        </button>
        <button
          type="button"
          onClick={() => setShowNote((s) => !s)}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-muted transition hover:bg-subtle hover:text-ink"
        >
          <StickyNote className="size-3.5" />
          Note
        </button>
        <button
          type="button"
          onClick={() => {
            setShowOther(false);
            onChange({ ...a, values: [], other: "", skipped: !a.skipped });
          }}
          className="ml-auto rounded-md px-2 py-1 text-muted transition hover:bg-subtle hover:text-ink"
          aria-pressed={!!a.skipped}
        >
          {a.skipped ? "Not discussed · Undo" : "Skip"}
        </button>
      </div>
      {showScript && (
        <blockquote className="mt-2 rounded-xl border-l-[3px] border-accent bg-accent-soft/70 px-3.5 py-2.5 text-[13.5px] leading-relaxed text-ink">
          “{q.script}”
        </blockquote>
      )}
      {showNote && (
        <input
          aria-label={`${q.label} (note)`}
          className="input mt-2 h-10 text-[14px]"
          placeholder="Note on this answer"
          value={a.note ?? ""}
          onChange={(e) => onChange({ ...a, note: e.target.value })}
        />
      )}
    </div>
  );
}

function FollowUpField({
  f,
  value,
  other,
  onChange,
}: {
  f: FollowUpQuestion;
  value: string;
  other: string;
  onChange: (key: string, v: string) => void;
}) {
  return (
    <div className="mt-3 rounded-xl border border-line bg-subtle/70 px-3.5 py-3">
      <div className="mb-2 text-[13px] font-semibold text-ink">{f.label}</div>
      {f.kind === "datetime" ? (
        <input type="datetime-local" aria-label={f.label} className="input h-10 text-[14px]" value={value} onChange={(e) => onChange(f.key, e.target.value)} />
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {f.options!.map((o) => (
              <Chip key={o.value} on={value === o.value} onClick={() => onChange(f.key, value === o.value ? "" : o.value)}>
                {o.label}
              </Chip>
            ))}
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
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
      <div className="text-[15px] font-semibold">Summary</div>
      {rows.length === 0 ? (
        <p className="mt-1 text-[13px] text-muted">No answers recorded on this call.</p>
      ) : (
        <dl className="mt-2 divide-y divide-line text-[13.5px]">
          {rows.map((r) => (
            <div key={r.q} className="grid grid-cols-[1fr_auto] gap-4 py-2">
              <dt className="text-muted">{r.q}</dt>
              <dd className="max-w-[55%] text-right font-medium">{r.v}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
