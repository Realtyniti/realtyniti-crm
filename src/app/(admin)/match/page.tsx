import Link from "next/link";
import { AnswerFields } from "@/components/answer-fields";
import { CopyButton } from "@/components/copy-button";
import { FreshnessDot } from "@/components/freshness";
import { formatBudget } from "@/lib/format";
import { matchProjects, shortlistMessage, type Match } from "@/lib/match";
import { parseBudget, parseMicroMarket, parsePropertyType, parsePurpose, parseTimelineMonths } from "@/lib/parse";
import { getStore } from "@/lib/store";
import type { Requirement } from "@/lib/types";

type Search = Record<string, string | undefined>;

function requirementFrom(q: Search): Requirement {
  const b = parseBudget(q.budget);
  return {
    budget_min_inr: b?.min ?? null,
    budget_max_inr: b?.max ?? null,
    micro_market: parseMicroMarket(q.micro_market),
    property_type: parsePropertyType(q.property_type),
    purpose: parsePurpose(q.purpose),
    timeline_months: parseTimelineMonths(q.timeline),
    agreed_site_visit: false,
  };
}

function MatchRow({ m }: { m: Match }) {
  const p = m.project;
  return (
    <li className="flex flex-wrap items-start gap-x-4 gap-y-1 py-2 text-sm">
      <div className="min-w-56">
        <Link href={`/projects/${p.id}`} className="font-medium hover:underline">
          {p.name}
        </Link>
        <div className="text-xs text-stone-500">
          {p.developer} · {[p.sector, p.micro_market].filter(Boolean).join(", ")}
        </div>
      </div>
      <div className="flex-1 text-stone-700">
        {[p.configurations, formatBudget(p.price_min_inr, p.price_max_inr), p.payment_plan, p.possession && `Possession ${p.possession}`, p.offers]
          .filter(Boolean)
          .join(" · ")}
        <div className="text-xs text-stone-500">{m.miss ?? m.reasons.join(" · ")}</div>
      </div>
      <div className="text-right">
        <FreshnessDot p={p} />
        {m.freshness !== "green" && (
          <div className="text-xs text-amber-800">
            Confirm with {p.developer_contact_name ?? p.developer} first
          </div>
        )}
      </div>
    </li>
  );
}

export default async function MatchPage({ searchParams }: { searchParams: Promise<Search> }) {
  const q = await searchParams;
  const store = getStore();
  const lead = q.lead ? await store.getLead(q.lead) : null;
  const req: Requirement | null = lead ?? (Object.values(q).some(Boolean) ? requirementFrom(q) : null);
  const result = req ? matchProjects(req, await store.listProjects()) : null;
  const draft = result?.matches.length ? shortlistMessage(lead?.name ?? null, result.matches) : null;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Match Finder{lead ? ` for ${lead.name ?? lead.phone}` : ""}</h1>
      {!lead && (
        <form className="panel space-y-3">
          <AnswerFields value={req ?? undefined} />
          <button className="btn">Find matching projects</button>
        </form>
      )}
      {lead && (
        <p className="text-sm text-stone-600">
          Using the requirement on <Link href={`/leads/${lead.id}`} className="underline">{lead.name ?? lead.phone}&apos;s card</Link>.
        </p>
      )}

      {result && (
        <>
          <section className="panel">
            <h2 className="mb-1 font-medium">Matches {result.matches.length}</h2>
            {result.matches.length === 0 ? (
              <p className="text-sm text-stone-500">Nothing in the Project Book fits yet.</p>
            ) : (
              <ul className="divide-y divide-stone-100">
                {result.matches.map((m) => (
                  <MatchRow key={m.project.id} m={m} />
                ))}
              </ul>
            )}
          </section>
          {result.nearMisses.length > 0 && (
            <section className="panel">
              <h2 className="mb-1 font-medium">Near misses {result.nearMisses.length}</h2>
              <ul className="divide-y divide-stone-100">
                {result.nearMisses.map((m) => (
                  <MatchRow key={m.project.id} m={m} />
                ))}
              </ul>
            </section>
          )}
          {draft && (
            <section className="panel space-y-2 text-sm">
              <h2 className="font-medium">Shortlist message (draft, check every figure before sending)</h2>
              <pre className="whitespace-pre-wrap rounded bg-stone-50 p-3 font-sans">{draft}</pre>
              <div className="flex gap-2">
                <CopyButton text={draft} label="Copy" />
                {lead && (
                  <a className="btn-ghost text-xs" href={`https://wa.me/${lead.phone.replace("+", "")}?text=${encodeURIComponent(draft)}`} target="_blank" rel="noreferrer">
                    Open in WhatsApp
                  </a>
                )}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
