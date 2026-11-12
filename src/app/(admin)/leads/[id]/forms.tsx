"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { closeLeadAction, sendWhatsAppReplyAction, updateLeadAction, type ActionState } from "@/app/actions";
import { AnswerFields } from "@/components/answer-fields";
import type { Lead } from "@/lib/types";

export function EditLeadForm({ lead }: { lead: Lead }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateLeadAction.bind(null, lead.id), {});
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Name</label>
          <input name="name" className="input" defaultValue={lead.name ?? ""} />
        </div>
        <div>
          <label className="label">Email</label>
          <input name="email" type="email" className="input" defaultValue={lead.email ?? ""} />
        </div>
      </div>
      <AnswerFields value={lead} />
      <div>
        <label className="label">Notes</label>
        <textarea name="notes" rows={2} className="input" defaultValue={lead.notes ?? ""} />
      </div>
      <div className="flex items-center gap-3">
        <button className="btn" disabled={pending}>
          {pending ? "Saving…" : "Save and re-tag"}
        </button>
        {state.ok && <span className="text-sm text-good">{state.ok}</span>}
        {state.error && <span className="text-sm text-hot">{state.error}</span>}
      </div>
    </form>
  );
}

export function CloseLeadForm({ lead }: { lead: Lead }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(closeLeadAction.bind(null, lead.id), {});
  const [outcome, setOutcome] = useState<"lost" | "converted">("lost");
  return (
    <form action={action} className="space-y-3">
      <div className="flex gap-4 text-sm">
        {(["lost", "converted"] as const).map((o) => (
          <label key={o} className="flex items-center gap-1.5">
            <input type="radio" name="outcome" value={o} checked={outcome === o} onChange={() => setOutcome(o)} />
            {o === "lost" ? "Lost" : "Converted"}
          </label>
        ))}
      </div>
      {outcome === "lost" && (
        <div>
          <label className="label">Lost reason (required)</label>
          <input
            name="lost_reason"
            required
            className="input"
            placeholder="e.g. Bought elsewhere, budget too low, stopped replying"
          />
        </div>
      )}
      <button className="btn-ghost" disabled={pending}>
        Close lead
      </button>
      {state.ok && <p className="text-sm text-good">{state.ok}</p>}
      {state.error && <p className="text-sm text-hot">{state.error}</p>}
    </form>
  );
}

function newRef() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

/**
 * Chetan's reply box. Each form carries a one-time id (client_ref): a double click or a
 * resubmitted form is recognised on the server and sent only once. A new id is made
 * after every attempt.
 */
export function WhatsAppReplyForm({ leadId, windowOpen, disabled }: { leadId: string; windowOpen: boolean; disabled?: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(sendWhatsAppReplyAction.bind(null, leadId), {});
  const [ref, setRef] = useState(newRef);
  const [body, setBody] = useState("");
  const last = useRef(state);
  useEffect(() => {
    if (state !== last.current) {
      // A new one-time id after every answer, so a retry after "not sent" is a fresh attempt.
      setRef(newRef());
      if (state.ok) setBody("");
    }
    last.current = state;
  }, [state]);

  const off = disabled || !windowOpen;
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="client_ref" value={ref} />
      <label htmlFor="wa-reply" className="sr-only">
        WhatsApp reply
      </label>
      <textarea
        id="wa-reply"
        name="body"
        rows={3}
        maxLength={4096}
        className="input"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={windowOpen ? "Type a WhatsApp reply…" : "Reply box opens when the buyer messages you"}
        disabled={off}
      />
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-wa h-9" disabled={off || pending || !body.trim()}>
          {pending ? "Sending…" : "Send on WhatsApp"}
        </button>
        {state.ok && <span className="text-sm text-good">{state.ok}</span>}
        {state.error && <span className="text-sm text-hot">{state.error}</span>}
      </div>
      {!windowOpen && (
        <p className="text-[12.5px] text-muted">
          WhatsApp only allows free text within 24 hours of the buyer&apos;s last message. Call them, or wait for them to write.
        </p>
      )}
    </form>
  );
}
