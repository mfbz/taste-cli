// What the job commands share (extract, kit and check start a job, wait picks one up):
// starting a paid job or request so Ctrl-C knows about it, waiting with live progress, and showing
// the result.
import { TasteApiError } from "../api/client.ts";
import type { TasteApi } from "../api/client.ts";
import { jobCheck, waitForJob } from "../api/poll.ts";
import type { Check } from "../api/poll.ts";
import type {
  AdherenceAccepted,
  AdherenceVerdict,
  SubmissionAccepted,
  SubmissionResult,
} from "../api/schemas.ts";
import type { Context } from "../context.ts";
import { checkOutDir, writeBundle } from "../download/bundle.ts";
import type { Saved, Skipped } from "../download/bundle.ts";
import type { ErrorCode, PaidKind } from "../output/errors.ts";
import {
  cleanPath,
  CliError,
  whileSaving,
  whileWaiting,
} from "../output/errors.ts";
import { plain } from "../output/output.ts";
import { startProgress } from "../output/progress.ts";
import { brandName, renderBrandSummary } from "../render/brand-summary.ts";
import { renderVerdict } from "../render/verdict.ts";

type Format = "summary" | "json";
// Where --out saves an extraction's files, and whether files of the same name may be replaced.
type OutOptions = { out?: string; overwrite?: true };
// A job just accepted, whichever kind: extract and kit get a submission, check an adherence job.
type Started = { id: string; status: string };
// A job as the API reports it while it runs.
type JobState = {
  status: string;
  current_step?: string | null;
  error?: string | null;
};
type JobSpec<T> = {
  poll: () => Promise<JobState>;
  // The result once the job is complete; "not_ready" just after completion means one more poll.
  read: () => Promise<T | "not_ready">;
  // The closing line's words (ours, cleaned) and whether Taste served it from a cache.
  done: (value: T) => { what: string; cached: boolean };
  // The code a failed job ends with, when JOB_FAILED isn't the right word for it.
  failed?: ErrorCode;
};

const FORMATS: readonly Format[] = ["summary", "json"];
const DEFAULT_TIMEOUT_S = 600;
const DEFAULT_WIDTH = 80;
// Summaries are laid out at least this wide; a narrower terminal wraps them rather than cutting them
// to nothing (a pseudo-terminal may even report 0 columns).
const MIN_WIDTH = 40;
// Where a job ends; the closing line says so instead.
const FINAL_STEPS = new Set(["completed", "failed"]);

function terminalWidth(ctx: Context): number {
  return ctx.terminal?.width || DEFAULT_WIDTH;
}

function summaryWidth(ctx: Context): number {
  return Math.max(terminalWidth(ctx), MIN_WIDTH);
}

function hostOf(url: string): string {
  return plain(URL.parse(url)?.hostname || url);
}

// --out and --overwrite, checked before anything is sent: a folder that can't take the files costs
// nothing.
async function checkOut(
  options: OutOptions & { wait?: boolean }
): Promise<void> {
  if (options.overwrite && options.out === undefined)
    throw new CliError("USAGE_NEEDS_OPTION", {
      option: "--overwrite",
      needs: "--out",
    });
  if (options.out === undefined) return;
  if (options.wait === false) throw new CliError("USAGE_CONFLICTING_OPTIONS");
  await checkOutDir(options.out, options.overwrite === true);
}

// An id names a submission (an extraction or a brand kit) or an adherence check; Taste answers 404
// for the kind it isn't, and that changes nothing, so the submission is tried first.
async function byKind<T>(
  submission: () => Promise<T>,
  check: () => Promise<T>
): Promise<T> {
  try {
    return await submission();
  } catch (error) {
    if (!(error instanceof TasteApiError && error.status === 404)) throw error;
    return check();
  }
}

// The most skipped files named in the warning; the rest are counted.
const SKIPPED_SHOWN = 10;

// After the job completes: its files, from the download manifest, into the --out folder. Returns the
// files skipped because their download is gone for good (see goneForGood in download/bundle.ts).
async function saveFiles(
  ctx: Context,
  api: TasteApi,
  id: string,
  options: OutOptions
): Promise<Skipped[]> {
  if (options.out === undefined) return [];
  let saved: Saved;
  try {
    const manifest = await api.getManifest(id);
    saved = await writeBundle({
      api,
      manifest,
      dir: options.out,
      overwrite: options.overwrite === true,
      signal: ctx.signal,
    });
  } catch (error) {
    // explain first, so a session's final 401 is SESSION_EXPIRED, as anywhere else.
    throw whileSaving(ctx.auth.explain(error), id);
  }
  const { written, skipped } = saved;
  const files = written.length === 1 ? "file" : "files";
  const skipNote = skipped.length ? `, skipped ${skipped.length}` : "";
  ctx.output.note(
    `${ctx.output.theme.success("✓")} Saved ${written.length} ${files} to ${plain(options.out)}${skipNote}`
  );
  if (skipped.length) {
    const named = skipped
      .slice(0, SKIPPED_SHOWN)
      .map((s) => `${plain(cleanPath(s.path))} (${s.status})`);
    const more = skipped.length - named.length;
    if (more > 0) named.push(`and ${more} more`);
    ctx.output.warn(
      `Skipped ${skipped.length === 1 ? "a file" : `${skipped.length} files`} whose download is gone or too large: ${named.join(", ")}`
    );
  }
  return skipped;
}

// The one paid request: Ctrl-C while it is in flight must not invite a second one, and once it is
// accepted the hard stop names the job to wait on.
async function startJob(
  ctx: Context,
  send: () => Promise<Started>
): Promise<Started> {
  ctx.inFlight({ paid: "job" });
  const started = await send();
  ctx.inFlight({ id: started.id });
  return started;
}

// A paid request that answers at once (search, similar, enhance): while it is in flight the hard stop
// says to check taste history, and once it has answered nothing is left behind.
async function paidCall<T>(
  ctx: Context,
  kind: PaidKind,
  send: () => Promise<T>
): Promise<T> {
  ctx.inFlight({ paid: kind });
  const answer = await send();
  ctx.inFlight({});
  return answer;
}

async function awaitJob<T>(
  ctx: Context,
  id: string,
  timeoutMs: number,
  spec: JobSpec<T>
): Promise<T> {
  ctx.inFlight({ id });
  const progress = startProgress({
    output: ctx.output,
    motion: ctx.motion,
    now: ctx.now,
    width: terminalWidth(ctx),
  });
  try {
    const value = await waitForJob<T>({
      id,
      check: async (): Promise<Check<T>> => {
        const job = await spec.poll();
        if (job.status !== "completed") return jobCheck(job);
        const answer = await spec.read();
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
    const { what, cached } = spec.done(value);
    progress.done(what, cached);
    return value;
  } catch (error) {
    const failed =
      spec.failed && error instanceof CliError && error.code === "JOB_FAILED"
        ? new CliError(spec.failed, error.params, { cause: error })
        : error;
    throw whileWaiting(failed, id);
  } finally {
    progress.stop();
  }
}

function submissionJob(api: TasteApi, id: string): JobSpec<SubmissionResult> {
  return {
    poll: () => api.getSubmission(id),
    read: () => api.getResult(id),
    done: (result) => ({
      what: `Extracted ${brandName(result)}`,
      cached: result.cache_hit === true,
    }),
  };
}

function verdictJob(api: TasteApi, id: string): JobSpec<AdherenceVerdict> {
  return {
    poll: () => api.getAdherence(id),
    read: async () => {
      try {
        return await api.getVerdict(id);
      } catch (error) {
        // 424: the check failed after all; the job holds the reason.
        if (!(error instanceof TasteApiError && error.status === 424))
          throw error;
        const job = await api.getAdherence(id);
        throw new CliError(
          "ADHERENCE_FAILED",
          { id, reason: job.error ?? "" },
          { cause: error }
        );
      }
    },
    done: (verdict) => ({
      what: `Checked ${hostOf(verdict.candidate_url)}`,
      cached: false,
    }),
    failed: "ADHERENCE_FAILED",
  };
}

// The finished result: the --json document, the whole result as JSON, or the summary.
function showSubmission(
  ctx: Context,
  result: SubmissionResult,
  format: Format,
  skipped: Skipped[] = []
): void {
  // --json names what --out skipped; the result itself stays as Taste sent it.
  const data = skipped.length ? { ...result, skipped } : result;
  ctx.output.result(data, (theme) =>
    format === "json"
      ? JSON.stringify(result, null, 2)
      : renderBrandSummary(result, {
          theme,
          colorLevel: ctx.terminal?.colorLevel ?? 0,
          width: summaryWidth(ctx),
        })
  );
}

function showVerdict(
  ctx: Context,
  verdict: AdherenceVerdict,
  format: Format
): void {
  ctx.output.result(verdict, (theme) =>
    format === "json"
      ? JSON.stringify(verdict, null, 2)
      : renderVerdict(verdict, theme, summaryWidth(ctx))
  );
}

function startedSubmission(accepted: SubmissionAccepted): Started {
  return { id: accepted.submission_id, status: accepted.status };
}

function startedCheck(accepted: AdherenceAccepted): Started {
  return { id: accepted.job_id, status: accepted.status };
}

// --no-wait: the id alone on stdout, so a script can keep it, and how to pick it up on stderr.
function showAccepted(ctx: Context, { id, status }: Started): void {
  ctx.output.result({ id, status }, () => plain(id));
  ctx.output.note(`Started. Run taste wait ${plain(id)} to pick it up.`);
}

export {
  awaitJob,
  byKind,
  checkOut,
  DEFAULT_TIMEOUT_S,
  FORMATS,
  paidCall,
  saveFiles,
  showAccepted,
  showSubmission,
  showVerdict,
  startedCheck,
  startedSubmission,
  startJob,
  submissionJob,
  summaryWidth,
  verdictJob,
};
export type { Format, JobSpec, OutOptions };
