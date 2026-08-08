import { describe, expect, it } from "vitest";
import { parsePageSelection } from "@/lib/pdf-ocr/pages";

function canonical(input: string): string {
  const result = parsePageSelection(input);
  if (!result.ok) throw new Error(`expected "${input}" to parse, got: ${result.error}`);
  return result.canonical;
}

describe("parsePageSelection", () => {
  it("treats a blank selection as every page", () => {
    const result = parsePageSelection("   ");
    expect(result).toEqual({ ok: true, ranges: [], canonical: "", openEnded: false });
  });

  it("parses single pages, ranges and an open-ended tail", () => {
    const result = parsePageSelection("1-3, 7, 10-");
    expect(result.ok && result.canonical).toBe("1-3,7,10-");
    expect(result.ok && result.openEnded).toBe(true);
    expect(result.ok && result.ranges).toEqual([
      { start: 1, end: 3 },
      { start: 7, end: 7 },
      { start: 10, end: null },
    ]);
  });

  it("sorts and coalesces overlapping and adjacent ranges", () => {
    expect(canonical("3,1-2,2")).toBe("1-3");
    expect(canonical("5-6,1-4")).toBe("1-6");
    expect(canonical("1-10,3-4")).toBe("1-10");
    expect(canonical("1,3,5")).toBe("1,3,5");
  });

  it("lets an open-ended range swallow everything after it", () => {
    expect(canonical("2-,5,9-12")).toBe("2-");
    expect(canonical("8-,1")).toBe("1,8-");
  });

  it("ignores empty segments from trailing or doubled commas", () => {
    expect(canonical("1,,2,")).toBe("1-2");
  });

  it("rejects input that is not a page selection", () => {
    for (const bad of ["abc", "1-abc", "-4", "1;2", "1.5"]) {
      expect(parsePageSelection(bad).ok, bad).toBe(false);
    }
  });

  it("rejects page zero, since pages are 1-based", () => {
    expect(parsePageSelection("0").ok).toBe(false);
    expect(parsePageSelection("0-3").ok).toBe(false);
  });

  it("rejects a range that ends before it starts", () => {
    const result = parsePageSelection("9-2");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("ends before it starts");
  });
});
