import { describe, expect, it } from "vitest";

import { PALETTE } from "../../src/output/theme.ts";
import { readRepoFile } from "./repo.ts";

const design = readRepoFile("DESIGN.md");

describe("DESIGN.md", () => {
  it.each(Object.entries(PALETTE))(
    "names %s with the same hex value the code uses (%s)",
    (name, hex) => {
      expect(design).toContain(name);
      expect(design).toContain(hex);
    }
  );

  it("names no brand hex value the code doesn't use", () => {
    const hexes = [...design.matchAll(/#[0-9A-F]{6}\b/g)].map((m) => m[0]);
    const known = new Set<string>(Object.values(PALETTE));
    expect(hexes.filter((hex) => !known.has(hex))).toEqual([]);
  });
});
