import { describe, expect, it } from "vitest";

import { PALETTE } from "../../src/output/theme.ts";
import { readRepoFile } from "./repo.ts";

const design = readRepoFile("DESIGN.md");
const rows = design.split("\n").filter((line) => line.startsWith("|"));

describe("DESIGN.md", () => {
  it.each(Object.entries(PALETTE))(
    "has a table row for %s with the hex the code uses (%s)",
    (name, hex) => {
      const row = rows.find((line) => line.includes(`\`${name}\``));
      expect(row, name).toBeDefined();
      expect(row?.toUpperCase()).toContain(hex.toUpperCase());
    }
  );

  it("names no brand hex value the code doesn't use", () => {
    const hexes = [...design.matchAll(/#[0-9A-F]{6}\b/gi)].map((m) =>
      m[0].toUpperCase()
    );
    const known = new Set(
      Object.values(PALETTE).map((hex) => hex.toUpperCase())
    );
    expect(hexes.filter((hex) => !known.has(hex))).toEqual([]);
  });
});
