import { describe, expect, it } from "vitest";
import { buildDigest } from "@/lib/digest";
import { matchProjects, shortlistMessage } from "@/lib/match";
import { acceptedPatch, figureChanges } from "@/lib/projects";
import type { Project, Requirement } from "@/lib/types";

const NOW = new Date("2026-11-04T06:00:00Z");

const project = (over: Partial<Project>): Project => ({
  id: over.name ?? "p",
  name: "P",
  developer: "Dev",
  micro_market: "Greater Noida West",
  sector: null,
  rera_number: null,
  configurations: "2BHK, 3BHK",
  price_min_inr: 4_500_000,
  price_max_inr: 6_000_000,
  plc: null,
  payment_plan: "CLP",
  possession: "Dec 2027",
  offers: null,
  offer_valid_until: null,
  amenities: null,
  availability: "available",
  developer_contact_name: "Amit",
  developer_contact_phone: null,
  last_confirmed_at: "2026-11-01T00:00:00Z",
  confirmed_by: null,
  notes: null,
  created_at: "",
  updated_at: "",
  ...over,
});

const want: Requirement = {
  budget_min_inr: null,
  budget_max_inr: 5_500_000,
  micro_market: "Greater Noida West",
  property_type: "2BHK",
  purpose: "end_use",
  timeline_months: 2,
  agreed_site_visit: false,
};

describe("Match Finder", () => {
  const book = [
    project({ name: "Fits" }),
    project({ name: "Ready", possession: "Ready to move" }),
    project({ name: "Stretch", price_min_inr: 5_900_000, price_max_inr: 7_000_000 }),
    project({ name: "TooDear", price_min_inr: 9_000_000, price_max_inr: 12_000_000 }),
    project({ name: "Elsewhere", micro_market: "Yamuna Expressway" }),
    project({ name: "NoTwo", configurations: "3BHK, 4BHK" }),
    project({ name: "Gone", availability: "sold_out" }),
    project({ name: "Stale", last_confirmed_at: "2026-08-01T00:00:00Z" }),
    project({ name: "Nearby", micro_market: "Greater Noida" }),
  ];

  it("ranks fits, puts misses aside, drops what cannot work", () => {
    const { matches, nearMisses } = matchProjects(want, book, NOW);
    expect(matches.map((m) => m.project.name)).toEqual(["Ready", "Fits", "Stale", "Nearby"]);
    // Near misses ranked by how much else fits.
    expect(nearMisses.map((m) => [m.project.name, m.miss])).toEqual([
      ["NoTwo", "No 2BHK listed"],
      ["Stretch", "Slightly above budget"],
      ["Elsewhere", "Different location: Yamuna Expressway"],
    ]);
    expect(matches.find((m) => m.project.name === "Stale")?.freshness).toBe("red");
  });

  it("matches a sector exactly and the rest of the city as nearby", () => {
    const r = { ...want, micro_market: "Noida, Sector 150" };
    const { matches } = matchProjects(r, [project({ name: "S150", micro_market: "Noida", sector: "Sector 150" }), project({ name: "S75", micro_market: "Noida", sector: "Sector 75" })], NOW);
    expect(matches.map((m) => [m.project.name, m.reasons[1]])).toEqual([
      ["S150", "In Sector 150"],
      ["S75", "Nearby: Noida"],
    ]);
  });

  it("drafts a shortlist with the date beside each price", () => {
    const { matches } = matchProjects(want, [project({ name: "Fits" })], NOW);
    expect(shortlistMessage("Ravi Kumar", matches)).toMatch(/Hi Ravi[\s\S]*\*Fits\* \(Dev\)[\s\S]*₹45 L – ₹60 L \(as of 1 Nov\)/);
  });
});

describe("Freshness Check", () => {
  it("shows only what changed and writes only what Chetan accepts", () => {
    const current = project({ name: "X", offers: "Free parking" });
    const reply = { price_min_inr: 4_800_000, price_max_inr: 6_200_000, payment_plan: "CLP", offers: "No offer", offer_valid_until: null, availability: "limited" as const, possession: "Dec 2027", plc: null };
    const changes = figureChanges(current, reply);
    expect(changes.map((c) => [c.key, c.before, c.after])).toEqual([
      ["price", "₹45 L – ₹60 L", "₹48 L – ₹62 L"],
      ["offers", "Free parking", "No offer"],
      ["availability", "Available", "Limited units"],
    ]);
    const patch = acceptedPatch(reply, ["price", "availability"], "Amit", NOW);
    expect(patch).toEqual({
      last_confirmed_at: NOW.toISOString(),
      confirmed_by: "Amit",
      price_min_inr: 4_800_000,
      price_max_inr: 6_200_000,
      availability: "limited",
    });
  });

  it("the morning digest lists projects to re-confirm and offers ending", () => {
    const d = buildDigest([], NOW, [
      project({ name: "Old", last_confirmed_at: null }),
      project({ name: "Diwali", offers: "No GST", offer_valid_until: "2026-11-05" }),
    ])!;
    expect(d).toMatch(/Offers ending: Diwali \(5 Nov\)/);
    expect(d).toMatch(/Projects to re-confirm: Old\./);
  });
});
