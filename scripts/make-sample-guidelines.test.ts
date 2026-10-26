import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildSampleGuidelines, OUTPUT } from "./make-sample-guidelines.ts";

const pdf = new TextDecoder().decode(buildSampleGuidelines());

describe("the sample brand guidelines PDF", () => {
  it("is a PDF of four pages for Acme", () => {
    expect(pdf.startsWith("%PDF-")).toBe(true);
    expect(pdf.match(/\/Type \/Page\b(?!s)/g)).toHaveLength(4);
    expect(pdf).toContain("/Count 4");
    expect(pdf).toContain("(ACME)");
    expect(pdf).toContain("Acme Red");
  });

  it("has an xref whose offsets point at their objects", () => {
    const start = Number(/startxref\n(\d+)/.exec(pdf)?.[1]);
    expect(pdf.slice(start, start + 4)).toBe("xref");
    const offsets = [...pdf.slice(start).matchAll(/^(\d{10}) 00000 n $/gm)].map(
      (m) => Number(m[1])
    );
    expect(offsets.length).toBeGreaterThan(8);
    offsets.forEach((offset, i) =>
      expect(pdf.slice(offset).startsWith(`${i + 1} 0 obj`)).toBe(true)
    );
  });

  it("names no person or machine in its metadata", () => {
    expect(pdf).toContain("/Producer (taste-cli)");
    expect(pdf).not.toMatch(/\/Author|\/Creator|\/CreationDate|\/ModDate/);
  });

  it("follows the copy rules: no em dashes, no exclamation marks", () => {
    const strings = [...pdf.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map(
      (m) => m[1]
    );
    expect(strings.length).toBeGreaterThan(20);
    for (const s of strings) {
      expect(s).not.toContain("—");
      expect(s).not.toContain("!");
    }
  });

  it("stays small, and the committed file is exactly what the script builds", () => {
    const committed = readFileSync(OUTPUT);
    expect(committed.length).toBeLessThan(50 * 1024);
    expect(new TextDecoder().decode(committed)).toBe(pdf);
  });
});
