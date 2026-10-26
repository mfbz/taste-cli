// What bare `taste` shows before its menu: one line, `◇ taste`, the tagline and the version, over a
// thin rule. `taste` types itself in a quarter of a second; any key or Ctrl-C jumps to the end, and
// without motion only the end is drawn.
import pkg from "../../package.json" with { type: "json" };
import type { Context } from "../context.ts";
import type { Theme } from "../output/theme.ts";

type OpeningOptions = { signal: AbortSignal };

const NAME = "taste";
const TAGLINE = "the Taste Engine, in your terminal";
const RULE_WIDTH = 58;
const FRAME_MS = 50;
const HIDE_CURSOR = "\u001b[?25l";
const SHOW_CURSOR = "\u001b[?25h";
const CLEAR_LINE = "\r\u001b[2K";

// The settled opening, two lines and a blank one to breathe; the rule keeps 4 columns clear of the edge.
function openingLines(theme: Theme, width: number): string {
  const rule = "─".repeat(Math.max(0, Math.min(RULE_WIDTH, width - 4)));
  const head = `${theme.bold(`◇ ${NAME}`)}  ${theme.dim(TAGLINE)}  ${theme.faint(pkg.version)}`;
  return `${head}\n${theme.dim(rule)}\n\n`;
}

// `taste` typing itself with a cursor, one letter a frame, until done or cut.
async function type(ctx: Context, cut: AbortSignal): Promise<void> {
  const { theme } = ctx.output;
  for (let typed = 1; typed <= NAME.length && !cut.aborted; typed += 1) {
    const text = theme.bold(`◇ ${NAME.slice(0, typed)}`);
    ctx.screen(`${CLEAR_LINE}${text}${theme.dim("_")}`);
    try {
      await ctx.sleep(FRAME_MS, cut);
    } catch (error) {
      if (!cut.aborted) throw error;
    }
  }
}

async function playOpening(
  ctx: Context,
  options: OpeningOptions
): Promise<void> {
  const settled = openingLines(ctx.output.theme, ctx.terminal?.width ?? 80);
  // A blank line above, so the opening never sits on the command that ran it.
  ctx.screen("\n");
  if (!ctx.motion) {
    ctx.screen(settled);
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
    await type(ctx, cut.signal);
    ctx.screen(`${CLEAR_LINE}${settled}`);
  } finally {
    listening.abort();
    options.signal.removeEventListener("abort", skip);
    ctx.screen(SHOW_CURSOR);
  }
}

export { openingLines, playOpening };
