import { z } from "zod";
import { parseBudget, parseMicroMarket, parsePropertyType, parsePurpose, parseTimelineMonths } from "../parse";
import type { LeadInput } from "../types";

export const WebsiteFormSchema = z.object({
  name: z.string().trim().max(120).optional(),
  phone: z.string().trim().min(6).max(25),
  email: z.string().trim().email().max(200).optional().or(z.literal("")),
  budget: z.string().max(100).optional(),
  location: z.string().max(200).optional(),
  property_type: z.string().max(100).optional(),
  purpose: z.string().max(100).optional(),
  timeline: z.string().max(100).optional(),
  message: z.string().max(4000).optional(),
  submission_id: z.string().max(200).optional(),
});

export type WebsiteForm = z.infer<typeof WebsiteFormSchema>;

export function websiteFormToLead(form: WebsiteForm): LeadInput {
  const budget = parseBudget(form.budget);
  return {
    source: "website",
    phone: form.phone,
    name: form.name || null,
    email: form.email || null,
    budget_min_inr: budget?.min ?? null,
    budget_max_inr: budget?.max ?? null,
    micro_market: parseMicroMarket(form.location),
    property_type: parsePropertyType(form.property_type),
    purpose: parsePurpose(form.purpose),
    timeline_months: parseTimelineMonths(form.timeline),
    message: form.message || null,
    external_id: form.submission_id || null,
    raw: form,
  };
}
