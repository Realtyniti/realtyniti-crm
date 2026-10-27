import Link from "next/link";
import { FreshnessDot } from "@/components/freshness";
import { formatBudget, formatDate } from "@/lib/format";
import { AVAILABILITY_LABEL, FRESH_DAYS, freshness, offersExpiring, STALE_DAYS } from "@/lib/projects";
import { getStore } from "@/lib/store";

export default async function ProjectsPage() {
  const projects = await getStore().listProjects();
  const order = { red: 0, amber: 1, green: 2 } as const;
  const sorted = [...projects].sort((a, b) => order[freshness(a)] - order[freshness(b)] || a.name.localeCompare(b.name));
  const expiring = offersExpiring(projects, 10);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
        <Link href="/projects/new" className="btn-ghost ml-auto">
          Add project
        </Link>
      </div>
      <p className="max-w-3xl text-sm text-muted">
        Green: confirmed in the last {FRESH_DAYS} days. Amber: {FRESH_DAYS}–{STALE_DAYS} days. Red: older or never; confirm
        with the developer before sharing any figure. Tick two or three projects to draft a comparison.
      </p>

      {expiring.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <strong>Offers ending soon:</strong>{" "}
          {expiring.map((p) => `${p.name} (${formatDate(p.offer_valid_until)})`).join(", ")}
        </div>
      )}

      {projects.length === 0 ? (
        <p className="panel text-sm text-muted">No projects yet. Add each developer project you work with once.</p>
      ) : (
        <form action="/projects/compare" className="space-y-2">
          <div className="overflow-x-auto rounded-lg border border-line bg-white">
            <table className="w-full text-sm">
              <thead className="bg-subtle text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2"></th>
                  <th className="px-3 py-2">Project</th>
                  <th className="px-3 py-2">Location</th>
                  <th className="px-3 py-2">Homes</th>
                  <th className="px-3 py-2">Price</th>
                  <th className="px-3 py-2">Offer</th>
                  <th className="px-3 py-2">Availability</th>
                  <th className="px-3 py-2">Freshness</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {sorted.map((p) => (
                  <tr key={p.id} className="hover:bg-subtle">
                    <td className="px-3 py-2">
                      <input type="checkbox" name="ids" value={p.id} aria-label={`Compare ${p.name}`} />
                    </td>
                    <td className="px-3 py-2">
                      <Link href={`/projects/${p.id}`} className="font-medium hover:underline">
                        {p.name}
                      </Link>
                      <div className="text-xs text-muted">{p.developer}</div>
                    </td>
                    <td className="px-3 py-2">{[p.sector, p.micro_market].filter(Boolean).join(", ")}</td>
                    <td className="px-3 py-2">{p.configurations}</td>
                    <td className="px-3 py-2">{formatBudget(p.price_min_inr, p.price_max_inr)}</td>
                    <td className="px-3 py-2">
                      {p.offers}
                      {p.offer_valid_until && <div className="text-xs text-muted">till {formatDate(p.offer_valid_until)}</div>}
                    </td>
                    <td className="px-3 py-2">{AVAILABILITY_LABEL[p.availability]}</td>
                    <td className="px-3 py-2">
                      <FreshnessDot p={p} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="btn-ghost">Draft comparison of ticked projects</button>
        </form>
      )}
    </div>
  );
}
