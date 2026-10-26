import { getStore } from "@/lib/store";
import { bookableSlots, formatSlot, formatSlotTime, IST, PICKUP_POINTS, verifyBookingToken } from "@/lib/visits";
import { BookingForm } from "./form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Book a site visit · Realtyniti", robots: { index: false } };

export default async function BookPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const secret = process.env.BOOKING_SECRET;
  const leadId = secret ? verifyBookingToken(token, secret) : null;
  const store = getStore();
  const lead = leadId ? await store.getLead(leadId) : null;

  if (!lead) {
    return <Shell><p className="text-stone-700">This booking link is not valid. Please message Realtyniti on WhatsApp for a new one.</p></Shell>;
  }

  const [slots, current] = await Promise.all([bookableSlots(store), store.listVisits({ leadId: lead.id, status: "booked" })]);
  const currentSlot = current[0] ? await store.getSlot(current[0].slot_id) : null;
  const options = slots.map((s) => ({
    id: s.id,
    day: new Date(s.starts_at).toLocaleDateString("en-IN", { timeZone: IST, weekday: "long", day: "numeric", month: "long" }),
    time: formatSlotTime(s),
    area: s.area,
  }));

  return (
    <Shell>
      <h1 className="text-xl font-semibold">Hi {lead.name?.split(" ")[0] ?? "there"}, book your site visit</h1>
      <p className="text-sm text-stone-600">Chetan will meet you at the site. Pick any time below.</p>
      {currentSlot && (
        <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
          You are booked for <strong>{formatSlot(currentSlot)}, {currentSlot.area}</strong>. Picking a new time below moves it.
        </p>
      )}
      {options.length ? (
        <BookingForm token={token} slots={options} pickups={PICKUP_POINTS} />
      ) : (
        <p className="text-stone-700">No visit times are open right now. Chetan will message you with options shortly.</p>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-xl space-y-4 px-4 py-6">
      <div className="text-sm font-semibold tracking-tight text-stone-500">Realtyniti</div>
      {children}
    </main>
  );
}
