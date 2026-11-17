"use client";

import * as Menu from "@radix-ui/react-dropdown-menu";
import { useState, useTransition } from "react";
import { Check, ChevronDown, UserMinus, UserPlus, Users } from "lucide-react";
import { assignLeadAction } from "@/app/team-actions";
import { Avatar } from "@/components/badges";
import { ROLE_LABEL, type Role } from "@/lib/auth/roles";

export interface TeamOption {
  id: string;
  name: string;
  role: Role;
  active: boolean;
}

/**
 * Who works the lead, and (for the owner and managers) the menu to hand it to someone else.
 * Agents see the name only. A deactivated person's name stays on their leads until reassigned.
 */
export function AssignAgent({
  leadId,
  agentId,
  team,
  canAssign,
  compact = false,
}: {
  leadId: string;
  agentId: string | null;
  team: TeamOption[];
  canAssign: boolean;
  compact?: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState(agentId);
  const agent = team.find((m) => m.id === current) ?? null;
  const label = agent ? `${agent.name}${agent.active ? "" : " (deactivated)"}` : null;

  if (!canAssign) {
    return (
      <span className="inline-flex max-w-full items-center gap-1.5 text-[13px] font-medium text-ink">
        {agent ? <Avatar name={agent.name} size="sm" /> : null}
        <span className="truncate">{label ?? <span className="text-faint">Unassigned</span>}</span>
      </span>
    );
  }

  function assign(id: string | null) {
    setError(null);
    const before = current;
    setCurrent(id);
    start(async () => {
      const r = await assignLeadAction(leadId, id);
      if (r.error) {
        setCurrent(before);
        setError(r.error);
      }
    });
  }

  const choices = team.filter((m) => m.active);
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger
        className={`group inline-flex max-w-full items-center gap-1.5 rounded-full border text-[13px] font-medium transition data-[state=open]:border-gold data-[state=open]:bg-gold-soft ${
          agent
            ? `border-transparent py-0.5 pr-2 pl-0.5 hover:border-line hover:bg-subtle ${agent.active ? "text-ink" : "text-hot"}`
            : "border-dashed border-gold-line bg-gold-soft/50 px-2.5 py-1 text-gold-ink hover:border-gold hover:bg-gold-soft"
        } ${pending ? "opacity-60" : ""}`}
        aria-label={label ? `Assigned to ${label}. Reassign` : "Unassigned. Assign someone"}
        title={error ?? undefined}
      >
        {agent ? <Avatar name={agent.name} size="sm" /> : <UserPlus className="size-3.5" />}
        <span className="truncate">{label ?? (compact ? "Assign" : "Unassigned")}</span>
        <ChevronDown className="size-3.5 flex-none opacity-50 group-hover:opacity-100" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="start" sideOffset={6} className="z-50 max-h-80 w-64 overflow-y-auto rounded-xl border border-line bg-surface p-1.5 shadow-lift">
          <Menu.Label className="px-2.5 pt-1.5 pb-1 text-[11px] font-semibold tracking-[0.06em] text-muted uppercase">Assign to</Menu.Label>
          {error && <div className="mx-1 mb-1 rounded-md bg-hot-soft px-2.5 py-1.5 text-[12px] text-hot">{error}</div>}
          {choices.length <= 1 && (
            <div className="mb-1 flex gap-2.5 rounded-lg bg-subtle px-3 py-2.5 text-[12.5px] leading-snug text-muted">
              <Users className="mt-0.5 size-4 flex-none text-gold-ink" />
              <span>
                <b className="font-semibold text-ink">No team members yet.</b> The owner adds managers and agents on the Team page.
              </span>
            </div>
          )}
          {choices.map((m) => (
            <Menu.Item
              key={m.id}
              onSelect={() => assign(m.id)}
              className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] outline-none data-[highlighted]:bg-subtle"
            >
              <Avatar name={m.name} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-ink">{m.name}</span>
                <span className="block text-[11.5px] text-muted">{ROLE_LABEL[m.role]}</span>
              </span>
              {m.id === current && <Check className="size-4 text-gold-ink" />}
            </Menu.Item>
          ))}
          {current && (
            <>
              <Menu.Separator className="my-1 h-px bg-line" />
              <Menu.Item
                onSelect={() => assign(null)}
                className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-muted outline-none data-[highlighted]:bg-subtle"
              >
                <UserMinus className="size-4" />
                Unassign
              </Menu.Item>
            </>
          )}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
