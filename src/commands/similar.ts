// taste similar <id|url>: brands from Taste's corpus that look like one of your full extractions, as
// the same cards as search. Paid. An address is first matched to your newest finished full
// extraction of it, for free; one that has none fails before anything is spent.
import type { Context } from "../context.ts";
import { paidCall } from "./job.ts";
import { resolveBrand } from "./resolve-brand.ts";
import { showCards } from "./search.ts";

type SimilarOptions = { top?: number };

async function similar(
  ctx: Context,
  brand: string,
  options: SimilarOptions
): Promise<void> {
  const api = ctx.api();
  const id = await resolveBrand(api, brand);
  const answer = await paidCall(ctx, () => api.similar(id, options.top));
  showCards(ctx, answer, answer.results);
}

export { similar };
export type { SimilarOptions };
