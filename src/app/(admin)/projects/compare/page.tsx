import Link from "next/link";
import { CopyButton } from "@/components/copy-button";
import { comparisonNote, freshness } from "@/lib/projects";
import { getStore } from "@/lib/store";

export default async function ComparePage({ searchParams }: { searchParams: Promise<{ ids?: string | string[] }> }) {
  const { ids } = await searchParams;
  const list = (Array.isArray(ids) ? ids : ids ? [ids] : []).slice(0, 3);
  const store = getStore();
  const projects = (await Promise.all(list.map((id) => store.getProject(id)))).filter((p) => p !== null);
  const stale = projects.filter((p) => freshness(p) !== "green");
  const note = projects.length >= 2 ? comparisonNote(projects) : null;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/projects" className="text-sm text-muted hover:underline">
        ← All projects
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Comparison note (draft)</h1>
      {!note ? (
        <p className="panel text-sm text-muted">Tick two or three projects on the Projects page.</p>
      ) : (
        <section className="panel space-y-3 text-sm">
          {stale.length > 0 && (
            <p className="rounded bg-amber-50 p-2 text-amber-900">
              Not recently confirmed: {stale.map((p) => p.name).join(", ")}. Re-confirm before sharing figures.
            </p>
          )}
          <pre className="whitespace-pre-wrap rounded bg-subtle p-3 font-sans">{note}</pre>
          <CopyButton text={note} label="Copy" />
        </section>
      )}
    </div>
  );
}
