// What the job commands share (extract and kit start a job, wait picks one up, check will too):
// starting a paid job so Ctrl-C knows about it, waiting with live progress, and showing the result.
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
import { checkOutDir, writeBundle } from "../download/bundle.ts";
import { CliError, whileWaiting } from "../output/errors.ts";
import { plain } from "../output/output.ts";
import { startProgress } from "../output/progress.ts";
import { brandName, renderBrandSummary } from "../render/brand-summary.ts";
import { renderVerdict } from "../render/verdict.ts";

type Format = "summary" | "json";
// Where --out saves an extraction's files, and whether files of the same name may be replaced.
type OutOptions = { out?: string; overwrite?: true };
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

// After the job completes: its files, from the download manifest, into the --out folder.
async function saveFiles(
  ctx: Context,
  api: TasteApi,
  id: string,
  options: OutOptions
): Promise<void> {
  if (options.out === undefined) return;
  let saved: string[];
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
    throw whileWaiting(error, id);
  }
  const files = saved.length === 1 ? "file" : "files";
  ctx.output.note(
    `${ctx.output.theme.success("✓")} Saved ${saved.length} ${files} to ${plain(options.out)}`
  );
}

// The one paid request: Ctrl-C while it is in flight must not invite a second one, and once it is
// accepted the hard stop names the job to wait on.
async function startJob(
  ctx: Context,
  send: () => Promise<SubmissionAccepted>
): Promise<SubmissionAccepted> {
  ctx.inFlight({ paid: "yes" });
  const accepted = await send();
  ctx.inFlight({ id: accepted.submission_id });
  return accepted;
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
    throw whileWaiting(error, id);
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
    read: () => api.getVerdict(id),
    done: (verdict) => ({
      what: `Checked ${hostOf(verdict.candidate_url)}`,
      cached: false,
    }),
  };
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
          width: Math.max(terminalWidth(ctx), MIN_WIDTH),
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
      : renderVerdict(verdict, theme)
  );
}

// --no-wait: the id alone on stdout, so a script can keep it, and how to pick it up on stderr.
function showAccepted(ctx: Context, accepted: SubmissionAccepted): void {
  const id = accepted.submission_id;
  ctx.output.result({ id, status: accepted.status }, () => plain(id));
  ctx.output.note(`Started. Run taste wait ${plain(id)} to pick it up.`);
}

export {
  awaitJob,
  byKind,
  checkOut,
  DEFAULT_TIMEOUT_S,
  FORMATS,
  saveFiles,
  showAccepted,
  showSubmission,
  showVerdict,
  startJob,
  submissionJob,
  verdictJob,
};
export type { Format, JobSpec, OutOptions };
