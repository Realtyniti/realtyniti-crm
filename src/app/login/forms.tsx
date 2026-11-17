"use client";

import { keepFields } from "@/components/auth/keep-form";
import { useActionState } from "react";
import { joinAction, loginAction, setupOwnerAction, type TeamState } from "@/app/team-actions";
import { Field } from "@/components/auth/auth-shell";

function Submit({ pending, label, busy }: { pending: boolean; label: string; busy: string }) {
  return (
    <button className="btn h-11 w-full text-[15px]" disabled={pending}>
      {pending ? busy : label}
    </button>
  );
}

function Problem({ state }: { state: TeamState }) {
  return state.error ? (
    <p role="alert" className="rounded-lg bg-hot-soft px-3 py-2 text-[13px] text-hot">
      {state.error}
    </p>
  ) : null;
}

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<TeamState, FormData>(loginAction, {});
  return (
    <form action={action} onSubmit={keepFields(action)} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <Field label="Mobile number" name="phone" type="tel" inputMode="tel" autoComplete="username" placeholder="98xxx xxxxx" autoFocus />
      <Field label="Password" name="password" type="password" autoComplete="current-password" />
      <Problem state={state} />
      <Submit pending={pending} label="Sign in" busy="Signing in…" />
      <p className="text-center text-[12.5px] text-muted">Forgot your password? Ask the owner for a new link.</p>
    </form>
  );
}

export function SetupForm({ needsKey }: { needsKey: boolean }) {
  const [state, action, pending] = useActionState<TeamState, FormData>(setupOwnerAction, {});
  return (
    <form action={action} onSubmit={keepFields(action)} className="space-y-4">
      <Field label="Your name" name="name" autoComplete="name" autoFocus />
      <Field label="Your mobile number (you'll sign in with it)" name="phone" type="tel" inputMode="tel" autoComplete="username" placeholder="98xxx xxxxx" />
      <Field label="Choose a password (8 or more characters)" name="password" type="password" autoComplete="new-password" />
      <Field label="Type it again" name="confirm" type="password" autoComplete="new-password" />
      {needsKey && (
        <div className="rounded-xl border border-gold-line bg-gold-soft/60 p-3">
          <Field label="The CRM's current shared password" name="setup_key" type="password" autoComplete="off" />
          <p className="mt-1.5 text-[12px] text-gold-ink">This proves it&apos;s you. It is only needed once, for this setup.</p>
        </div>
      )}
      <Problem state={state} />
      <Submit pending={pending} label="Create my owner login" busy="Setting up…" />
    </form>
  );
}

export function JoinForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<TeamState, FormData>(joinAction.bind(null, token), {});
  return (
    <form action={action} onSubmit={keepFields(action)} className="space-y-4">
      <Field label="Choose a password (8 or more characters)" name="password" type="password" autoComplete="new-password" autoFocus />
      <Field label="Type it again" name="confirm" type="password" autoComplete="new-password" />
      <Problem state={state} />
      <Submit pending={pending} label="Save and sign in" busy="Saving…" />
    </form>
  );
}
