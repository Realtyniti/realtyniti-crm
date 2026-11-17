"use client";

import { keepFields } from "@/components/auth/keep-form";
import { useActionState, useEffect, useRef } from "react";
import { Ban, Link2, MessageCircle, RotateCcw, UserPlus } from "lucide-react";
import {
  addMemberAction,
  changeRoleAction,
  deactivateAction,
  reactivateAction,
  reassignAllAction,
  resetLinkAction,
  type TeamState,
} from "@/app/team-actions";
import { CopyButton } from "@/components/copy-button";
import { ROLE_LABEL, ROLE_SUMMARY } from "@/lib/auth/roles";
import { whatsappUrl } from "@/lib/lead-display";

function Status({ state }: { state: TeamState }) {
  if (state.error) return <p className="text-[13px] text-hot">{state.error}</p>;
  if (state.ok && !state.link) return <p className="text-[13px] text-good">{state.ok}</p>;
  return null;
}

/** The one-time link, shown once, with a button to send it from the owner's own WhatsApp. */
function LinkBox({ state }: { state: TeamState }) {
  if (!state.link) return null;
  const first = state.linkFor?.name.split(" ")[0] ?? "";
  const text = `Hi ${first}, here is your RealtyNiti CRM login link. Open it on your phone and choose your password: ${state.link}\nIt works once, for 7 days.`;
  return (
    <div className="mt-3 rounded-xl border border-gold-line bg-gold-soft/60 p-3.5">
      <p className="text-[13px] font-semibold text-ink">{state.ok}</p>
      <p className="mt-0.5 text-[12.5px] text-gold-ink">
        Send this link to {state.linkFor?.name ?? "them"}. It works once, for 7 days, and is shown only now.
      </p>
      <div className="mt-2 rounded-lg border border-line bg-surface px-2.5 py-2 font-mono text-[12px] break-all text-ink-2">{state.link}</div>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <CopyButton text={state.link} label="Copy link" />
        {state.linkFor && (
          <a href={whatsappUrl(state.linkFor.phone, text)} target="_blank" rel="noreferrer" className="btn-wa text-xs">
            <MessageCircle className="size-3.5" />
            Send on WhatsApp
          </a>
        )}
      </div>
    </div>
  );
}

export function AddMemberForm({ disabled }: { disabled?: boolean }) {
  const [state, action, pending] = useActionState<TeamState, FormData>(addMemberAction, {});
  const form = useRef<HTMLFormElement>(null);
  // Clear the fields once the person is added (their link shows below); keep them after an error.
  useEffect(() => {
    if (state.link) form.current?.reset();
  }, [state]);
  return (
    <div>
      <form ref={form} action={action} onSubmit={keepFields(action)} className="grid gap-3 sm:grid-cols-[1.2fr_1fr_0.9fr_auto] sm:items-end">
        <fieldset disabled={disabled} className="contents">
          <div>
            <label htmlFor="m-name" className="label">
              Name
            </label>
            <input id="m-name" name="name" required className="input h-10" placeholder="Full name" />
          </div>
          <div>
            <label htmlFor="m-phone" className="label">
              Mobile number
            </label>
            <input id="m-phone" name="phone" type="tel" inputMode="tel" required className="input h-10" placeholder="98xxx xxxxx" />
          </div>
          <div>
            <label htmlFor="m-role" className="label">
              Role
            </label>
            <select id="m-role" name="role" className="input h-10" defaultValue="agent">
              <option value="agent">Agent</option>
              <option value="manager">Manager</option>
              <option value="reviewer">Reviewer (view-only)</option>
            </select>
          </div>
          <button className="btn h-10" disabled={pending}>
            <UserPlus className="size-4" />
            {pending ? "Adding…" : "Add"}
          </button>
        </fieldset>
      </form>
      <div className="mt-2 grid gap-1 text-[12.5px] text-muted sm:grid-cols-2">
        <p>
          <b className="font-semibold text-ink-2">Agent:</b> {ROLE_SUMMARY.agent}
        </p>
        <p>
          <b className="font-semibold text-ink-2">Manager:</b> {ROLE_SUMMARY.manager}
        </p>
        <p className="sm:col-span-2">
          <b className="font-semibold text-ink-2">Reviewer:</b> {ROLE_SUMMARY.reviewer} Any unused mobile number works as its login, e.g.
          90000 00001.
        </p>
      </div>
      <div className="mt-2">
        <Status state={state} />
      </div>
      <LinkBox state={state} />
    </div>
  );
}

export function MemberControls({
  member,
  others,
  leadCount,
  disabled,
}: {
  member: { id: string; name: string; role: "manager" | "agent" | "reviewer"; active: boolean };
  others: { id: string; name: string }[];
  leadCount: number;
  disabled?: boolean;
}) {
  const [deact, deactivate, deactPending] = useActionState<TeamState>(deactivateAction.bind(null, member.id), {});
  const [react, reactivate, reactPending] = useActionState<TeamState>(reactivateAction.bind(null, member.id), {});
  const [reset, makeLink, resetPending] = useActionState<TeamState>(resetLinkAction.bind(null, member.id), {});
  const [role, changeRole, rolePending] = useActionState<TeamState, FormData>(changeRoleAction.bind(null, member.id), {});
  const [moved, reassign, movePending] = useActionState<TeamState, FormData>(reassignAllAction.bind(null, member.id), {});
  const last = [deact, react, reset, role, moved].find((s) => s.error || s.ok) ?? {};

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        {member.active ? (
          <>
            <form action={changeRole} className="flex items-center gap-1.5">
              <label className="sr-only" htmlFor={`role-${member.id}`}>
                Role for {member.name}
              </label>
              <select
                id={`role-${member.id}`}
                name="role"
                defaultValue={member.role}
                disabled={disabled || rolePending}
                className="input h-8 w-auto py-0 text-[13px]"
                onChange={(e) => e.currentTarget.form?.requestSubmit()}
              >
                <option value="agent">{ROLE_LABEL.agent}</option>
                <option value="manager">{ROLE_LABEL.manager}</option>
                <option value="reviewer">{ROLE_LABEL.reviewer}</option>
              </select>
            </form>
            <form action={makeLink}>
              <button className="btn-ghost h-8 px-2.5 text-[12.5px]" disabled={disabled || resetPending} title="New password link; signs them out everywhere">
                <Link2 className="size-3.5" />
                New login link
              </button>
            </form>
            <form action={deactivate}>
              <button
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-hot/30 bg-hot-soft px-2.5 text-[12.5px] font-semibold text-hot transition hover:border-hot disabled:opacity-50"
                disabled={disabled || deactPending}
              >
                <Ban className="size-3.5" />
                {deactPending ? "Deactivating…" : "Deactivate"}
              </button>
            </form>
          </>
        ) : (
          <form action={reactivate}>
            <button className="btn-ghost h-8 px-2.5 text-[12.5px]" disabled={disabled || reactPending}>
              <RotateCcw className="size-3.5" />
              Reactivate
            </button>
          </form>
        )}
      </div>
      {leadCount > 0 && (
        <form action={reassign} className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
          <span className="text-muted">
            Move {member.active ? "all" : "their"} {leadCount} lead{leadCount === 1 ? "" : "s"} to
          </span>
          <select name="to" className="input h-8 w-auto py-0 text-[12.5px]" defaultValue="" disabled={disabled}>
            <option value="">Nobody (unassigned)</option>
            {others.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <button className="btn-ghost h-8 px-2.5 text-[12.5px]" disabled={disabled || movePending}>
            {movePending ? "Moving…" : "Move"}
          </button>
        </form>
      )}
      <Status state={last} />
      <LinkBox state={reset} />
    </div>
  );
}
