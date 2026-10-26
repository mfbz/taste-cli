import { describe, expect, it } from "vitest";

import { PALETTE, createTheme } from "./theme.ts";

const STYLES = [
  "accent",
  "success",
  "warning",
  "error",
  "dim",
  "bold",
] as const;

describe("createTheme", () => {
  it("leaves text untouched without colour", () => {
    const theme = createTheme(0);
    for (const style of STYLES) expect(theme[style]("x")).toBe("x");
  });

  it("uses Taste's observed colours in truecolor terminals", () => {
    const theme = createTheme(3);
    expect(theme.accent("x")).toContain("38;2;255;61;0");
    expect(theme.success("x")).toContain("38;2;61;220;132");
    expect(theme.warning("x")).toContain("38;2;242;240;74");
  });

  it("uses the nearest 256-colour code where truecolor isn't available", () => {
    expect(createTheme(2).accent("x")).toMatch(/\u001b\[38;5;\d+m/);
  });

  it("falls back to the basic colours that mean the same thing", () => {
    const theme = createTheme(1);
    expect(theme.accent("x")).toContain("\u001b[31m");
    expect(theme.error("x")).toContain("\u001b[31m");
    expect(theme.success("x")).toContain("\u001b[32m");
    expect(theme.warning("x")).toContain("\u001b[33m");
  });

  it("always resets after styling, so colour never leaks into the next text", () => {
    for (const level of [1, 2, 3] as const) {
      const theme = createTheme(level);
      for (const style of STYLES)
        expect(theme[style]("x")).toMatch(/x\u001b\[0m$/);
    }
  });

  it("names the six colours observed on tastelabs.com (placeholders until the brand pass)", () => {
    expect(PALETTE).toEqual({
      signal: "#FF3D00",
      acid: "#F2F04A",
      electric: "#1E7BFF",
      success: "#3DDC84",
      paper: "#F3F3EF",
      field: "#1B1B1B",
    });
  });
});
