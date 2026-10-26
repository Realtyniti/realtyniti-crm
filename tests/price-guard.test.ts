import { describe, expect, it } from "vitest";
import { checkMoney } from "@/lib/price-guard";
import { DEFAULT_TEMPLATES, renderForSending, templateProblems, TemplateError } from "@/lib/templates";

describe("checkMoney", () => {
  it.each([
    "What is the price?",
    "kitne ka hai 2bhk?",
    "Any discount available?",
    "Is there an offer this month",
    "payment plan kya hai",
    "₹55 lakh mein milega?",
    "What's the EMI",
    "rate per sq ft?",
  ])("flags %j", (t) => expect(checkMoney(t).mentionsMoney).toBe(true));

  it.each(["Is it ready to move?", "How far from the metro?", "Hi, interested in Noida"])("lets %j through", (t) =>
    expect(checkMoney(t).mentionsMoney).toBe(false),
  );
});

describe("incoming messages", () => {
  it("a buyer stating their budget is not a price question", () => {
    expect(checkMoney("around 55 lakh", { incoming: true }).mentionsMoney).toBe(false);
    expect(checkMoney("₹1.2 cr max", { incoming: true }).mentionsMoney).toBe(false);
  });
  it("asking about price still is", () => {
    expect(checkMoney("55 lakh mein koi offer?", { incoming: true }).mentionsMoney).toBe(true);
    expect(checkMoney("what's the price", { incoming: true }).mentionsMoney).toBe(true);
  });
});

describe("templates", () => {
  it("every default template is free of money talk", () => {
    for (const t of DEFAULT_TEMPLATES) expect(templateProblems(t.body), t.key).toEqual([]);
  });

  const t = { ...DEFAULT_TEMPLATES[0], approved_at: null, updated_at: "" };

  it("refuses to send an unapproved template", () => {
    expect(() => renderForSending(t, { name: "Ravi" })).toThrow(TemplateError);
  });

  it("fills placeholders once approved", () => {
    const text = renderForSending({ ...t, approved_at: "2026-10-26" }, { name: "Ravi" });
    expect(text).toMatch(/^Hi Ravi, this is Chetan/);
  });

  it("blocks money smuggled in through a variable", () => {
    expect(() => renderForSending({ ...t, approved_at: "2026-10-26" }, { name: "Ravi, price is 55 lakh" })).toThrow(
      TemplateError,
    );
  });
});
