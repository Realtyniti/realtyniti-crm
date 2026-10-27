import Link from "next/link";
import { toggleSlotAction, visitStatusAction } from "@/app/actions";
import { getStore } from "@/lib/store";
import { formatSlotTime, IST, slotsWithBookings } from "@/lib/visits";
import { NewSlotsForm } from "./forms";

export default async function VisitsPage() {
  const store = getStore();
  // Include today's earlier slots so finished visits can be marked done.
  const startOfToday = new Date(Date.now() - 24 * 3600_000);
  const slots = await slotsWithBookings(store, startOfToday);
  const leads = new Map((await store.listLeads()).map((l) => [l.id, l]));
  const areas = [...new Set(["Yamuna Expressway", "Greater Noida West", "Noida", ...slots.map((s) => s.area)])];
  const days = [...new Set(slots.map((s) => new Date(s.starts_at).toLocaleDateString("en-IN", { timeZone: IST, weekday: "long", day: "numeric", month: "short" })))];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Site visits</h1>
      <p className="max-w-2xl text-sm text-muted">
        Buyers can only pick from slots you open here, at least 2 hours ahead. Hot leads get their booking link
        automatically; you can also copy a link from any lead card.
      </p>
      <NewSlotsForm areas={areas} />

      {days.length === 0 && <p className="panel text-sm text-muted">No slots open yet.</p>}
      {days.map((day) => (
        <section key={day} className="space-y-2">
          <h2 className="font-medium">{day}</h2>
          {slots
            .filter((s) => new Date(s.starts_at).toLocaleDateString("en-IN", { timeZone: IST, weekday: "long", day: "numeric", month: "short" }) === day)
            .map((s) => (
              <div key={s.id} className={`panel flex flex-wrap items-start gap-4 ${s.is_open ? "" : "opacity-60"}`}>
                <div className="min-w-48">
                  <div className="font-medium">{formatSlotTime(s)}</div>
                  <div className="text-sm text-muted">{s.area}</div>
                  <div className="text-xs text-muted">
                    {s.booked.length}/{s.capacity} booked{s.is_open ? "" : " · closed"}
                  </div>
                </div>
                <ul className="flex-1 space-y-1 text-sm">
                  {s.booked.map((v) => {
                    const l = leads.get(v.lead_id);
                    return (
                      <li key={v.id} className="flex flex-wrap items-center gap-2">
                        <Link href={`/leads/${v.lead_id}`} className="font-medium hover:underline">
                          {l?.name ?? l?.phone ?? "Lead"}
                        </Link>
                        <span className="text-muted">
                          {v.people} ppl{v.pickup ? ` · pickup ${v.pickup}` : ""}
                          {v.project_interest ? ` · ${v.project_interest}` : ""}
                        </span>
                        <form action={visitStatusAction.bind(null, v.id, v.lead_id, "done")}>
                          <button className="text-xs text-green-700 hover:underline">Done</button>
                        </form>
                        <form action={visitStatusAction.bind(null, v.id, v.lead_id, "no_show")}>
                          <button className="text-xs text-amber-700 hover:underline">No-show</button>
                        </form>
                        <form action={visitStatusAction.bind(null, v.id, v.lead_id, "cancelled")}>
                          <button className="text-xs text-red-700 hover:underline">Cancel</button>
                        </form>
                      </li>
                    );
                  })}
                </ul>
                <form action={toggleSlotAction.bind(null, s.id, !s.is_open)}>
                  <button className="btn-ghost text-xs">{s.is_open ? "Close slot" : "Reopen"}</button>
                </form>
              </div>
            ))}
        </section>
      ))}
    </div>
  );
}
