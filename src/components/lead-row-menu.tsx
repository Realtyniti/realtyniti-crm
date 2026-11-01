"use client";

import Link from "next/link";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { Copy, ExternalLink, MoreVertical, SearchCheck } from "lucide-react";

const item =
  "flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] text-ink outline-none select-none data-[highlighted]:bg-subtle";

/** The compact More menu on each lead row. */
export function LeadRowMenu({ leadId, phone, label = "More actions" }: { leadId: string; phone: string; label?: string }) {
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger
        aria-label={label}
        className="grid size-8 place-items-center rounded-lg text-muted transition hover:bg-subtle hover:text-ink data-[state=open]:bg-subtle"
      >
        <MoreVertical className="size-4" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="end" sideOffset={6} className="z-50 min-w-48 rounded-xl border border-line bg-surface p-1 shadow-lift">
          <Menu.Item asChild className={item}>
            <Link href={`/leads/${leadId}`}>
              <ExternalLink className="size-4 text-muted" /> Open lead
            </Link>
          </Menu.Item>
          <Menu.Item asChild className={item}>
            <Link href={`/match?lead=${leadId}`}>
              <SearchCheck className="size-4 text-muted" /> Find matching projects
            </Link>
          </Menu.Item>
          <Menu.Item className={item} onSelect={() => navigator.clipboard?.writeText(phone).catch(() => undefined)}>
            <Copy className="size-4 text-muted" /> Copy phone number
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
