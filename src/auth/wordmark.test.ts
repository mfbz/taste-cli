import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { WORDMARK } from "./wordmark.ts";

describe("WORDMARK", () => {
  it("is byte for byte the wordmark in assets/brand", () => {
    const asset = readFileSync(
      new URL("../../assets/brand/taste-wordmark.svg", import.meta.url),
      "utf8"
    );
    expect(WORDMARK).toBe(asset);
  });

  it("takes its colour from the page", () => {
    expect(WORDMARK).toContain('fill="currentColor"');
    expect(WORDMARK).not.toMatch(/fill="#/);
  });
});
