import { SOURCE_LABEL } from "@/components/badges";
import { formatDateTime } from "@/lib/format";
import { ensureDefaultTemplates } from "@/lib/leads";
import { getStore } from "@/lib/store";
import { TemplateForm } from "./form";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const store = getStore();
  await ensureDefaultTemplates(store);
  const templates = await store.listTemplates();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Message templates</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Approve each message once before it can be sent automatically. A template can never mention a price, payment
          plan, discount or offer; those you send yourself. Editing the text withdraws its approval.
          Placeholders: <code>{"{{name}}"}</code>, <code>{"{{micro_market}}"}</code>, <code>{"{{referrer}}"}</code>.
        </p>
      </div>
      {templates.map((t) => (
        <section key={t.key} className="panel space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{t.purpose}</span>
            {t.channel && <span className="rounded bg-subtle px-2 py-0.5 text-xs">{SOURCE_LABEL[t.channel]}</span>}
            {t.approved_at ? (
              <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-800">
                Approved {formatDateTime(t.approved_at)}
              </span>
            ) : (
              <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">Not approved</span>
            )}
          </div>
          <TemplateForm t={t} />
        </section>
      ))}
    </div>
  );
}
