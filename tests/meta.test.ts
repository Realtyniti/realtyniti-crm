import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { leadgenChanges, metaLeadToInput, metaPageFor, verifyMetaSignature } from "@/lib/intake/meta";

describe("Meta intake", () => {
  it("verifies the webhook signature", () => {
    const body = '{"entry":[]}';
    const sig = "sha256=" + createHmac("sha256", "secret").update(body).digest("hex");
    expect(verifyMetaSignature(body, sig, "secret")).toBe(true);
    expect(verifyMetaSignature(body, sig, "other")).toBe(false);
    expect(verifyMetaSignature(body, null, "secret")).toBe(false);
  });

  it("extracts leadgen ids", () => {
    const body = { entry: [{ changes: [{ field: "leadgen", value: { leadgen_id: "123", form_id: "9" } }, { field: "feed" }] }] };
    expect(leadgenChanges(body).map((c) => c.leadgen_id)).toEqual(["123"]);
  });

  it("maps form answers onto the card", () => {
    const input = metaLeadToInput({
      id: "lg_1",
      created_time: "2026-10-26T10:00:00+0000",
      field_data: [
        { name: "full_name", values: ["Ravi Kumar"] },
        { name: "phone_number", values: ["+919876543210"] },
        { name: "what_is_your_budget?", values: ["50-60 lakh"] },
        { name: "preferred_location", values: ["Yamuna Expressway"] },
        { name: "property_type", values: ["3 BHK"] },
        { name: "when_do_you_plan_to_buy?", values: ["within 3 months"] },
      ],
    });
    expect(input).toMatchObject({
      source: "meta",
      phone: "+919876543210",
      name: "Ravi Kumar",
      budget_min_inr: 5_000_000,
      budget_max_inr: 6_000_000,
      micro_market: "Yamuna Expressway",
      property_type: "3BHK",
      timeline_months: 3,
      external_id: "lg_1",
    });
  });

  it("picks the brand and token for each Facebook Page", () => {
    const env = {
      META_PAGE_BRANDS: "111=Tathya Homes, 222=Realtyniti",
      META_PAGE_ACCESS_TOKEN: "default-token",
      META_PAGE_ACCESS_TOKEN_222: "realtyniti-token",
    };
    expect(metaPageFor("111", env)).toEqual({ brand: "Tathya Homes", token: "default-token" });
    expect(metaPageFor("222", env)).toEqual({ brand: "Realtyniti", token: "realtyniti-token" });
    expect(metaPageFor("999", env)).toEqual({ brand: null, token: "default-token" });
    expect(metaPageFor(undefined, {})).toEqual({ brand: null, token: null });
  });
});

describe("appsecret_proof", () => {
  it("is the HMAC-SHA256 of the token keyed by the app secret", async () => {
    const { appsecretProof } = await import("@/lib/intake/meta");
    expect(appsecretProof("tok", "sec")).toBe(createHmac("sha256", "sec").update("tok").digest("hex"));
    expect(appsecretProof("tok", null)).toBeNull();
  });
});
