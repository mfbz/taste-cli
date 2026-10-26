// The pieces of a job's progress on stderr: a spinner line that redraws in place in a terminal, one
// note per step elsewhere, and the line that closes it. Pure: text in, text out.
import { plain } from "../output/output.ts";
import type { Theme } from "../output/theme.ts";
import { fit } from "./fit.ts";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

function humanizeStep(step: string): string {
  const words = plain(step).replaceAll("_", " ").trim();
  if (words === "") return "Working";
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const rest = String(seconds % 60).padStart(2, "0");
  return `${Math.floor(seconds / 60)}m ${rest}s`;
}

// Kept to width - 1 columns: a line that wraps can't be redrawn in place, and would add a row a frame.
function renderProgressLine(
  frame: number,
  step: string,
  elapsedMs: number,
  theme: Theme,
  width: number
): string {
  const spinner = FRAMES[frame % FRAMES.length] ?? FRAMES[0];
  const tail = `· ${formatElapsed(elapsedMs)}`;
  const room = width - 1 - (spinner.length + 1) - (tail.length + 1);
  return `${theme.accent(spinner)} ${fit(humanizeStep(step), room)} ${theme.dim(tail)}`;
}

function renderStepNote(step: string, elapsedMs: number, theme: Theme): string {
  return `${humanizeStep(step)} ${theme.dim(`· ${formatElapsed(elapsedMs)}`)}`;
}

// what is ours ("Extracted Taste", the brand already cleaned by the caller).
function renderDone(
  what: string,
  elapsedMs: number,
  cached: boolean,
  theme: Theme
): string {
  const how = cached ? "(cached)" : `in ${formatElapsed(elapsedMs)}`;
  return `${theme.success("✓")} ${what} ${how}`;
}

export {
  formatElapsed,
  humanizeStep,
  renderDone,
  renderProgressLine,
  renderStepNote,
};
