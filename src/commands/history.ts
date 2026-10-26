// taste history [extractions|checks|searches]: one page of a list, newest first, as Taste keeps it.
// Free: it only reads. --json passes the API's list through unchanged; a person gets a table, and for
// checks each one's score, which the list doesn't carry, read from its verdict.
import type { z } from "zod";

import { TasteApiError } from "../api/client.ts";
import type { TasteApi } from "../api/client.ts";
import {
  ADHERENCE_STATUS,
  SEARCH_STATUS,
  SUBMISSION_STATUS,
} from "../api/schemas.ts";
import type {
  AdherenceJobList,
  SearchSubmissionList,
  SubmissionList,
} from "../api/schemas.ts";
import type { Context } from "../context.ts";
import { CliError } from "../output/errors.ts";
import type { Theme } from "../output/theme.ts";
import { mapLimit } from "../pool.ts";
import { renderTable } from "../render/table.ts";

type HistoryList = (typeof HISTORY_LISTS)[number];
type HistoryOptions = {
  status?: string;
  search?: string;
  limit: number;
  offset: number;
};
type Page = { rows: string[][]; shown: number; total?: number };

const HISTORY_LISTS = ["extractions", "checks", "searches"] as const;
const HEADERS: Record<HistoryList, string[]> = {
  extractions: ["id", "when (UTC)", "status", "address"],
  checks: ["id", "when (UTC)", "status", "score", "candidate"],
  searches: ["id", "when (UTC)", "status", "query"],
};
// The verdict reads behind the checks' scores, at most this many at once.
const SCORE_READS = 4;

// "2026-10-26T10:03:00Z" as "2026-10-26 10:03", in UTC; anything unreadable as it came.
function when(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().slice(0, 16).replace("T", " ");
}

function parseStatus<T extends string>(
  schema: z.ZodType<T>,
  status: string | undefined
): T | undefined {
  if (status === undefined) return undefined;
  const parsed = schema.safeParse(status);
  if (!parsed.success)
    throw new CliError("USAGE_INVALID_VALUE", { option: "--status" });
  return parsed.data;
}

// What went wrong, in words safe for --debug: the class and, for the API's errors, the status or code.
function failure(error: unknown): string {
  if (error instanceof CliError) return error.code;
  if (error instanceof TasteApiError) return `${error.name} ${error.status}`;
  return error instanceof Error ? error.constructor.name : typeof error;
}

// A score that can't be read leaves its cell empty rather than losing the whole list; Ctrl-C still
// ends it.
async function scores(
  ctx: Context,
  api: TasteApi,
  list: AdherenceJobList
): Promise<string[]> {
  return mapLimit(list.jobs, SCORE_READS, async (job) => {
    if (job.status !== "completed") return "";
    try {
      const verdict = await api.getVerdict(job.job_id);
      return verdict === "not_ready" || verdict.score === null
        ? ""
        : verdict.score.toFixed(2);
    } catch (error) {
      if (ctx.signal.aborted) throw error;
      ctx.output.debug(
        `couldn't read the score of ${job.job_id} (${failure(error)})`
      );
      return "";
    }
  });
}

function submissionRows(list: SubmissionList): Page {
  return {
    rows: list.submissions.map((s) => [
      s.submission_id,
      when(s.accepted_at),
      s.status,
      s.source_url,
    ]),
    shown: list.submissions.length,
    total: list.total,
  };
}

async function checkRows(
  ctx: Context,
  api: TasteApi,
  list: AdherenceJobList
): Promise<Page> {
  const score = await scores(ctx, api, list);
  return {
    rows: list.jobs.map((job, i) => [
      job.job_id,
      when(job.accepted_at),
      job.status,
      score[i] ?? "",
      job.candidate_url,
    ]),
    shown: list.jobs.length,
    total: list.total,
  };
}

function searchRows(list: SearchSubmissionList): Page {
  return {
    rows: list.submissions.map((s) => [
      s.id,
      when(s.created_at),
      s.status ?? "",
      s.query ?? "",
    ]),
    shown: list.submissions.length,
    total: list.total,
  };
}

function render(
  ctx: Context,
  list: HistoryList,
  page: Page,
  options: HistoryOptions,
  theme: Theme
): string {
  if (page.rows.length === 0)
    return options.offset > 0 ? `No more ${list}.` : `No ${list} found.`;
  const table = renderTable(HEADERS[list], page.rows, {
    theme,
    width: ctx.terminal?.tty ? ctx.terminal.width || undefined : undefined,
  });
  const end = options.offset + page.shown;
  if (page.total === undefined || end >= page.total) return table;
  return `${table}\n\n${theme.dim(`${page.shown} of ${page.total}. More with --offset ${end}.`)}`;
}

// The list as the API sent it, and how to lay it out for a person (only built without --json).
async function fetchList(
  ctx: Context,
  list: HistoryList,
  options: HistoryOptions
): Promise<{ data: unknown; page: () => Promise<Page> }> {
  const filter = {
    limit: options.limit,
    offset: options.offset,
    ...(options.search === undefined ? {} : { q: options.search }),
  };
  const api = ctx.api();
  if (list === "extractions") {
    const status = parseStatus(SUBMISSION_STATUS, options.status);
    const data = await api.listSubmissions({ ...filter, status });
    return { data, page: () => Promise.resolve(submissionRows(data)) };
  }
  if (list === "searches") {
    const status = parseStatus(SEARCH_STATUS, options.status);
    const data = await api.listSearches({ ...filter, status });
    return { data, page: () => Promise.resolve(searchRows(data)) };
  }
  const status = parseStatus(ADHERENCE_STATUS, options.status);
  const data = await api.listAdherence({ ...filter, status });
  return { data, page: () => checkRows(ctx, api, data) };
}

async function history(
  ctx: Context,
  list: HistoryList,
  options: HistoryOptions
): Promise<void> {
  const { data, page } = await fetchList(ctx, list, options);
  if (ctx.output.json) {
    ctx.output.result(data, () => "");
    return;
  }
  const rows = await page();
  ctx.output.result(data, (theme) => render(ctx, list, rows, options, theme));
}

export { history, HISTORY_LISTS };
export type { HistoryList, HistoryOptions };
