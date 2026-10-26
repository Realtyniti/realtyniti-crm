"use client";

import { useActionState } from "react";
import { saveSpendAction, type ActionState } from "@/app/actions";
import { SOURCE_LABEL } from "@/components/badges";
import { LEAD_SOURCES } from "@/lib/types";

export function SpendForm({ month }: { month: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveSpendAction, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <div>
        <label className="label">Channel</label>
        <select name="source" className="input" defaultValue="meta">
          {LEAD_SOURCES.map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABEL[s]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label">Month</label>
        <input name="month" type="month" defaultValue={month} className="input" />
      </div>
      <div>
        <label className="label">Spend (₹)</label>
        <input name="amount" inputMode="numeric" className="input" placeholder="25000" />
      </div>
      <button className="btn" disabled={pending}>
        Save spend
      </button>
      {state.ok && <span className="text-sm text-green-700">{state.ok}</span>}
      {state.error && <span className="text-sm text-red-700">{state.error}</span>}
    </form>
  );
}
