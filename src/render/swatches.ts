// A colour from an extraction as a terminal swatch. The hex comes from the server, so only a real hex
// colour is ever turned into an escape sequence; anything else is not drawn.
import { plain } from "../output/output.ts";
import { rgb, to256 } from "../output/theme.ts";
import type { Theme } from "../output/theme.ts";
import type { ColorLevel } from "../output/terminal.ts";

type Color = { hex: string; name: string };

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const BLOCK = "██";
const RESET = "\u001b[0m";

function normalizeHex(value: unknown): string | undefined {
  if (typeof value !== "string" || !HEX.test(value)) return undefined;
  const digits = value.slice(1);
  const full =
    digits.length === 3
      ? [...digits].map((digit) => digit + digit).join("")
      : digits;
  return `#${full.toUpperCase()}`;
}

// 16 colours can't show a brand's colour, and a near miss would mislead, so they get the hex alone.
function renderSwatch(hex: string, level: ColorLevel): string {
  if (level === 3) return `\u001b[38;2;${rgb(hex).join(";")}m${BLOCK}${RESET}`;
  if (level === 2) return `\u001b[38;5;${to256(rgb(hex))}m${BLOCK}${RESET}`;
  return "";
}

function renderColorRow(color: Color, level: ColorLevel, theme: Theme): string {
  const swatch = renderSwatch(color.hex, level);
  const name = plain(color.name);
  return `${swatch ? `${swatch} ` : ""}${color.hex}${name ? `  ${theme.dim(name)}` : ""}`;
}

export { normalizeHex, renderColorRow, renderSwatch };
export type { Color };
