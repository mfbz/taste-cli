// A finished brand adherence verdict as text: the score, the two addresses, the recommendations and
// the id. Every server string goes through plain().
import type { AdherenceVerdict } from "../api/schemas.ts";
import { plain } from "../output/output.ts";
import type { Theme } from "../output/theme.ts";

const LABEL_WIDTH = 10;

function renderVerdict(verdict: AdherenceVerdict, theme: Theme): string {
  const score = verdict.score === null ? "none" : verdict.score.toFixed(2);
  const label = (text: string) => theme.dim(text.padEnd(LABEL_WIDTH));
  const lines = [
    `${label("Score")}${theme.bold(score)}`,
    `${label("Candidate")}${plain(verdict.candidate_url)}`,
    `${label("Reference")}${plain(verdict.reference_url)}`,
  ];
  if (verdict.recommendations.length) {
    lines.push("", theme.dim("Recommendations"));
    for (const item of verdict.recommendations)
      lines.push(`  - ${plain(item)}`);
  }
  lines.push("", theme.dim(`Id ${plain(verdict.job_id)}`));
  return lines.join("\n");
}

export { renderVerdict };
