"use client";

import * as Menu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, UserPlus, Users } from "lucide-react";
import { Avatar } from "@/components/badges";

/**
 * Who owns the lead, and the menu to hand it to someone else. There are no
 * team logins yet (the CRM has one shared password), so the menu explains
 * that instead of offering names it can't save. It fills in with the agents
 * phase, once the login change is approved.
 */
export function AssignAgent({ agent, compact = false }: { agent: string | null; compact?: boolean }) {
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger
        className={`group inline-flex max-w-full items-center gap-1.5 rounded-full border text-[13px] font-medium transition data-[state=open]:border-accent/50 data-[state=open]:bg-accent-soft ${
          agent
            ? "border-transparent py-0.5 pr-2 pl-0.5 text-ink hover:border-line hover:bg-subtle"
            : "border-dashed border-line px-2.5 py-1 text-muted hover:border-accent/50 hover:text-accent"
        }`}
        aria-label={agent ? `Assigned to ${agent}. Reassign` : "Unassigned. Assign an agent"}
      >
        {agent ? <Avatar name={agent} size="sm" /> : <UserPlus className="size-3.5" />}
        <span className="truncate">{agent ?? (compact ? "Assign" : "Unassigned")}</span>
        <ChevronDown className="size-3.5 flex-none opacity-50 group-hover:opacity-100" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="start" sideOffset={6} className="z-50 w-72 rounded-xl border border-line bg-surface p-1.5 shadow-lift">
          <Menu.Label className="px-2.5 pt-1.5 pb-1 text-[11px] font-semibold tracking-[0.06em] text-muted uppercase">Assign to</Menu.Label>
          <div className="flex gap-2.5 rounded-lg bg-subtle px-3 py-2.5 text-[12.5px] leading-snug text-muted">
            <Users className="mt-0.5 size-4 flex-none text-accent" />
            <span>
              <b className="font-semibold text-ink">No team members yet.</b> Agents get their own logins in the next phase, after you approve
              the login change. Then you can assign and reassign leads from here.
            </span>
          </div>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
