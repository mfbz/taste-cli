// A brand given as an id or a site's address, for similar and enhance, which need the id of a finished
// full extraction. An address is looked up in the person's own extractions with free list reads; it
// never starts an extraction, which would spend credits nobody asked for.
import type { TasteApi } from "../api/client.ts";
import type { Submission } from "../api/schemas.ts";
import { normalizeUrl } from "../api/urls.ts";
import { CliError } from "../output/errors.ts";

const PAGE_SIZE = 100;
// The list keeps every extraction, several per address, so a busy host can take more than a page.
// Past this many, taste gives up rather than read without end.
const MAX_PAGES = 3;
// Taste's ids are UUIDs; anything else is meant as an address.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A word a person may have meant as a site, shown back in the hint only when it looks like one.
const WORD = /^[A-Za-z0-9-]{1,23}$/;

function bareHost(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, "");
}

// The same site with or without www. or a trailing slash, over http or https; the port and the page
// must match.
function siteKey(url: URL): string {
  const host = url.host.toLowerCase().replace(/^www\./, "");
  return `${host}${url.pathname.replace(/\/+$/, "")}`;
}

function isFull(submission: Submission): boolean {
  return !submission.sections?.length;
}

function acceptedAt(submission: Submission): number {
  const time = Date.parse(submission.accepted_at ?? "");
  return Number.isNaN(time) ? -Infinity : time;
}

function newestFirst(a: Submission, b: Submission): number {
  return acceptedAt(b) - acceptedAt(a);
}

async function matchesOf(api: TasteApi, url: URL): Promise<Submission[]> {
  const key = siteKey(url);
  const found: Submission[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const offset = page * PAGE_SIZE;
    const list = await api.listSubmissions({
      q: bareHost(url),
      status: "completed",
      kind: "website",
      limit: PAGE_SIZE,
      offset,
    });
    for (const s of list.submissions) {
      const source = URL.parse(s.source_url);
      if (s.status === "completed" && source && siteKey(source) === key)
        found.push(s);
    }
    if (
      list.submissions.length < PAGE_SIZE ||
      offset + list.submissions.length >= list.total
    )
      break;
  }
  // Taste's order is not relied on: the newest by when it was accepted.
  return found.sort(newestFirst);
}

async function resolveBrand(api: TasteApi, input: string): Promise<string> {
  const text = input.trim();
  if (UUID.test(text)) return text;
  if (!/[./:]/.test(text))
    throw new CliError("USAGE_INVALID_BRAND", {
      word: WORD.test(text) ? text.toLowerCase() : "example",
    });
  const url = normalizeUrl(text);
  const matches = await matchesOf(api, url);
  const full = matches.find(isFull);
  if (full) return full.submission_id;
  throw new CliError(
    matches.length ? "FULL_EXTRACTION_REQUIRED" : "NOT_FOUND",
    { url: url.href }
  );
}

export { resolveBrand };
