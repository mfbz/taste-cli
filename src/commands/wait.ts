// taste wait <id>: picks up a job started earlier (with --no-wait, or one that was interrupted or ran
// out of time) and ends it as the command that started it would. Free: it only reads.
import { TasteApiError } from "../api/client.ts";
import type { Context } from "../context.ts";
import {
  awaitJob,
  showSubmission,
  showVerdict,
  submissionJob,
  verdictJob,
} from "./job.ts";
import type { Format } from "./job.ts";

type WaitOptions = { format: Format; timeout: number };

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
    const verdict = await awaitJob(ctx, id, timeoutMs, verdictJob(api, id));
    showVerdict(ctx, verdict, options.format);
    return;
  }
  const result = await awaitJob(ctx, id, timeoutMs, submissionJob(api, id));
  showSubmission(ctx, result, options.format);
}

export { wait };
export type { WaitOptions };
