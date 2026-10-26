"use client";

import { useActionState } from "react";
import { bookAction, type BookState } from "./actions";

export interface SlotOption {
  id: string;
  day: string;
  time: string;
  area: string;
}

export function BookingForm({ token, slots, pickups }: { token: string; slots: SlotOption[]; pickups: readonly string[] }) {
  const [state, action, pending] = useActionState<BookState, FormData>(bookAction.bind(null, token), {});

  if (state.confirmed) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-green-900">
        <p className="font-medium">{state.confirmed}</p>
        <p className="mt-1 text-sm">You will get a confirmation on WhatsApp. To change the time, open this link again.</p>
      </div>
    );
  }

  const days = [...new Set(slots.map((s) => s.day))];
  return (
    <form action={action} className="space-y-5">
      <fieldset className="space-y-3">
        <legend className="label">Pick a time</legend>
        {days.map((day) => (
          <div key={day}>
            <div className="mb-1 text-sm font-medium">{day}</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {slots
                .filter((s) => s.day === day)
                .map((s) => (
                  <label
                    key={s.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm has-[:checked]:border-stone-900 has-[:checked]:ring-1 has-[:checked]:ring-stone-900"
                  >
                    <input type="radio" name="slot" value={s.id} required />
                    <span>
                      {s.time} <span className="text-stone-500">· {s.area}</span>
                    </span>
                  </label>
                ))}
            </div>
          </div>
        ))}
      </fieldset>
      <div>
        <label className="label">Project or area you want to see (optional)</label>
        <input name="project" className="input" maxLength={200} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Need a pickup?</label>
          <select name="pickup" className="input" defaultValue="">
            <option value="">No, I&apos;ll come directly</option>
            {pickups.map((p) => (
              <option key={p} value={p}>
                From {p}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">How many people</label>
          <input name="people" type="number" min={1} max={20} defaultValue={2} className="input" />
        </div>
      </div>
      {state.error && <p className="text-sm text-red-700">{state.error}</p>}
      <button className="btn w-full py-3" disabled={pending}>
        {pending ? "Booking…" : "Confirm site visit"}
      </button>
    </form>
  );
}
