// Brand cards from search and similar, numbered, one short block each: the brand (or its address's
// host) with its match, the address, why it matched (or its identity, when the search gave no reason),
// the primary palette and the tags. Every server string goes through plain(); in a terminal a line is
// cut to the width, so a long identity or tag list never wraps, and a pipe gets every line whole.
import { z } from "zod";

import type { BrandSearchCard } from "../api/schemas.ts";
import { plain } from "../output/output.ts";
import type { Theme } from "../output/theme.ts";
import type { ColorLevel } from "../output/terminal.ts";
import { fit } from "./fit.ts";
import { normalizeHex, renderSwatch } from "./swatches.ts";

// No width (a pipe): nothing is cut.
type CardsOptions = { theme: Theme; colorLevel: ColorLevel; width?: number };

const PRIMARY = z.looseObject({
  primary: z.array(z.unknown()).optional().catch(undefined),
});
const FOOTER = "Extract one in full with taste extract <url> (spends credits).";

function clean(text: string | null | undefined): string {
  return plain(text ?? "").trim();
}

function title(card: BrandSearchCard): string {
  return clean(card.brand_name) || clean(URL.parse(card.url)?.hostname ?? "");
}

function hexes(card: BrandSearchCard): string[] {
  const listed = PRIMARY.safeParse(card.palette ?? {}).data?.primary ?? [];
  return [...new Set(listed.flatMap((value) => normalizeHex(value) ?? []))];
}

// The name in bold and the tier dimmed, cut as one line; a cut's "…" stays out of the bold.
function renderHead(
  name: string,
  tier: string[],
  room: number,
  theme: Theme
): string {
  const whole = [...[name, ...tier].join("  ")];
  const cut = whole.length > room;
  const kept = cut ? whole.slice(0, Math.max(room - 1, 0)) : whole;
  const length = [...name].length;
  const bold = kept.slice(0, length).join("");
  const rest = `${kept.slice(length).join("")}${cut ? "…" : ""}`;
  return `${theme.bold(bold)}${rest ? theme.dim(rest) : ""}`;
}

function renderCard(
  card: BrandSearchCard,
  number: string,
  indent: string,
  { theme, colorLevel, width }: CardsOptions
): string[] {
  const room = width === undefined ? Infinity : width - indent.length;
  const line = (text: string) => `${indent}${fit(text, room)}`;
  const tier = [clean(card.match), clean(card.badge)].filter(Boolean);
  const lines = [
    `${number}  ${renderHead(title(card), tier, room, theme)}`,
    line(clean(card.url)),
  ];
  const why = clean(card.reason) || clean(card.identity_paragraph);
  if (why) lines.push(theme.dim(line(why)));
  const colors = hexes(card);
  if (colors.length) {
    // "██ #RRGGBB" or "#RRGGBB", two spaces apart: as many as fit.
    const cell = colorLevel >= 2 ? 12 : 9;
    const shown = colors.slice(0, Math.max(1, Math.floor((room + 2) / cell)));
    const cells = shown.map((hex) => {
      const swatch = renderSwatch(hex, colorLevel);
      return swatch ? `${swatch} ${hex}` : hex;
    });
    lines.push(`${indent}${cells.join("  ")}`);
  }
  const tags = (card.tags ?? []).map((tag) => clean(tag)).filter(Boolean);
  if (tags.length) lines.push(theme.dim(line(tags.join(", "))));
  return lines;
}

function renderCards(
  cards: readonly BrandSearchCard[],
  options: CardsOptions
): string {
  if (cards.length === 0) return "No brands found.";
  const digits = String(cards.length).length;
  const indent = " ".repeat(digits + 2);
  const blocks = cards.map((card, i) =>
    renderCard(card, String(i + 1).padStart(digits), indent, options).join("\n")
  );
  return [
    ...blocks,
    options.theme.dim(fit(FOOTER, options.width ?? Infinity)),
  ].join("\n\n");
}

export { renderCards };
export type { CardsOptions };
