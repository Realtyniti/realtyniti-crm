"use client";

import { useActionState } from "react";
import { createSlotsAction, type ActionState } from "@/app/actions";

export function NewSlotsForm({ areas }: { areas: string[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createSlotsAction, {});
  return (
    <form action={action} className="panel space-y-3">
      <h2 className="font-medium">Open visit slots</h2>
      <div className="grid gap-3 sm:grid-cols-4">
        <div>
          <label className="label">Date</label>
          <input name="date" type="date" required className="input" />
        </div>
        <div>
          <label className="label">First slot starts (IST)</label>
          <input name="time" type="time" required defaultValue="10:00" className="input" />
        </div>
        <div>
          <label className="label">Slot length</label>
          <select name="minutes" className="input" defaultValue="60">
            <option value="30">30 min</option>
            <option value="60">1 hour</option>
            <option value="90">1.5 hours</option>
            <option value="120">2 hours</option>
          </select>
        </div>
        <div>
          <label className="label">How many slots in a row</label>
          <input name="count" type="number" min={1} max={12} defaultValue={4} className="input" />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <div>
          <label className="label">Area</label>
          <input name="area" required list="areas" className="input" placeholder="Yamuna Expressway" />
          <datalist id="areas">
            {areas.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </div>
        <div className="sm:col-span-2">
          <label className="label">Meeting address (optional)</label>
          <input name="address" className="input" placeholder="Sales office, Sector 22D" />
        </div>
        <div>
          <label className="label">Visitors per slot</label>
          <input name="capacity" type="number" min={1} max={10} defaultValue={1} className="input" />
        </div>
      </div>
      <div>
        <label className="label">Google Maps link (optional)</label>
        <input name="map_url" type="url" className="input" placeholder="https://maps.app.goo.gl/…" />
      </div>
      <div className="flex items-center gap-3">
        <button className="btn" disabled={pending}>
          Open slots
        </button>
        {state.ok && <span className="text-sm text-green-700">{state.ok}</span>}
        {state.error && <span className="text-sm text-red-700">{state.error}</span>}
      </div>
    </form>
  );
}
