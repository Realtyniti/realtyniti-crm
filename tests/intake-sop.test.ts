import { describe, expect, it } from "vitest";
import { classify, followUpGapDays, nextQuestion } from "@/lib/intake-sop";
import type { Requirement } from "@/lib/types";

const base: Requirement = {
  budget_min_inr: null,
  budget_max_inr: 5_500_000,
  micro_market: "Greater Noida West",
  property_type: "2BHK",
  purpose: "end_use",
  timeline_months: 2,
  agreed_site_visit: true,
};

describe("classify", () => {
  it("hot: budget, location, deciding soon, agreed to visit", () => {
    expect(classify(base).temperature).toBe("hot");
  });
  it("warm without a visit yet", () => {
    expect(classify({ ...base, agreed_site_visit: false }).temperature).toBe("warm");
  });
  it("warm when deciding in 6 months", () => {
    expect(classify({ ...base, timeline_months: 6, agreed_site_visit: false }).temperature).toBe("warm");
  });
  it("cold when only exploring", () => {
    expect(classify({ ...base, timeline_months: 12, agreed_site_visit: false }).temperature).toBe("cold");
  });
  it("cold without location", () => {
    expect(classify({ ...base, micro_market: null }).temperature).toBe("cold");
  });
});

describe("cadence and next question", () => {
  it("tighter rhythm for buyers deciding soon", () => {
    expect(followUpGapDays({ timeline_months: 2 })).toBeLessThan(followUpGapDays({ timeline_months: 12 }));
  });
  it("asks budget first, then in Chetan's order", () => {
    expect(nextQuestion({ ...base, budget_max_inr: null })?.key).toBe("budget");
    expect(nextQuestion({ ...base, purpose: null, timeline_months: null })?.key).toBe("purpose");
    expect(nextQuestion(base)).toBeNull();
  });
});
