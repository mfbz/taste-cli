import { describe, expect, it } from "vitest";

import { createTheme } from "../output/theme.ts";
import { normalizeHex, renderColorRow, renderSwatch } from "./swatches.ts";

describe("swatches", () => {
  it("accepts only six and three digit hex colours, in upper case", () => {
    expect(normalizeHex("#abc")).toBe("#AABBCC");
    for (const value of ["red", "#12345", "0000ee", "#00ee\u001b", 3, null])
      expect(normalizeHex(value)).toBeUndefined();
  });

  it("draws a truecolor or 256-colour block, and none where a block would mislead", () => {
    expect(renderSwatch("#0000EE", 3)).toBe("\u001b[38;2;0;0;238m██\u001b[0m");
    expect(renderSwatch("#0000EE", 2)).toBe("\u001b[38;5;21m██\u001b[0m");
    expect(renderSwatch("#0000EE", 1)).toBe("");
    expect(
      renderColorRow({ hex: "#0000EE", name: "Blue" }, 0, createTheme(0))
    ).toBe("#0000EE  Blue");
  });
});
