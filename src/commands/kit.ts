// taste kit <file.pdf>: one paid brand kit extraction from a guidelines PDF, waited for and shown like
// extract. The file is checked here first (there, a PDF, not empty, at most 50 MB), so a wrong file
// never costs an upload.
import { basename } from "node:path";

import type { Context } from "../context.ts";
import { CliError } from "../output/errors.ts";
import { awaitSubmission, showAccepted, showSubmission } from "./wait.ts";
import type { Format } from "./wait.ts";

type KitOptions = { format: Format; wait: boolean; timeout: number };

// The API's limit. Larger files are refused before they are read.
const MAX_BYTES = 50 * 1024 * 1024;
const PDF_MAGIC = new TextEncoder().encode("%PDF-");

function isPdf(bytes: Uint8Array): boolean {
  return PDF_MAGIC.every((byte, index) => bytes[index] === byte);
}

async function kit(
  ctx: Context,
  file: string,
  options: KitOptions
): Promise<void> {
  const bytes = await ctx.readFile(file, MAX_BYTES);
  if (bytes.length === 0 || !isPdf(bytes)) throw new CliError("INVALID_FILE");

  const api = ctx.api();
  const accepted = await api.createBrandKit({ name: basename(file), bytes });
  if (!options.wait) {
    showAccepted(ctx, accepted);
    return;
  }
  const result = await awaitSubmission(
    ctx,
    api,
    accepted.submission_id,
    options.timeout * 1000
  );
  showSubmission(ctx, result, options.format);
}

export { kit };
export type { KitOptions };
