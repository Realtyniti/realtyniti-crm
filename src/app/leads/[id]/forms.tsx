"use client";

import { useActionState, useState } from "react";
import { closeLeadAction, updateLeadAction, type ActionState } from "@/app/actions";
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
        {state.ok && <span className="text-sm text-green-700">{state.ok}</span>}
        {state.error && <span className="text-sm text-red-700">{state.error}</span>}
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
      {state.ok && <p className="text-sm text-green-700">{state.ok}</p>}
      {state.error && <p className="text-sm text-red-700">{state.error}</p>}
    </form>
  );
}
