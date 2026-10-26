"use server";

import { revalidatePath } from "next/cache";
import { catcherConfig } from "@/lib/catcher-config";
import { LeadError } from "@/lib/leads";
import { getStore } from "@/lib/store";
import { bookVisit, formatSlot, verifyBookingToken } from "@/lib/visits";

export interface BookState {
  error?: string;
  confirmed?: string;
}

export async function bookAction(token: string, _: BookState, fd: FormData): Promise<BookState> {
  const secret = process.env.BOOKING_SECRET;
  const leadId = secret ? verifyBookingToken(token, secret) : null;
  if (!leadId) return { error: "This booking link is not valid." };
  const slotId = fd.get("slot");
  if (typeof slotId !== "string" || !slotId) return { error: "Please pick a time." };
  try {
    const { slot, rescheduled } = await bookVisit(getStore(), catcherConfig(), leadId, {
      slotId,
      projectInterest: (fd.get("project") as string) || null,
      pickup: (fd.get("pickup") as string) || null,
      people: Number(fd.get("people")) || 1,
    });
    revalidatePath(`/book/${token}`);
    return { confirmed: `${rescheduled ? "Moved to" : "Booked for"} ${formatSlot(slot)}, ${slot.area}.` };
  } catch (e) {
    if (e instanceof LeadError) return { error: e.message };
    throw e;
  }
}
