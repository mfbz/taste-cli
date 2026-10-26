import { describe, expect, it } from "vitest";

import { loadFixtures } from "../api/fixtures.ts";
import { SUBMISSION_RESULT } from "../api/schemas.ts";
import type { SubmissionResult } from "../api/schemas.ts";
import { createTheme } from "../output/theme.ts";
import { brandName, renderBrandSummary } from "./brand-summary.ts";

const fixtures = loadFixtures();
const ANSI = /\u001b\[/;

function result(recipe: string): SubmissionResult {
  return SUBMISSION_RESULT.parse(fixtures[recipe]?.data.result);
}

function primaryHexes(recipe: string): string[] {
  const colors = result(recipe).result?.design_system?.colors as {
    baseline: { hex: string }[];
  };
  return colors.baseline.map((c) => c.hex.toUpperCase());
}

const plain = { theme: createTheme(0), colorLevel: 0 as const, width: 80 };

describe("renderBrandSummary", () => {
  it.each(["extract-full", "extract-full-2"])(
    "names the brand and every primary colour of %s",
    (recipe) => {
      const text = renderBrandSummary(result(recipe), plain);
      expect(text).toContain(brandName(result(recipe)));
      const hexes = primaryHexes(recipe);
      expect(hexes.length).toBeGreaterThan(0);
      for (const hex of hexes) expect(text).toContain(hex);
      expect(text).not.toMatch(ANSI);
    }
  );

  it("shows the style, the tone, each type family once and the id, within the width", () => {
    const text = renderBrandSummary(result("extract-full"), plain);
    expect(text).toContain("Brutalism");
    expect(text).toContain("Intellectual, Mission-driven, Technical");
    expect(text).toContain(
      "type   Matter TRIAL, Azeret Semimono, Matter, Neue Montreal"
    );
    expect(text).toContain(
      "taste wait 00000000-0000-4000-8000-000000000100 --format json"
    );
    const narrow = renderBrandSummary(result("extract-full"), {
      ...plain,
      width: 40,
    });
    for (const line of narrow.split("\n"))
      expect(line.length).toBeLessThanOrEqual(40);
  });

  it("summarises a brand kit from its own shape", () => {
    const text = renderBrandSummary(result("kit"), plain);
    expect(text).toContain("ACME");
    expect(text).toContain("#D7263D");
    expect(text).toContain("Helvetica Neue");
  });

  it("falls back to the address for a selective result with no profile", () => {
    const selective = result("extract-selective");
    expect(brandName(selective)).toBe("linear.app");
    expect(renderBrandSummary(selective, plain)).not.toContain("style ");
  });

  it("cleans control characters out of the server's text", () => {
    const hostile = SUBMISSION_RESULT.parse({
      submission_id: "sub-1",
      source_url: "https://example.com/",
      result: {
        design_system: {
          profile: { brand_name: "Evil\u001b]0;pwned\u0007Co", copy_tone: [] },
          colors: { baseline: [{ name: "Red\u001b[2J", hex: "#ff0000" }] },
        },
      },
    });
    const text = renderBrandSummary(hostile, plain);
    expect(text).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f]/);
    expect(text).toContain("Evil]0;pwnedCo");
  });
});
