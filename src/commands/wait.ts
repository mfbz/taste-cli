// taste wait <id>: picks up a job started earlier (with --no-wait, or one that was interrupted or ran
// out of time) and ends it as the command that started it would. Free: it only reads. Also home to the
// waiting and rendering that extract and kit share, so all three end the same way.
import { TasteApiError } from "../api/client.ts";
import type { TasteApi } from "../api/client.ts";
import { jobCheck, waitForJob } from "../api/poll.ts";
import type { Check } from "../api/poll.ts";
import type {
  AdherenceVerdict,
  SubmissionAccepted,
  SubmissionResult,
} from "../api/schemas.ts";
import type { Context } from "../context.ts";
import { whileWaiting } from "../output/errors.ts";
import { plain } from "../output/output.ts";
import { startProgress } from "../output/progress.ts";
import type { Theme } from "../output/theme.ts";
import { brandName, renderBrandSummary } from "../render/brand-summary.ts";

type Format = "summary" | "json";
type WaitOptions = { format: Format; timeout: number };

const FORMATS: readonly Format[] = ["summary", "json"];
const DEFAULT_TIMEOUT_S = 600;
const DEFAULT_WIDTH = 80;
// A pseudo-terminal may report 0 columns; below this, lines are left to wrap rather than cut to nothing.
const MIN_WIDTH = 40;
// Where a job ends; the done line says so instead.
const FINAL_STEPS = new Set(["completed", "failed"]);

function hostOf(url: string): string {
  return plain(URL.parse(url)?.hostname || url);
}

// Polls the job, then reads its result once it is complete. A result that isn't ready yet, just after
// completion, is one more poll.
async function awaitSubmission(
  ctx: Context,
  api: TasteApi,
  id: string,
  timeoutMs: number
): Promise<SubmissionResult> {
  const progress = startProgress({
    output: ctx.output,
    motion: ctx.motion,
    now: ctx.now,
  });
  try {
    const result = await waitForJob<SubmissionResult>({
      id,
      check: async (): Promise<Check<SubmissionResult>> => {
        const job = await api.getSubmission(id);
        if (job.status !== "completed") return jobCheck(job);
        const answer = await api.getResult(id);
        if (answer === "not_ready")
          return { done: false, step: job.current_step ?? job.status };
        return jobCheck(job, answer);
      },
      onStep: (step) => {
        if (!FINAL_STEPS.has(step)) progress.step(step);
      },
      sleep: ctx.sleep,
      now: ctx.now,
      timeoutMs,
      signal: ctx.signal,
    });
    progress.done(`Extracted ${brandName(result)}`, result.cache_hit === true);
    return result;
  } catch (error) {
    throw whileWaiting(error, id);
  } finally {
    progress.stop();
  }
}

async function awaitVerdict(
  ctx: Context,
  api: TasteApi,
  id: string,
  timeoutMs: number
): Promise<AdherenceVerdict> {
  const progress = startProgress({
    output: ctx.output,
    motion: ctx.motion,
    now: ctx.now,
  });
  try {
    const verdict = await waitForJob<AdherenceVerdict>({
      id,
      check: async (): Promise<Check<AdherenceVerdict>> => {
        const job = await api.getAdherence(id);
        if (job.status !== "completed") return jobCheck(job);
        const answer = await api.getVerdict(id);
        if (answer === "not_ready")
          return { done: false, step: job.current_step ?? job.status };
        return jobCheck(job, answer);
      },
      onStep: (step) => {
        if (!FINAL_STEPS.has(step)) progress.step(step);
      },
      sleep: ctx.sleep,
      now: ctx.now,
      timeoutMs,
      signal: ctx.signal,
    });
    progress.done(`Checked ${hostOf(verdict.candidate_url)}`, false);
    return verdict;
  } catch (error) {
    throw whileWaiting(error, id);
  } finally {
    progress.stop();
  }
}

function renderVerdict(verdict: AdherenceVerdict, theme: Theme): string {
  const score = verdict.score === null ? "none" : verdict.score.toFixed(2);
  const lines = [
    `${theme.dim("Score".padEnd(10))}${theme.bold(score)}`,
    `${theme.dim("Candidate".padEnd(10))}${plain(verdict.candidate_url)}`,
    `${theme.dim("Reference".padEnd(10))}${plain(verdict.reference_url)}`,
  ];
  if (verdict.recommendations.length) {
    lines.push("", theme.dim("Recommendations"));
    for (const item of verdict.recommendations)
      lines.push(`  - ${plain(item)}`);
  }
  lines.push("", theme.dim(`Id ${plain(verdict.job_id)}`));
  return lines.join("\n");
}

// The finished result: the --json document, the whole result as JSON, or the summary.
function showSubmission(
  ctx: Context,
  result: SubmissionResult,
  format: Format
): void {
  ctx.output.result(result, (theme) =>
    format === "json"
      ? JSON.stringify(result, null, 2)
      : renderBrandSummary(result, {
          theme,
          colorLevel: ctx.terminal?.colorLevel ?? 0,
          width: Math.max(ctx.terminal?.width || DEFAULT_WIDTH, MIN_WIDTH),
        })
  );
}

// --no-wait: the id alone on stdout, so a script can keep it, and how to pick it up on stderr.
function showAccepted(ctx: Context, accepted: SubmissionAccepted): void {
  const id = accepted.submission_id;
  ctx.output.result({ id, status: accepted.status }, () => plain(id));
  ctx.output.note(`Started. Run taste wait ${plain(id)} to pick it up.`);
}

// An id names a submission or an adherence job; Taste answers 404 for the kind it isn't.
async function wait(
  ctx: Context,
  id: string,
  options: WaitOptions
): Promise<void> {
  const api = ctx.api();
  const timeoutMs = options.timeout * 1000;
  try {
    await api.getSubmission(id);
  } catch (error) {
    if (!(error instanceof TasteApiError && error.status === 404)) throw error;
    const verdict = await awaitVerdict(ctx, api, id, timeoutMs);
    ctx.output.result(verdict, (theme) => renderVerdict(verdict, theme));
    return;
  }
  const result = await awaitSubmission(ctx, api, id, timeoutMs);
  showSubmission(ctx, result, options.format);
}

export {
  awaitSubmission,
  DEFAULT_TIMEOUT_S,
  FORMATS,
  renderVerdict,
  showAccepted,
  showSubmission,
  wait,
};
export type { Format, WaitOptions };
