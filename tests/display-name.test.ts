import { describe, expect, it } from "vitest";
import { displayName } from "@/lib/lead-display";

describe("displayName", () => {
  it("keeps ordinary names as they are", () => {
    expect(displayName("Akshay Sharma")).toEqual({ name: "Akshay Sharma", raw: null, check: false });
    expect(displayName("राजेन्द्र गुप्ता").name).toBe("राजेन्द्र गुप्ता");
  });
  it("fixes the case of all-lowercase and ALL CAPS words without flagging them", () => {
    expect(displayName("zeba islam")).toEqual({ name: "Zeba Islam", raw: null, check: false });
    expect(displayName("PRADEEP KUMAR SRIVASTAVA").name).toBe("Pradeep Kumar Srivastava");
    expect(displayName("Dharmendra kanaujiya").name).toBe("Dharmendra Kanaujiya");
  });
  it("drops a repeated word", () => {
    expect(displayName("Harshit harshit").name).toBe("Harshit");
  });
  it("tidies Instagram handles and flags them for a check", () => {
    expect(displayName("nikhil7060")).toEqual({ name: "Nikhil", raw: "nikhil7060", check: true });
    expect(displayName("prince_jatav_").name).toBe("Prince Jatav");
    expect(displayName("salman king  3373").name).toBe("Salman King");
  });
  it("reads decorative Unicode letters", () => {
    expect(displayName("Ⓐⓩⓘⓜ ⓜⓐⓛⓘⓚ")).toMatchObject({ name: "Azim Malik", check: true });
    expect(displayName("◤𝐅 𝐈 𝐑 𝐎 𝐉◥◣")).toMatchObject({ name: "Firoj", check: true });
  });
  it("handles missing names", () => {
    expect(displayName(null)).toEqual({ name: "Unnamed lead", raw: null, check: true });
    expect(displayName("  ")).toMatchObject({ name: "Unnamed lead" });
  });
});
