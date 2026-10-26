// taste check <candidate> --against <reference>: one paid brand adherence check, waited for with live
// progress and shown as a verdict. With --min it is a gate for CI: below it, exit 1 with
// BELOW_THRESHOLD and the verdict in error.details. Both addresses are made public https first.
import type { AdherenceVerdict } from "../api/schemas.ts";
import { normalizeUrl } from "../api/urls.ts";
import type { Context } from "../context.ts";
import { CliError } from "../output/errors.ts";
import type { Theme } from "../output/theme.ts";
import { renderVerdict } from "../render/verdict.ts";
import {
  awaitJob,
  showAccepted,
  startedCheck,
  startJob,
  summaryWidth,
  verdictJob,
} from "./job.ts";

type CheckOptions = {
  against: string;
  min?: number;
  wait: boolean;
  timeout: number;
};
// What --json carries, and on BELOW_THRESHOLD error.details: passed and min are null without --min.
type CheckDocument = {
  id: string;
  score: number | null;
  passed: boolean | null;
  min: number | null;
  recommendations: string[];
  fixes: Record<string, unknown>[];
};

function checkDocument(
  verdict: AdherenceVerdict,
  min: number | undefined
): CheckDocument {
  // A verdict with no score can't clear a minimum.
  const passed =
    min === undefined ? null : verdict.score !== null && verdict.score >= min;
  return {
    id: verdict.job_id,
    score: verdict.score,
    passed,
    min: min ?? null,
    recommendations: verdict.recommendations,
    fixes: verdict.fixes,
  };
}

async function check(
  ctx: Context,
  candidate: string,
  options: CheckOptions
): Promise<void> {
  // --min judges the verdict, which --no-wait never sees.
  if (options.min !== undefined && !options.wait)
    throw new CliError("USAGE_CONFLICTING_OPTIONS");
  const candidateUrl = normalizeUrl(candidate);
  const referenceUrl = normalizeUrl(options.against);

  const api = ctx.api();
  const started = await startJob(ctx, "check", () =>
    api
      .createAdherence({
        candidate_url: candidateUrl.href,
        reference_url: referenceUrl.href,
      })
      .then(startedCheck)
  );
  if (!options.wait) {
    showAccepted(ctx, started);
    return;
  }
  const { id } = started;
  const verdict = await awaitJob(
    ctx,
    id,
    options.timeout * 1000,
    verdictJob(api, id)
  );
  const { min } = options;
  const document = checkDocument(verdict, min);
  const human = (theme: Theme) =>
    renderVerdict(verdict, theme, summaryWidth(ctx), min);
  if (min === undefined || document.passed) {
    ctx.output.result(document, human);
    return;
  }
  // Under --json the error is the one document; a person sees the verdict first, then the error.
  if (!ctx.output.json) ctx.output.result(document, human);
  throw new CliError(
    "BELOW_THRESHOLD",
    {
      score: verdict.score === null ? "none" : verdict.score.toFixed(2),
      min: min.toFixed(2),
    },
    { details: document }
  );
}

export { check };
export type { CheckOptions };
