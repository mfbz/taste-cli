import { describe, expect, it } from "vitest";

import { createTheme } from "./theme.ts";

const STYLES = ["bold", "success", "warning", "error", "dim", "faint"] as const;

describe("createTheme", () => {
  it("leaves text untouched without colour", () => {
    const theme = createTheme(0);
    for (const style of STYLES) expect(theme[style]("x")).toBe("x");
  });

  it("styles at every colour level and always resets after", () => {
    expect(createTheme(3).error("x")).toContain("38;2;255;61;0");
    expect(createTheme(2).dim("x")).toContain("38;5;245m");
    expect(createTheme(1).bold("x")).toBe("\u001b[1mx\u001b[0m");
    for (const level of [1, 2, 3] as const) {
      const theme = createTheme(level);
      // success and warning keep the terminal's own foreground, so light themes stay readable.
      expect(theme.success("x")).toBe("x");
      for (const style of ["bold", "error", "dim", "faint"] as const)
        expect(theme[style]("x")).toMatch(/^\u001b\[.+x\u001b\[0m$/);
    }
  });
});
