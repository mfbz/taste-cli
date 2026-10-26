// taste wait <id>: picks up a job started earlier (with --no-wait, or one that was interrupted or ran
// out of time) and ends it as the command that started it would. Free: it only reads.
import type { Context } from "../context.ts";
import { CliError } from "../output/errors.ts";
import {
  awaitJob,
  byKind,
  checkOut,
  finishSubmission,
  showVerdict,
  submissionJob,
  verdictJob,
} from "./job.ts";
import type { Format, OutOptions } from "./job.ts";

type WaitOptions = OutOptions & { format: Format; timeout: number };

async function wait(
  ctx: Context,
  id: string,
  options: WaitOptions
): Promise<void> {
  await checkOut(options);
  const api = ctx.api();
  const timeoutMs = options.timeout * 1000;
  const kind = await byKind(
    async () => {
      await api.getSubmission(id);
      return "submission" as const;
    },
    async () => {
      // Only with --out or --format design-md does the kind decide an error, so only then is it
      // confirmed first: an id that is neither is NOT_FOUND, not a check.
      if (options.out !== undefined || options.format === "design-md")
        await api.getAdherence(id);
      return "check" as const;
    }
  );
  if (kind === "check") {
    if (options.out !== undefined) throw new CliError("USAGE_OUT_UNSUPPORTED");
    if (options.format === "design-md")
      throw new CliError("USAGE_FORMAT_UNSUPPORTED");
    const verdict = await awaitJob(ctx, id, timeoutMs, verdictJob(api, id));
    showVerdict(ctx, verdict, options.format);
    return;
  }
  const result = await awaitJob(ctx, id, timeoutMs, submissionJob(api, id));
  await finishSubmission(ctx, api, id, result, options);
}

export { wait };
export type { WaitOptions };
