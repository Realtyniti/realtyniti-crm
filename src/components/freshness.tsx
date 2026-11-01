import { daysSinceConfirmed, freshness } from "@/lib/projects";
import type { Project } from "@/lib/types";

const STYLE = { green: "bg-green-500", amber: "bg-amber-400", red: "bg-red-500" } as const;

export function FreshnessDot({ p }: { p: Project }) {
  const f = freshness(p);
  const d = daysSinceConfirmed(p);
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      <span className={`h-2.5 w-2.5 rounded-full ${STYLE[f]}`} aria-label={f} />
      {d == null ? "never confirmed" : d === 0 ? "confirmed today" : `${d}d ago`}
    </span>
  );
}
