// What bare `taste` shows before its menu: our own block lettering of TASTE (not Taste Labs' logo)
// resolving from an ordered dither in half a second, with a dim line under it. Any key or Ctrl-C jumps
// to the last frame; without motion only the last frame is drawn, and a narrow terminal gets one line.
import pkg from "../../package.json" with { type: "json" };
import type { Context } from "../context.ts";
import type { Theme } from "../output/theme.ts";

type OpeningOptions = { signal: AbortSignal };

const LETTERS: Readonly<Record<string, readonly string[]>> = {
  T: ["██████████", "   ████   ", "   ████   ", "   ████   ", "   ████   "],
  A: ["▄████████▄", "████  ████", "██████████", "████  ████", "████  ████"],
  S: ["▄████████▄", "████    ▀▀", "▀████████▄", "▄▄    ████", "▀████████▀"],
  E: ["██████████", "████      ", "████████  ", "████      ", "██████████"],
};
const WORDMARK: readonly string[] = [0, 1, 2, 3, 4].map((row) =>
  [..."TASTE"].map((letter) => LETTERS[letter]?.[row] ?? "").join("  ")
);
// The wordmark is 58 columns; below this the one line is all that fits.
const MIN_WIDTH = 64;
const TAGLINE = "unofficial CLI for the Taste Engine";
const FRAMES = 12;
const FRAME_MS = 45;
// 4×4 Bayer matrix: the order in which cells cross the rising threshold.
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const;
// What a cell shows on its way in, faintest first.
const SHADES = [" ", "░", "▒", "▓"] as const;
const HIDE_CURSOR = "\u001b[?25l";
const SHOW_CURSOR = "\u001b[?25h";

function cell(glyph: string, x: number, y: number, progress: number): string {
  if (glyph === " " || progress >= 1) return glyph;
  const threshold = (BAYER[y % 4]?.[x % 4] ?? 0) / 16;
  // Each cell fades in over 40% of the run, starting when the threshold lets it.
  const local = (progress - threshold * 0.6) / 0.4;
  if (local >= 1) return glyph;
  return SHADES[Math.max(0, Math.floor(local * SHADES.length))] ?? " ";
}

// The opening at progress 0 to 1, as lines; 1 is the settled wordmark.
function openingFrame(progress: number, theme: Theme): string[] {
  const mark = WORDMARK.map((line, y) =>
    theme.accent(
      [...line].map((glyph, x) => cell(glyph, x, y, progress)).join("")
    )
  );
  return [...mark, "", theme.dim(`${TAGLINE} · ${pkg.version}`)];
}

// Lines drawn over the frame above when there is one, so the opening never scrolls.
function paint(lines: readonly string[], over: boolean): string {
  const up = over ? `\u001b[${lines.length}A` : "";
  return `${up}${lines.map((line) => `\r\u001b[2K${line}\n`).join("")}`;
}

// Frames up to the last, or until cut; true when it drew any.
async function animate(ctx: Context, cut: AbortSignal): Promise<boolean> {
  let drawn = false;
  for (let frame = 1; frame < FRAMES && !cut.aborted; frame += 1) {
    ctx.screen(paint(openingFrame(frame / FRAMES, ctx.output.theme), drawn));
    drawn = true;
    try {
      await ctx.sleep(FRAME_MS, cut);
    } catch (error) {
      if (!cut.aborted) throw error;
    }
  }
  return drawn;
}

async function playOpening(
  ctx: Context,
  options: OpeningOptions
): Promise<void> {
  const width = ctx.terminal?.width ?? 0;
  const theme = ctx.output.theme;
  if (width < MIN_WIDTH) {
    ctx.screen(`${theme.accent("TASTE")} ${theme.dim(`· ${TAGLINE}`)}\n`);
    return;
  }
  const settled = openingFrame(1, theme);
  if (!ctx.motion) {
    ctx.screen(`${settled.join("\n")}\n`);
    return;
  }
  const cut = new AbortController();
  const listening = new AbortController();
  const skip = () => cut.abort();
  options.signal.addEventListener("abort", skip, { once: true });
  if (options.signal.aborted) skip();
  ctx.keypress(listening.signal).then(skip, () => {});
  ctx.screen(HIDE_CURSOR);
  try {
    ctx.screen(paint(settled, await animate(ctx, cut.signal)));
  } finally {
    listening.abort();
    options.signal.removeEventListener("abort", skip);
    ctx.screen(SHOW_CURSOR);
  }
}

export { openingFrame, playOpening, WORDMARK };
