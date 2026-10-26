import { describe, expect, it } from "vitest";

import { loadFixtures } from "../api/fixtures.ts";
import {
  BRAND_SEARCH_RESULTS,
  SIMILAR_BRANDS_RESULTS,
} from "../api/schemas.ts";
import { createTheme } from "../output/theme.ts";
import { renderCards } from "./cards.ts";

const fixtures = loadFixtures();
const deep = BRAND_SEARCH_RESULTS.parse(fixtures["search-deep"]?.data.results);
const fast = BRAND_SEARCH_RESULTS.parse(fixtures["search-fast"]?.data.results);
const similar = SIMILAR_BRANDS_RESULTS.parse(fixtures["similar"]?.data.results);
const plainText = { theme: createTheme(0), colorLevel: 0, width: 100 } as const;
const ANSI = /\u001b\[/;

describe("renderCards", () => {
  it("numbers each card with its brand, match, address and primary hexes", () => {
    const text = renderCards(deep.results, plainText);
    const first = deep.results[0];
    expect(first?.brand_name).toBe("driver");
    expect(text).toMatch(/^ *1 {2}driver {2}strong/m);
    expect(text).toContain("https://driver.ai/product");
    for (const hex of ["#FFFFFF", "#000000", "#737373", "#908174"])
      expect(text).toContain(hex);
    expect(text).toContain(`${deep.results.length}  `);
    expect(text).not.toMatch(ANSI);
  });

  it("shows the reason when there is one, and the identity otherwise", () => {
    const text = renderCards(deep.results, { ...plainText, width: 400 });
    expect(text).toContain(deep.results[0]?.reason ?? "missing");
    const fastText = renderCards(fast.results, { ...plainText, width: 1000 });
    expect(fast.results[0]?.reason).toBeNull();
    expect(fastText).toContain(
      fast.results[0]?.identity_paragraph.slice(0, 60) ?? "missing"
    );
  });

  it("leaves out the palette line when a card has none", () => {
    const card = fast.results[0];
    expect(card?.palette).toBeNull();
    const text = renderCards(card ? [card] : [], plainText);
    expect(text).not.toMatch(/#[0-9A-F]{6}/);
  });

  it("lists the tags, cut to the width", () => {
    const text = renderCards(deep.results.slice(0, 1), {
      ...plainText,
      width: 60,
    });
    expect(text).toContain("Angular/Sharp, Authoritative");
    for (const line of text.split("\n"))
      expect([...line].length).toBeLessThanOrEqual(60);
  });

  it("shows as many swatches as fit the width", () => {
    const card = {
      url: "https://example.com/",
      identity_paragraph: "Calm.",
      palette: { primary: ["#111111", "#222222", "#333333", "#444444"] },
    };
    for (const [colorLevel, width] of [
      [3, 45],
      [0, 33],
    ] as const) {
      const text = renderCards([card], {
        theme: createTheme(colorLevel),
        colorLevel,
        width,
      });
      for (const line of text.split("\n"))
        expect(
          [...line.replace(/\u001b\[[0-9;]*m/g, "")].length
        ).toBeLessThanOrEqual(width);
      expect(text).toContain("#111111");
    }
  });

  it("falls back to the address's host when a card has no brand name", () => {
    const text = renderCards(
      [{ url: "https://example.com/pricing", identity_paragraph: "Calm." }],
      plainText
    );
    expect(text).toMatch(/^ *1 {2}example\.com/m);
  });

  it("renders similar brands as the same cards", () => {
    const text = renderCards(similar.results, plainText);
    expect(text).toMatch(/^ *1 {2}runway {2}strong/m);
    expect(text).toContain("https://runway.ml/");
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
    expect(text).not.toMatch(/\bred\b/);
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

  it("ends with how to extract one, and says when there are none", () => {
    expect(renderCards(deep.results, plainText)).toContain(
      "taste extract <url>"
    );
    expect(renderCards([], plainText)).toBe("No brands found.");
  });
});
