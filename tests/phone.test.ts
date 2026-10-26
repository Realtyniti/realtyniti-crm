import { describe, expect, it } from "vitest";
import { normalisePhone } from "@/lib/phone";

describe("normalisePhone", () => {
  it.each([
    ["9876543210", "+919876543210"],
    ["+91 98765 43210", "+919876543210"],
    ["091-9876543210", "+919876543210"],
    ["09876543210", "+919876543210"],
    ["919876543210", "+919876543210"],
    ["0091 9876543210", "+919876543210"],
    ["+1 415 555 0100", "+14155550100"],
  ])("%s -> %s", (input, out) => expect(normalisePhone(input)).toBe(out));

  it.each(["", "12345", "5876543210", "abc"])("rejects %j", (input) => expect(normalisePhone(input)).toBeNull());
});
