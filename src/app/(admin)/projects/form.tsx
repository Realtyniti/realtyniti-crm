"use client";

import { useActionState } from "react";
import { saveProjectAction, type ActionState } from "@/app/actions";
import { formatBudget } from "@/lib/format";
import { AVAILABILITY_LABEL } from "@/lib/projects";
import type { Project } from "@/lib/types";

function Field({ name, label, value, placeholder, type = "text", wide }: { name: string; label: string; value?: string | null; placeholder?: string; type?: string; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <label className="label">{label}</label>
      <input name={name} type={type} className="input" defaultValue={value ?? ""} placeholder={placeholder} />
    </div>
  );
}

/** The fixed Project Sheet fields, the same for every developer. */
export function ProjectForm({ project }: { project?: Project }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveProjectAction.bind(null, project?.id ?? null), {});
  const p = project;
  return (
    <form action={action} className="panel space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="name" label="Project *" value={p?.name} />
        <Field name="developer" label="Developer *" value={p?.developer} />
        <Field name="micro_market" label="Location *" value={p?.micro_market} placeholder="Yamuna Expressway" />
        <Field name="sector" label="Sector" value={p?.sector} placeholder="Sector 22D" />
        <Field name="rera_number" label="RERA number" value={p?.rera_number} />
        <Field name="configurations" label="Configurations and sizes" value={p?.configurations} placeholder="2BHK 1050 sqft, 3BHK 1450 sqft" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          name="price"
          label="Price range"
          value={p ? formatBudget(p.price_min_inr, p.price_max_inr)?.replace(/₹/g, "") : null}
          placeholder="80 L – 1.2 Cr"
        />
        <Field name="plc" label="PLC" value={p?.plc} />
        <Field name="payment_plan" label="Payment plan" value={p?.payment_plan} placeholder="30:70, construction-linked…" wide />
        <Field name="offers" label="Offers" value={p?.offers} />
        <Field name="offer_valid_until" label="Offer valid until" value={p?.offer_valid_until} type="date" />
        <Field name="possession" label="Possession" value={p?.possession} placeholder="Dec 2027" />
        <div>
          <label className="label">Availability</label>
          <select name="availability" className="input" defaultValue={p?.availability ?? "available"}>
            {Object.entries(AVAILABILITY_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <Field name="amenities" label="Amenities" value={p?.amenities} wide />
        <Field name="developer_contact_name" label="Developer sales contact" value={p?.developer_contact_name} />
        <Field name="developer_contact_phone" label="Contact's WhatsApp" value={p?.developer_contact_phone} />
      </div>
      <div>
        <label className="label">Notes</label>
        <textarea name="notes" rows={2} className="input" defaultValue={p?.notes ?? ""} />
      </div>
      <div className="flex flex-wrap items-center gap-3 rounded-md bg-stone-50 p-3 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="confirmed_today" />
          These figures were confirmed by the developer today
        </label>
        <input name="confirmed_by" className="input max-w-56" placeholder="Confirmed by (name)" />
      </div>
      <div className="flex items-center gap-3">
        <button className="btn" disabled={pending}>
          {pending ? "Saving…" : "Save project"}
        </button>
        {state.ok && <span className="text-sm text-green-700">{state.ok}</span>}
        {state.error && <span className="text-sm text-red-700">{state.error}</span>}
      </div>
    </form>
  );
}
