"use client";

import { keepFields } from "@/components/auth/keep-form";
import { useActionState } from "react";
import { changePasswordAction, type TeamState } from "@/app/team-actions";

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState<TeamState, FormData>(changePasswordAction, {});
  return (
    <form action={action} onSubmit={keepFields(action)} className="grid gap-3 sm:grid-cols-3 sm:items-end">
      <div>
        <label htmlFor="current" className="label">
          Current password
        </label>
        <input id="current" name="current" type="password" autoComplete="current-password" required className="input h-10" />
      </div>
      <div>
        <label htmlFor="password" className="label">
          New password
        </label>
        <input id="password" name="password" type="password" autoComplete="new-password" required className="input h-10" />
      </div>
      <div>
        <label htmlFor="confirm" className="label">
          New password again
        </label>
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" required className="input h-10" />
      </div>
      <div className="flex items-center gap-3 sm:col-span-3">
        <button className="btn" disabled={pending}>
          {pending ? "Saving…" : "Change password"}
        </button>
        {state.ok && <span className="text-[13px] text-good">{state.ok}</span>}
        {state.error && <span className="text-[13px] text-hot">{state.error}</span>}
      </div>
    </form>
  );
}
