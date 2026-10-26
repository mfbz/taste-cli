// taste extract <url>: one paid extraction of a website's brand, waited for with live progress and
// shown as a summary (or JSON). Every flag is checked, and the address made public https, before the
// one request that spends credits.
import { SECTION_NAME } from "../api/schemas.ts";
import type { SectionName, SubmissionCreate } from "../api/schemas.ts";
import { normalizeUrl } from "../api/urls.ts";
import type { Context } from "../context.ts";
import { CliError } from "../output/errors.ts";
import {
  awaitJob,
  checkOut,
  saveFiles,
  showAccepted,
  showSubmission,
  startJob,
  submissionJob,
} from "./job.ts";
import type { Format, OutOptions } from "./job.ts";

type ExtractOptions = OutOptions & {
  sections?: string;
  force?: true;
  deep?: true;
  map?: true;
  maxUrls?: number;
  format: Format;
  wait: boolean;
  timeout: number;
};

// "colors,typography" to the API's names; anything else lists the valid ones (never echoing it).
function parseSections(text: string): SectionName[] {
  const names = text
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  const parsed = SECTION_NAME.array().min(1).safeParse(names);
  if (!parsed.success) throw new CliError("USAGE_INVALID_SECTIONS");
  return [...new Set(parsed.data)];
}

async function extract(
  ctx: Context,
  input: string,
  options: ExtractOptions
): Promise<void> {
  // The API refuses this pair too, but only after a request; this way nothing is sent.
  if (options.sections !== undefined && options.map)
    throw new CliError("SELECTIVE_MAP_UNSUPPORTED");
  if (options.maxUrls !== undefined && !options.map)
    throw new CliError("USAGE_NEEDS_OPTION", {
      option: "--max-urls",
      needs: "--map",
    });
  const sections =
    options.sections === undefined
      ? undefined
      : parseSections(options.sections);
  const url = normalizeUrl(input);
  await checkOut(options);

  const body: SubmissionCreate = { url: url.href };
  if (options.force) body.force = true;
  if (options.deep) body.enable_deep_analysis = true;
  if (sections) body.sections = sections;
  const query = options.map
    ? { map: true, ...(options.maxUrls ? { maxUrls: options.maxUrls } : {}) }
    : {};

  const api = ctx.api();
  const accepted = await startJob(ctx, () => api.createSubmission(body, query));
  if (!options.wait) {
    showAccepted(ctx, accepted);
    return;
  }
  const id = accepted.submission_id;
  const result = await awaitJob(
    ctx,
    id,
    options.timeout * 1000,
    submissionJob(api, id)
  );
  await saveFiles(ctx, api, id, options);
  showSubmission(ctx, result, options.format);
}

export { extract };
export type { ExtractOptions };
