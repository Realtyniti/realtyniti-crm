"use client";

import { useActionState } from "react";
import { importLeadsAction, type ActionState } from "@/app/actions";
import { SOURCE_LABEL } from "@/components/badges";
import { LEAD_SOURCES } from "@/lib/types";

export function ImportForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(importLeadsAction, {});
  return (
    <form action={action} className="panel space-y-3">
      <div>
        <label className="label">Paste from Excel or Google Sheets (first row = column names)</label>
        <textarea
          name="csv"
          rows={12}
          required
          className="input font-mono text-xs"
          placeholder={"Name,Phone,Source,Budget,Location,Property,Timeline,Status,Lost reason,Notes\nRavi,9876543210,Facebook,55 lakh,Greater Noida West,2BHK,2 months,,,Wants ready to move"}
        />
      </div>
      <div className="max-w-xs">
        <label className="label">Source when the row doesn&apos;t say</label>
        <select name="source" className="input" defaultValue="other">
          {LEAD_SOURCES.map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABEL[s]}
            </option>
          ))}
        </select>
      </div>
      <button className="btn" disabled={pending}>
        {pending ? "Importing…" : "Import leads"}
      </button>
      {state.ok && <p className="text-sm text-green-700">{state.ok}</p>}
      {state.error && <p className="text-sm text-red-700">{state.error}</p>}
    </form>
  );
}
