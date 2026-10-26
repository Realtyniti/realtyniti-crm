import { formatBudget, PURPOSE_LABEL } from "@/lib/format";
import type { Requirement } from "@/lib/types";

/** The five qualifying answers, typed the way Chetan would say them ("50-60 lakh", "2 months"). */
export function AnswerFields({ value }: { value?: Partial<Requirement> }) {
  const v = value ?? {};
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <label className="label">1 · Budget</label>
        <input
          name="budget"
          className="input"
          placeholder="e.g. 50-60 lakh, under 1.2 cr"
          defaultValue={formatBudget(v.budget_min_inr ?? null, v.budget_max_inr ?? null)?.replace(/₹/g, "") ?? ""}
        />
      </div>
      <div>
        <label className="label">2 · Location</label>
        <input
          name="micro_market"
          className="input"
          placeholder="Noida sector, Greater Noida West, Yamuna Expressway"
          defaultValue={v.micro_market ?? ""}
        />
      </div>
      <div>
        <label className="label">3 · Property type</label>
        <input name="property_type" className="input" placeholder="2BHK, plot, studio, commercial" defaultValue={v.property_type ?? ""} />
      </div>
      <div>
        <label className="label">4 · Purpose</label>
        <select name="purpose" className="input" defaultValue={v.purpose ? PURPOSE_LABEL[v.purpose] : ""}>
          <option value="">Unknown</option>
          {Object.entries(PURPOSE_LABEL).map(([k, label]) => (
            <option key={k} value={label}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label">5 · Deciding within</label>
        <input
          name="timeline"
          className="input"
          placeholder="e.g. 2 months, immediately, just exploring"
          defaultValue={v.timeline_months != null ? `${v.timeline_months} months` : ""}
        />
      </div>
      <label className="flex items-center gap-2 self-end pb-2 text-sm">
        <input type="checkbox" name="agreed_site_visit" defaultChecked={v.agreed_site_visit ?? false} />
        Agreed to a site visit
      </label>
    </div>
  );
}
