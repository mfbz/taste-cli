import { describe, expect, it } from "vitest";

import { loadFixtures } from "../api/fixtures.ts";
import { BRAND_SEARCH_RESULTS } from "../api/schemas.ts";
import { createTheme } from "../output/theme.ts";
import { renderCards } from "./cards.ts";

const fixtures = loadFixtures();
const deep = BRAND_SEARCH_RESULTS.parse(fixtures["search-deep"]?.data.results);
const fast = BRAND_SEARCH_RESULTS.parse(fixtures["search-fast"]?.data.results);
const plainText = { theme: createTheme(0), colorLevel: 0, width: 100 } as const;
const ANSI = /\u001b\[/;

describe("renderCards", () => {
  it("numbers each card with its brand, match, address, reason and primary hexes", () => {
    const text = renderCards(deep.results, { ...plainText, width: 400 });
    expect(text).toMatch(/^ *1 {2}driver {2}strong/m);
    expect(text).toContain("https://driver.ai/product");
    expect(text).toContain(deep.results[0]?.reason ?? "missing");
    for (const hex of ["#FFFFFF", "#000000", "#737373", "#908174"])
      expect(text).toContain(hex);
    expect(text).toContain("taste extract <url>");
    expect(text).not.toMatch(ANSI);
  });

  it("shows the identity without a reason, and no palette line without a palette", () => {
    const card = fast.results[0];
    expect(card?.reason).toBeNull();
    expect(card?.palette).toBeNull();
    const text = renderCards(card ? [card] : [], { ...plainText, width: 1000 });
    expect(text).toContain(card?.identity_paragraph.slice(0, 60) ?? "missing");
    expect(text).not.toMatch(/#[0-9A-F]{6}/);
  });

  it("cuts each line to a terminal's width, and nothing for a pipe", () => {
    const card = deep.results.slice(0, 1);
    const cut = renderCards(card, { ...plainText, width: 60 });
    for (const line of cut.split("\n"))
      expect([...line].length).toBeLessThanOrEqual(60);
    const whole = renderCards(card, { theme: createTheme(0), colorLevel: 0 });
    expect(whole).toContain(card[0]?.reason ?? "missing");
    expect(whole).not.toContain("…");
  });

  it("falls back to the host without a name, and says when there are none", () => {
    const text = renderCards(
      [{ url: "https://example.com/pricing", identity_paragraph: "Calm." }],
      plainText
    );
    expect(text).toMatch(/^ *1 {2}example\.com/m);
    expect(renderCards([], plainText)).toBe("No brands found.");
  });

  it("draws swatches only in a colour terminal, and only for real hexes", () => {
    const text = renderCards(
      [
        {
          url: "https://example.com/",
          identity_paragraph: "Calm.",
          palette: { primary: ["#0D75FF", "\u001b[31mred", 7] },
        },
      ],
      { theme: createTheme(3), colorLevel: 3, width: 80 }
    );
    expect(text).toContain("\u001b[38;2;13;117;255m██");
    expect(text).toContain("#0D75FF");
    expect(text).not.toContain("\u001b[31m");
  });

  it("strips control characters from every server string", () => {
    const text = renderCards(
      [
        {
          url: "https://example.com/\u001b]0;x\u0007",
          brand_name: "Ex\u0007am\u009bple",
          identity_paragraph: "Calm\r\n.",
          match: "strong",
          tags: ["a\u0007b"],
        },
      ],
      plainText
    );
    expect(text).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/);
    expect(text).toContain("Example");
  });
});
