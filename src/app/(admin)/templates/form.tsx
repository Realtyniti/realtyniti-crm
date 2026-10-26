"use client";

import { useActionState } from "react";
import { saveTemplateAction, type ActionState } from "@/app/actions";
import type { MessageTemplate } from "@/lib/types";

export function TemplateForm({ t }: { t: MessageTemplate }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveTemplateAction.bind(null, t.key), {});
  return (
    <form action={action} className="space-y-2">
      <textarea name="body" rows={3} className="input font-mono text-xs" defaultValue={t.body} />
      <div className="flex items-center gap-2">
        <button name="intent" value="approve" className="btn" disabled={pending}>
          {t.approved_at ? "Save and re-approve" : "Approve"}
        </button>
        <button name="intent" value="save" className="btn-ghost" disabled={pending}>
          Save draft
        </button>
        {state.ok && <span className="text-sm text-green-700">{state.ok}</span>}
        {state.error && <span className="text-sm text-red-700">{state.error}</span>}
      </div>
    </form>
  );
}
