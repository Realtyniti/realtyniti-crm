"use client";

import { useActionState } from "react";
import { acceptFiguresAction, compareFiguresAction, type FigureState } from "@/app/actions";
import { formatBudget } from "@/lib/format";
import { AVAILABILITY_LABEL } from "@/lib/projects";
import type { Project } from "@/lib/types";

/** Developer replied: enter their figures, see old vs new, accept each change. */
export function FreshnessCheck({ p }: { p: Project }) {
  const [compared, compare, comparing] = useActionState<FigureState, FormData>(compareFiguresAction.bind(null, p.id), {});

  if (compared.changes && compared.reply) {
    return <AcceptChanges p={p} compared={compared} />;
  }
  const input = (name: string, label: string, value: string | null, type = "text") => (
    <div>
      <label className="label">{label}</label>
      <input name={name} type={type} defaultValue={value ?? ""} className="input" />
    </div>
  );
  return (
    <form action={compare} className="space-y-2">
      {input("price", "Price range", formatBudget(p.price_min_inr, p.price_max_inr)?.replace(/₹/g, "") ?? null)}
      {input("payment_plan", "Payment plan", p.payment_plan)}
      {input("offers", "Offers", p.offers)}
      {input("offer_valid_until", "Offer valid until", p.offer_valid_until, "date")}
      {input("possession", "Possession", p.possession)}
      {input("plc", "PLC", p.plc)}
      <div>
        <label className="label">Availability</label>
        <select name="availability" className="input" defaultValue={p.availability}>
          {Object.entries(AVAILABILITY_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <button className="btn-ghost" disabled={comparing}>
        Compare with current figures
      </button>
    </form>
  );
}

function AcceptChanges({ p, compared }: { p: Project; compared: FigureState }) {
  const [state, accept, pending] = useActionState<FigureState, FormData>(acceptFiguresAction.bind(null, p.id, compared.reply!), {});
  if (state.ok) return <p className="text-sm text-green-700">{state.ok}</p>;
  const changes = compared.changes!;
  return (
    <form action={accept} className="space-y-2 text-sm">
      {changes.length === 0 ? (
        <p className="text-muted">The developer&apos;s figures match what you have.</p>
      ) : (
        <table className="w-full">
          <thead className="text-left text-xs uppercase text-muted">
            <tr>
              <th className="py-1">Accept</th>
              <th className="py-1">Field</th>
              <th className="py-1">Now</th>
              <th className="py-1">Developer says</th>
            </tr>
          </thead>
          <tbody>
            {changes.map((c) => (
              <tr key={c.key} className="border-t border-line align-top">
                <td className="py-1.5">
                  <input type="checkbox" name="accept" value={c.key} defaultChecked />
                </td>
                <td className="py-1.5 font-medium">{c.label}</td>
                <td className="py-1.5 text-muted line-through">{c.before || "—"}</td>
                <td className="py-1.5">{c.after || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <input name="confirmed_by" className="input" placeholder="Confirmed by (name)" defaultValue={p.developer_contact_name ?? ""} />
      <button className="btn" disabled={pending}>
        {changes.length ? "Accept ticked changes" : "Mark confirmed today"}
      </button>
    </form>
  );
}
