// taste enhance "<prompt>" --brand <id|url>: the prompt rewritten in a brand's terms, from one of your
// full extractions. Paid. stdout carries the enhanced prompt alone, so it pipes (taste enhance … |
// pbcopy); the brand goes to stderr.
import { normalizeUrl } from "../api/urls.ts";
import type { Context } from "../context.ts";
import { CliError } from "../output/errors.ts";
import { plain } from "../output/output.ts";
import { paidCall } from "./job.ts";
import { resolveBrand } from "./resolve-brand.ts";

type EnhanceOptions = { brand: string };

function hostOf(url: string | null | undefined): string {
  return url ? (URL.parse(url)?.hostname ?? "") : "";
}

async function enhance(
  ctx: Context,
  prompt: string,
  options: EnhanceOptions
): Promise<void> {
  if (prompt.trim() === "") throw new CliError("USAGE_INVALID_PROMPT");
  const api = ctx.api();
  const id = await resolveBrand(api, options.brand);
  const answer = await paidCall(ctx, () =>
    api.enhance({ submission_id: id, prompt })
  );
  // Newlines and tabs are the prompt's own; any other control character is stripped, as everywhere.
  const text = plain(answer.enhanced_prompt, { newlines: true });
  ctx.output.result(answer, () =>
    text.endsWith("\n") ? text.slice(0, -1) : text
  );
  const brand =
    plain(answer.brand_name ?? "").trim() ||
    plain(hostOf(answer.source_url)) ||
    // resolveBrand hands an id back as it came; anything else was an address it has checked.
    (id === options.brand ? plain(id) : normalizeUrl(options.brand).hostname);
  ctx.output.note(`${ctx.output.theme.success("✓")} Enhanced for ${brand}.`);
}

export { enhance };
export type { EnhanceOptions };
