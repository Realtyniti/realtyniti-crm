"use client";

import { useActionState } from "react";
import { saveWhatsAppSettingsAction, type ActionState } from "@/app/actions";
import type { WhatsAppSettings } from "@/lib/types";

const SWITCHES: { name: "outbound_enabled" | "automation_enabled" | "test_mode"; label: string; help: string }[] = [
  {
    name: "outbound_enabled",
    label: "Allow WhatsApp sending",
    help: "Master switch. Off: nothing is sent to anyone, not even your own replies. Incoming messages are still received and logged.",
  },
  {
    name: "automation_enabled",
    label: "Allow automatic messages",
    help: "Bot replies, openers, follow-ups and reminders. Each lead also needs its own OK on the customer page.",
  },
  {
    name: "test_mode",
    label: "Test mode",
    help: "Only the numbers listed below can receive anything. Keep this on until testing is finished.",
  },
];

export function WhatsAppSettingsForm({ settings, disabled }: { settings: WhatsAppSettings; disabled?: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveWhatsAppSettingsAction, {});
  return (
    <form action={action} className="space-y-5">
      <fieldset disabled={disabled} className="space-y-4">
        {SWITCHES.map((s) => (
          <label key={s.name} className="flex items-start gap-3">
            <input type="checkbox" name={s.name} defaultChecked={settings[s.name]} className="mt-1 size-4" />
            <span>
              <span className="block text-[14px] font-semibold">{s.label}</span>
              <span className="block text-[13px] text-muted">{s.help}</span>
            </span>
          </label>
        ))}
        <div>
          <label htmlFor="test_numbers" className="label">
            Test numbers (one per line)
          </label>
          <textarea
            id="test_numbers"
            name="test_numbers"
            rows={4}
            className="input font-mono text-sm"
            defaultValue={settings.test_numbers.join("\n")}
            placeholder={"+91 98xxx xxxxx"}
          />
        </div>
      </fieldset>
      <div className="flex items-center gap-3">
        <button className="btn" disabled={disabled || pending}>
          {pending ? "Saving…" : "Save switches"}
        </button>
        {state.ok && <span className="text-sm text-good">{state.ok}</span>}
        {state.error && <span className="text-sm text-hot">{state.error}</span>}
      </div>
    </form>
  );
}
