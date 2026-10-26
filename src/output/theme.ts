import type { ColorLevel } from "./terminal.ts";

type Style = (text: string) => string;
type Theme = {
  accent: Style;
  success: Style;
  warning: Style;
  error: Style;
  dim: Style;
  bold: Style;
};

// Placeholder values: the colours observed on tastelabs.com, finalized with the brand pass. paper and
// field are the page's text and background; in a terminal the user's own foreground and background
// play those parts, so light themes stay readable.
const PALETTE = {
  signal: "#FF3D00",
  acid: "#F2F04A",
  electric: "#1E7BFF",
  success: "#3DDC84",
  paper: "#F3F3EF",
  field: "#1B1B1B",
} as const;
const RESET = "\u001b[0m";
// The basic colour that means the same thing, for 16-colour terminals.
const BASIC: Readonly<Record<string, number>> = {
  [PALETTE.signal]: 31,
  [PALETTE.success]: 32,
  [PALETTE.acid]: 33,
  [PALETTE.electric]: 34,
};

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// The nearest colour in xterm's 6×6×6 cube (codes 16–231).
function to256([r, g, b]: [number, number, number]): number {
  const step = (v: number) => Math.round((v / 255) * 5);
  return 16 + 36 * step(r) + 6 * step(g) + step(b);
}

function sgr(code: string): Style {
  return (text) => `\u001b[${code}m${text}${RESET}`;
}

function colour(hex: string, level: ColorLevel): Style {
  if (level === 3) return sgr(`38;2;${rgb(hex).join(";")}`);
  if (level === 2) return sgr(`38;5;${to256(rgb(hex))}`);
  return sgr(String(BASIC[hex] ?? 39));
}

function createTheme(level: ColorLevel): Theme {
  if (level === 0) {
    const plain: Style = (text) => text;
    return {
      accent: plain,
      success: plain,
      warning: plain,
      error: plain,
      dim: plain,
      bold: plain,
    };
  }
  return {
    accent: colour(PALETTE.signal, level),
    success: colour(PALETTE.success, level),
    warning: colour(PALETTE.acid, level),
    // Signal is both the accent and the error colour; errors always carry a glyph or word too.
    error: colour(PALETTE.signal, level),
    dim: sgr("2"),
    bold: sgr("1"),
  };
}

export { PALETTE, createTheme, rgb, to256 };
export type { Style, Theme };
