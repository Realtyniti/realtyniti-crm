import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyButton } from "@/components/copy-button";
import { FreshnessDot } from "@/components/freshness";
import { normalisePhone } from "@/lib/phone";
import { clientSummary, developerConfirmation } from "@/lib/projects";
import { getStore } from "@/lib/store";
import { ProjectForm } from "../form";
import { FreshnessCheck } from "./freshness-check";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await getStore().getProject(id);
  if (!p) notFound();
  const summary = clientSummary(p);
  const confirm = developerConfirmation(p);
  const devPhone = normalisePhone(p.developer_contact_phone);

  return (
    <div className="space-y-4">
      <Link href="/projects" className="text-sm text-stone-500 hover:underline">
        ← All projects
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{p.name}</h1>
        <span className="text-stone-600">{p.developer}</span>
        <FreshnessDot p={p} />
        {p.confirmed_by && <span className="text-xs text-stone-500">by {p.confirmed_by}</span>}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ProjectForm project={p} />
        </div>
        <aside className="space-y-4">
          <section className="panel space-y-2 text-sm">
            <h2 className="font-medium">Ask the developer to re-confirm</h2>
            <pre className="whitespace-pre-wrap rounded bg-stone-50 p-2 font-sans text-xs">{confirm}</pre>
            <div className="flex gap-2">
              <CopyButton text={confirm} label="Copy" />
              {devPhone && (
                <a
                  className="btn-ghost text-xs"
                  href={`https://wa.me/${devPhone.replace("+", "")}?text=${encodeURIComponent(confirm)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open in WhatsApp
                </a>
              )}
            </div>
            <p className="text-xs text-stone-500">When they reply, enter their figures under “Developer replied?”.</p>
          </section>
          <section className="panel space-y-2 text-sm">
            <h2 className="font-medium">Developer replied?</h2>
            <p className="text-xs text-stone-500">Enter their figures. You&apos;ll see old and new side by side and accept each change.</p>
            <FreshnessCheck p={p} />
          </section>
          <section className="panel space-y-2 text-sm">
            <h2 className="font-medium">Client summary (draft)</h2>
            <pre className="whitespace-pre-wrap rounded bg-stone-50 p-2 font-sans text-xs">{summary}</pre>
            <CopyButton text={summary} label="Copy" />
            <p className="text-xs text-stone-500">Read every price and offer before you send it; the date beside each shows when it was last confirmed.</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
