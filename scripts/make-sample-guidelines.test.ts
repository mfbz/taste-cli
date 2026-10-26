import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildSampleGuidelines, OUTPUT } from "./make-sample-guidelines.ts";

const pdf = new TextDecoder().decode(buildSampleGuidelines());

describe("the sample brand guidelines PDF", () => {
  it("is the committed file, byte for byte: four small pages for Acme", () => {
    const committed = readFileSync(OUTPUT);
    expect(committed.length).toBeLessThan(50 * 1024);
    expect(new TextDecoder().decode(committed)).toBe(pdf);
    expect(pdf.startsWith("%PDF-")).toBe(true);
    expect(pdf).toContain("/Count 4");
    expect(pdf).toContain("(ACME)");
  });

  it("names no person or machine, and follows the copy rules", () => {
    expect(pdf).not.toMatch(/\/Author|\/Creator|\/CreationDate|\/ModDate/);
    const strings = [...pdf.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map(
      (m) => m[1] ?? ""
    );
    expect(strings.length).toBeGreaterThan(20);
    for (const text of strings) expect(text).not.toMatch(/[—!]/);
  });
});
