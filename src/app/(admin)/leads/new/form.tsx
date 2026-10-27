"use client";

import { useActionState } from "react";
import { addLeadAction, type ActionState } from "@/app/actions";
import { AnswerFields } from "@/components/answer-fields";
import { SOURCE_LABEL } from "@/components/badges";
import { LEAD_SOURCES } from "@/lib/types";

export function NewLeadForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(addLeadAction, {});
  return (
    <form action={action} className="panel space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label">Phone *</label>
          <input name="phone" required className="input" placeholder="98XXXXXXXX" />
        </div>
        <div>
          <label className="label">Name</label>
          <input name="name" className="input" />
        </div>
        <div>
          <label className="label">Came from *</label>
          <select name="source" required className="input" defaultValue="">
            <option value="" disabled>
              Choose…
            </option>
            {LEAD_SOURCES.map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <AnswerFields />
      <div>
        <label className="label">Their message or your call note</label>
        <textarea name="message" rows={3} className="input" />
      </div>
      {state.error && <p className="text-sm text-red-700">{state.error}</p>}
      <button className="btn" disabled={pending}>
        {pending ? "Saving…" : "Save lead card"}
      </button>
      <p className="text-xs text-muted">
        If this number is already on a card, the details are added to that card instead of creating a second one.
      </p>
    </form>
  );
}
