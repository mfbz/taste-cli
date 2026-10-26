// taste search "<query>": one paid search of Taste's brand corpus, shown as numbered cards. The query
// and every filter are checked before the request, so a typo costs nothing.
import { INDUSTRY, PAGE_TYPE } from "../api/schemas.ts";
import type { BrandSearchCard, BrandSearchRequest } from "../api/schemas.ts";
import type { Context } from "../context.ts";
import { CliError } from "../output/errors.ts";
import { renderCards } from "../render/cards.ts";
import { paidCall } from "./job.ts";

type SearchOptions = {
  deep?: true;
  top?: number;
  industry?: string;
  pageType?: string;
};

// The API's own limits on the query (BrandSearchRequest), counted in characters.
const MIN_QUERY = 2;
const MAX_QUERY = 400;
// Cards are laid out at least this wide, as brand summaries are.
const MIN_WIDTH = 40;
const DEFAULT_WIDTH = 80;

function parseQuery(text: string): string {
  const query = text.trim();
  const length = [...query].length;
  if (length < MIN_QUERY || length > MAX_QUERY)
    throw new CliError("USAGE_INVALID_QUERY");
  return query;
}

function buildRequest(
  text: string,
  options: SearchOptions
): BrandSearchRequest {
  const query = parseQuery(text);
  const industry =
    options.industry === undefined
      ? undefined
      : INDUSTRY.safeParse(options.industry);
  if (industry && !industry.success)
    throw new CliError("USAGE_INVALID_INDUSTRY");
  const pageType =
    options.pageType === undefined
      ? undefined
      : PAGE_TYPE.safeParse(options.pageType);
  if (pageType && !pageType.success)
    throw new CliError("USAGE_INVALID_PAGE_TYPE");
  const body: BrandSearchRequest = {
    query,
    depth: options.deep ? "deep" : "fast",
  };
  if (options.top !== undefined) body.top_k = options.top;
  if (industry?.data || pageType?.data)
    body.filters = {
      ...(industry?.data ? { industry: industry.data } : {}),
      ...(pageType?.data ? { page_type: pageType.data } : {}),
    };
  return body;
}

// The answer as Taste sent it under --json; cards for a person.
function showCards(
  ctx: Context,
  data: unknown,
  cards: readonly BrandSearchCard[]
): void {
  ctx.output.result(data, (theme) =>
    renderCards(cards, {
      theme,
      colorLevel: ctx.terminal?.colorLevel ?? 0,
      // A pipe gets every line whole, as history's table does.
      width: ctx.terminal?.tty
        ? Math.max(ctx.terminal.width || DEFAULT_WIDTH, MIN_WIDTH)
        : undefined,
    })
  );
}

async function search(
  ctx: Context,
  query: string,
  options: SearchOptions
): Promise<void> {
  const body = buildRequest(query, options);
  const api = ctx.api();
  const answer = await paidCall(ctx, "search", () => api.search(body));
  showCards(ctx, answer, answer.results);
}

export { search, showCards };
export type { SearchOptions };
