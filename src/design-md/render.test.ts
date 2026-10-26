import { describe, expect, it } from "vitest";

import { fixtures, recorded } from "../job-seams.ts";
import { renderDesignMd } from "./render.ts";

const META = {
  // Pinned so the goldens don't change when a release stamps the version.
  generator: "taste-cli 0.0.1",
  extractedAt: "2026-10-26",
};
// Golden name to recorded fixture.
const GOLDENS = {
  stripe: "extract-full-2",
  tastelabs: "extract-full",
  kit: "kit",
};

function frontMatter(md: string): string {
  return md.split("\n---\n")[0] ?? "";
}

describe("renderDesignMd", () => {
  for (const [golden, recipe] of Object.entries(GOLDENS)) {
    it(`renders ${golden} as its golden file, every hex from the extraction`, async () => {
      const md = renderDesignMd(recorded(recipe), META);
      await expect(md).toMatchFileSnapshot(`./__golden__/${golden}.DESIGN.md`);
      const json = JSON.stringify(fixtures[recipe]);
      const hexes = frontMatter(md).match(/#[0-9a-f]{3,8}\b/gi) ?? [];
      expect(hexes.length).toBeGreaterThan(0);
      for (const hex of hexes) expect(json).toContain(hex);
    });
  }

  it("writes no colors key when the extraction has no colours", () => {
    const result = recorded("extract-full-2");
    const design = { ...result.result?.design_system };
    delete design.colors;
    const md = renderDesignMd(
      { ...result, result: { ...result.result, design_system: design } },
      META
    );
    expect(frontMatter(md)).not.toMatch(/^colors:/m);
  });
});
