import { describe, expect, it } from "vitest";

import { createTheme } from "../output/theme.ts";
import { normalizeHex, renderColorRow, renderSwatch } from "./swatches.ts";

describe("normalizeHex", () => {
  it("accepts six and three digit hex colours, in upper case", () => {
    expect(normalizeHex("#0000ee")).toBe("#0000EE");
    expect(normalizeHex("#abc")).toBe("#AABBCC");
  });

  it("refuses anything else", () => {
    for (const value of ["red", "#12345", "0000ee", "#00ee\u001b", 3, null])
      expect(normalizeHex(value)).toBeUndefined();
  });
});

describe("renderSwatch", () => {
  it("draws a truecolor block", () => {
    expect(renderSwatch("#0000EE", 3)).toBe("\u001b[38;2;0;0;238m██\u001b[0m");
  });

  it("draws the nearest 256-colour block", () => {
    expect(renderSwatch("#0000EE", 2)).toBe("\u001b[38;5;21m██\u001b[0m");
  });

  it("draws nothing with 16 colours or none, where a block would mislead", () => {
    expect(renderSwatch("#0000EE", 1)).toBe("");
    expect(renderSwatch("#0000EE", 0)).toBe("");
  });
});

describe("renderColorRow", () => {
  it("is the swatch, the hex and the name", () => {
    expect(
      renderColorRow({ hex: "#0000EE", name: "Blue" }, 3, createTheme(3))
    ).toBe("\u001b[38;2;0;0;238m██\u001b[0m #0000EE  \u001b[2mBlue\u001b[0m");
  });

  it("is the hex and the name without colour", () => {
    expect(
      renderColorRow({ hex: "#0000EE", name: "Blue" }, 0, createTheme(0))
    ).toBe("#0000EE  Blue");
  });
});
