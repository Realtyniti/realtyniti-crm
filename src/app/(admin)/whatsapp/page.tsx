import { formatDateTime } from "@/lib/format";
import { isReadOnly } from "@/lib/read-only";
import { getStore } from "@/lib/store";
import { WhatsAppSettingsForm } from "./form";

export const dynamic = "force-dynamic";

export default async function WhatsAppSettingsPage() {
  const settings = await getStore().getWhatsAppSettings();
  const connected = !!process.env.WHATSAPP_PHONE_NUMBER_ID && !!process.env.WHATSAPP_TOKEN && !isReadOnly();
  const facts: [string, string][] = [
    ["Cloud API credentials", connected ? "Set: messages that pass the switches go to Meta" : "Not set: messages are recorded as dry runs"],
    ["Sending", settings.outbound_enabled ? "On" : "Off"],
    ["Automatic messages", settings.automation_enabled ? "On" : "Off"],
    ["Test mode", settings.test_mode ? `On (${settings.test_numbers.length} test number${settings.test_numbers.length === 1 ? "" : "s"})` : "Off"],
  ];

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="page-title">WhatsApp</h1>
        <p className="mt-1 text-sm text-muted">
          Every WhatsApp message passes these switches. They start off, so connecting the number sends nothing until you
          switch sending on. Alerts to your own number are allowed whenever sending is on.
        </p>
      </div>
      <section className="panel">
        <h2 className="eyebrow">Right now</h2>
        <dl className="mt-3 space-y-2 text-[13.5px]">
          {facts.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3">
              <dt className="text-muted">{k}</dt>
              <dd className="text-right font-medium">{v}</dd>
            </div>
          ))}
        </dl>
        {settings.updated_at && <p className="mt-3 text-[12px] text-faint">Last changed {formatDateTime(settings.updated_at)}</p>}
      </section>
      <section className="panel">
        <h2 className="eyebrow mb-4">Switches</h2>
        <WhatsAppSettingsForm settings={settings} disabled={isReadOnly()} />
      </section>
      <section className="panel text-[13px] text-muted">
        <h2 className="eyebrow mb-2 text-ink">What a lead needs before the bot messages it</h2>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Sending and automatic messages both on (and, in test mode, its number on the list).</li>
          <li>Automatic WhatsApp allowed on that lead&apos;s page. Imported and existing leads start not allowed.</li>
          <li>For follow-ups: the lead was already reached on WhatsApp, and the message template is approved.</li>
        </ol>
      </section>
    </div>
  );
}
