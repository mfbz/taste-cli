import type { ColorLevel } from "./terminal.ts";

type Style = (text: string) => string;
type Theme = {
  bold: Style;
  success: Style;
  warning: Style;
  error: Style;
  dim: Style;
  faint: Style;
};

// tastelabs.com is monochrome: paper type, grey for anything secondary, colour only in content. So is
// taste, with the terminal's own foreground as the paper, so a light theme stays readable: bold for
// emphasis, plain for ✓ and warnings, grey for labels and asides, faint for the score bar's track and the version. signal, the one colour in chrome, marks errors, because a failure
// must stand out. A brand's own colours are content and keep their hex. field is the sign in page's.
const PALETTE = {
  paper: "#F3F3EF",
  grey: "#8B8B8B",
  faint: "#5A5A5A",
  signal: "#FF3D00",
  field: "#1E1E1E",
} as const;
const RESET = "\u001b[0m";
// 256-colour and 16-colour codes picked by hand: the colour cube has no greys this close.
const FALLBACK: Readonly<Record<string, readonly [number, number]>> = {
  [PALETTE.grey]: [245, 90],
  [PALETTE.faint]: [240, 90],
  [PALETTE.signal]: [202, 31],
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

function foreground(hex: string, level: ColorLevel): string {
  if (level === 3) return `38;2;${rgb(hex).join(";")}`;
  const [n256, n16] = FALLBACK[hex] ?? [to256(rgb(hex)), 39];
  return level === 2 ? `38;5;${n256}` : String(n16);
}

function sgr(code: string): Style {
  return (text) => `\u001b[${code}m${text}${RESET}`;
}

function createTheme(level: ColorLevel): Theme {
  if (level === 0) {
    const plain: Style = (text) => text;
    return {
      bold: plain,
      success: plain,
      warning: plain,
      error: plain,
      dim: plain,
      faint: plain,
    };
  }
  const own: Style = (text) => text;
  return {
    bold: sgr("1"),
    success: own,
    warning: own,
    // Errors always carry a glyph or a word too, so they read without colour.
    error: sgr(foreground(PALETTE.signal, level)),
    dim: sgr(foreground(PALETTE.grey, level)),
    faint: sgr(foreground(PALETTE.faint, level)),
  };
}

export { PALETTE, createTheme, rgb, to256 };
export type { Style, Theme };
