// A finished brand adherence verdict as text: the score with a bar, the two addresses, every
// recommendation, the fixes summed by action and the id. The score is coloured, with a glyph, only
// against a --min. Every server string goes through plain(); recommendations wrap to the width, other
// lines are cut.
import type { AdherenceVerdict } from "../api/schemas.ts";
import { plain } from "../output/output.ts";
import type { Theme } from "../output/theme.ts";
import { fit } from "./fit.ts";

const LABEL_WIDTH = 10;
const BAR_CELLS = 20;
const FIXES_SHOWN = 3;

function clean(text: string): string {
  return plain(text).replace(/\s+/g, " ").trim();
}

// Words laid into lines of at most `room` columns; a word longer than a line is split.
function wrap(text: string, room: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    let rest = [...word];
    while (rest.length > room) {
      if (line) lines.push(line);
      lines.push(rest.slice(0, room).join(""));
      rest = rest.slice(room);
      line = "";
    }
    const piece = rest.join("");
    if (!line) line = piece;
    else if ([...line].length + 1 + rest.length <= room) line += ` ${piece}`;
    else {
      lines.push(line);
      line = piece;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function renderScore(
  score: number | null,
  theme: Theme,
  min: number | undefined
): string {
  if (score === null) return theme.bold("none");
  const filled = Math.round(Math.min(Math.max(score, 0), 1) * BAR_CELLS);
  const bar = `${"█".repeat(filled)}${"░".repeat(BAR_CELLS - filled)}`;
  const text = `${theme.bold(score.toFixed(2))}  `;
  if (min === undefined) return `${text}${bar}`;
  const style = score >= min ? theme.success : theme.error;
  const glyph = score >= min ? "✓" : "✗";
  return `${text}${style(bar)}  ${style(glyph)} ${theme.dim(`min ${min.toFixed(2)}`)}`;
}

function actionOf(fix: Record<string, unknown>): string {
  return typeof fix.action === "string"
    ? clean(fix.action) || "other"
    : "other";
}

// A fix's fields after its action, as "name: value", leaving out the empty ones.
function renderFix(fix: Record<string, unknown>): string {
  const fields = Object.entries(fix)
    .filter(([name, value]) => name !== "action" && value != null)
    .map(([name, value]) => {
      const text = typeof value === "string" ? value : JSON.stringify(value);
      return `${clean(name)}: ${clean(text)}`;
    })
    .filter((field) => !field.endsWith(": "));
  return [actionOf(fix), fields.join(", ")].filter(Boolean).join("  ");
}

function renderFixes(
  verdict: AdherenceVerdict,
  theme: Theme,
  width: number
): string[] {
  const { fixes } = verdict;
  if (!fixes.length) return [];
  const counts = new Map<string, number>();
  for (const fix of fixes) {
    const action = actionOf(fix);
    counts.set(action, (counts.get(action) ?? 0) + 1);
  }
  const summary = [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([action, count]) => `${action} ${count}`)
    .join(", ");
  const noun = fixes.length === 1 ? "fix" : "fixes";
  const lines = [
    "",
    theme.dim(fit(`${fixes.length} ${noun}: ${summary}`, width)),
    ...fixes
      .slice(0, FIXES_SHOWN)
      .map((fix) => `  ${fit(renderFix(fix), width - 2)}`),
  ];
  const more = fixes.length - FIXES_SHOWN;
  if (more > 0)
    lines.push(
      theme.dim(
        fit(
          `  and ${more} more: taste wait ${plain(verdict.job_id)} --format json`,
          width
        )
      )
    );
  return lines;
}

function renderVerdict(
  verdict: AdherenceVerdict,
  theme: Theme,
  width: number,
  min?: number
): string {
  const room = width - LABEL_WIDTH;
  const label = (text: string) => theme.dim(text.padEnd(LABEL_WIDTH));
  const id = plain(verdict.job_id);
  const lines = [
    `${label("Score")}${renderScore(verdict.score, theme, min)}`,
    `${label("Candidate")}${fit(plain(verdict.candidate_url), room)}`,
    `${label("Reference")}${fit(plain(verdict.reference_url), room)}`,
  ];
  const items = verdict.recommendations.map(clean).filter(Boolean);
  if (items.length) {
    lines.push("", theme.dim("Recommendations"));
    const digits = String(items.length).length;
    items.forEach((item, i) => {
      const number = `  ${String(i + 1).padStart(digits)}. `;
      const indent = " ".repeat(number.length);
      wrap(item, Math.max(width - number.length, 1)).forEach((line, j) =>
        lines.push(`${j === 0 ? number : indent}${line}`)
      );
    });
  }
  lines.push(
    ...renderFixes(verdict, theme, width),
    "",
    `${label("Id")}${fit(id, room)}`,
    theme.dim(fit(`Share it: taste share ${id}`, width))
  );
  return lines.join("\n");
}

export { renderVerdict };
