import { describe, expect, it } from "vitest";
import { parseBudget, parseMicroMarket, parsePropertyType, parsePurpose, parseTimelineMonths } from "@/lib/parse";

describe("parseBudget", () => {
  it("reads lakh and crore", () => {
    expect(parseBudget("55 lakh")).toEqual({ min: null, max: 5_500_000 });
    expect(parseBudget("under ₹55L")).toEqual({ min: null, max: 5_500_000 });
    expect(parseBudget("1.2 cr")).toEqual({ min: null, max: 12_000_000 });
    expect(parseBudget("50-60 lakh")).toEqual({ min: 5_000_000, max: 6_000_000 });
    expect(parseBudget("80 L – 1.2 Cr")).toEqual({ min: 8_000_000, max: 12_000_000 });
    expect(parseBudget("1 cr+")).toEqual({ min: 10_000_000, max: null });
    expect(parseBudget("₹75,00,000")).toEqual({ min: null, max: 7_500_000 });
  });
  it("returns null for no number", () => expect(parseBudget("flexible")).toBeNull());
});

describe("parseTimelineMonths", () => {
  it.each([
    ["within 2 months", 2],
    ["immediately", 1],
    ["6 mahine", 6],
    ["1 year", 12],
    ["3 weeks", 1],
    ["just exploring", 12],
    ["dunno", null],
  ])("%s -> %s", (t, m) => expect(parseTimelineMonths(t)).toBe(m));
});

describe("other answers", () => {
  it("purpose", () => {
    expect(parsePurpose("for investment")).toBe("investment");
    expect(parsePurpose("End use")).toBe("end_use");
    expect(parsePurpose("rental income")).toBe("rental");
  });
  it("micro-market", () => {
    expect(parseMicroMarket("near Jewar airport")).toBe("Yamuna Expressway");
    expect(parseMicroMarket("Noida Extension")).toBe("Greater Noida West");
    expect(parseMicroMarket("greater noida")).toBe("Greater Noida");
    expect(parseMicroMarket("sector 150 noida")).toBe("Noida, Sector 150");
  });
  it("property type", () => {
    expect(parsePropertyType("2 bhk")).toBe("2BHK");
    expect(parsePropertyType("residential plot")).toBe("Plot");
  });
});
