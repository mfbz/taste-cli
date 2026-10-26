// A brand given as an id or a site's address, for similar and enhance, which need the id of a finished
// full extraction. An address is looked up in the person's own extractions with one free list read;
// it never starts an extraction, which would spend credits nobody asked for.
import type { TasteApi } from "../api/client.ts";
import type { Submission } from "../api/schemas.ts";
import { normalizeUrl } from "../api/urls.ts";
import { CliError } from "../output/errors.ts";

// One page, newest first: the list is already one entry per address, so this is ample.
const LIST_LIMIT = 100;

// Taste ids have no dot, slash or colon; a site's address always has one of them.
function isAddress(input: string): boolean {
  return /[./:]/.test(input);
}

// The same site whether or not it was typed with www. or a trailing slash; the page must match.
function sameSite(url: URL): string {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  return `${host}${url.pathname.replace(/\/+$/, "")}${url.search}`;
}

function isFull(submission: Submission): boolean {
  return !submission.sections?.length;
}

async function resolveBrand(api: TasteApi, input: string): Promise<string> {
  if (!isAddress(input)) return input;
  const url = normalizeUrl(input);
  const key = sameSite(url);
  const list = await api.listSubmissions({
    q: url.hostname.toLowerCase().replace(/^www\./, ""),
    status: "completed",
    kind: "website",
    limit: LIST_LIMIT,
  });
  const matching = list.submissions.filter((s) => {
    const source = URL.parse(s.source_url);
    return (
      s.status === "completed" && source !== null && sameSite(source) === key
    );
  });
  const full = matching.find(isFull);
  if (full) return full.submission_id;
  throw new CliError(
    matching.length ? "FULL_EXTRACTION_REQUIRED" : "NOT_FOUND",
    { url: url.href }
  );
}

export { resolveBrand };
