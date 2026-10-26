// The one way taste-cli talks to the Taste Engine. Every answer is parsed with zod; a server error
// becomes a TasteApiError that output/errors.ts maps to a catalogue entry, so the server's own words
// never reach a person (they stay on serverMessage, for --debug). This module never prints.
import { z } from "zod";

import pkg from "../../package.json" with { type: "json" };
import { CliError } from "../output/errors.ts";
import {
  ADHERENCE_ACCEPTED,
  ADHERENCE_JOB,
  ADHERENCE_JOB_LIST,
  ADHERENCE_VERDICT,
  BRAND_SEARCH_RESULTS,
  ENHANCE_RESPONSE,
  ME,
  SEARCH_SUBMISSION_LIST,
  SIMILAR_BRANDS_RESULTS,
  SUBMISSION,
  SUBMISSION_ACCEPTED,
  SUBMISSION_LIST,
  SUBMISSION_MANIFEST,
  SUBMISSION_RESULT,
} from "./schemas.ts";
import type {
  AdherenceAccepted,
  AdherenceJob,
  AdherenceJobList,
  AdherenceStatus,
  AdherenceVerdict,
  BrandKitSectionName,
  BrandSearchRequest,
  BrandSearchResults,
  EnhanceResponse,
  Me,
  SearchSubmissionList,
  SectionName,
  SimilarBrandsResults,
  Submission,
  SubmissionAccepted,
  SubmissionCreate,
  SubmissionKind,
  SubmissionList,
  SubmissionManifest,
  SubmissionResult,
  SubmissionStatus,
} from "./schemas.ts";

type AuthProvider = {
  // Either { "x-api-key": … } or { authorization: "Bearer …" }; the client sends whichever it gets.
  header(): Promise<Record<string, string>>;
  // Called once on a 401; true means there is a fresh credential worth one more try.
  onUnauthorized(): Promise<boolean>;
};
type ListQuery = { limit?: number; offset?: number; q?: string };
type TasteApi = {
  me(): Promise<Me>;
  createSubmission(
    body: SubmissionCreate,
    query?: { map?: boolean; maxUrls?: number }
  ): Promise<SubmissionAccepted>;
  createBrandKit(file: {
    name: string;
    bytes: Uint8Array;
  }): Promise<SubmissionAccepted>;
  listSubmissions(
    q: ListQuery & { status?: SubmissionStatus; kind?: SubmissionKind }
  ): Promise<SubmissionList>;
  getSubmission(id: string): Promise<Submission>;
  getResult(
    id: string,
    sections?: (SectionName | BrandKitSectionName)[]
  ): Promise<SubmissionResult | "not_ready">;
  getManifest(id: string): Promise<SubmissionManifest>;
  setSubmissionVisibility(id: string, isPublic: boolean): Promise<Submission>;
  enhance(body: {
    submission_id: string;
    prompt: string;
  }): Promise<EnhanceResponse>;
  search(body: BrandSearchRequest): Promise<BrandSearchResults>;
  similar(id: string, topK?: number): Promise<SimilarBrandsResults>;
  listSearches(
    q: ListQuery & { kind?: "search" | "similar" }
  ): Promise<SearchSubmissionList>;
  createAdherence(body: {
    reference_url: string;
    candidate_url: string;
  }): Promise<AdherenceAccepted>;
  listAdherence(
    q: ListQuery & { status?: AdherenceStatus }
  ): Promise<AdherenceJobList>;
  getAdherence(id: string): Promise<AdherenceJob>;
  getVerdict(id: string): Promise<AdherenceVerdict | "not_ready">;
  setAdherenceVisibility(id: string, isPublic: boolean): Promise<AdherenceJob>;
  // A manifest's asset URL: https only, and never with the Taste credential.
  download(url: string): Promise<Uint8Array>;
};
type Deps = {
  fetch: typeof globalThis.fetch;
  baseUrl: string;
  auth: AuthProvider;
  sleep: (ms: number) => Promise<void>;
};
type Query = Readonly<Record<string, string | number | boolean | undefined>>;
// "read": free and safe to repeat, retried on a network failure or 5xx. "once": spends credits or
// changes something, and a failed send may still have reached the server, so it is never repeated.
// "busy": sent once, except that search's 503 means it was turned away before any work and is retried.
type Retry = "read" | "once" | "busy";
type Exchange = {
  url: URL;
  method: string;
  retry: Retry;
  authenticated: boolean;
  json?: unknown;
  form?: FormData;
  timeoutMs?: number;
};
type Answer = { status: number; headers: Headers; bytes: Uint8Array };
type ApiErrorFields = {
  code?: string;
  balance?: number;
  required?: number;
  retryAfterMs?: number;
  serverMessage?: string;
};

const USER_AGENT = `taste-cli/${pkg.version} (unofficial)`;
const TIMEOUT_MS = 30_000;
// Uploads and asset downloads move more bytes than an API answer.
const LONG_TIMEOUT_MS = 120_000;
const ATTEMPTS = 3;
const BACKOFF_MS = 500;
const MAX_RETRY_AFTER_MS = 30_000;
const SERVER_MESSAGE_LIMIT = 500;
// The three error envelopes Taste sends: an object detail ({error, message, and on a 402 balance and
// required}), a validation list ([{loc, msg, type}]) and a plain string (search 502/503).
const ERROR_BODY = z.object({
  detail: z.union([
    z.string(),
    z.array(z.looseObject({ msg: z.string().optional().catch(undefined) })),
    z.looseObject({
      error: z.string().optional().catch(undefined),
      message: z.string().optional().catch(undefined),
      balance: z.number().optional().catch(undefined),
      required: z.number().optional().catch(undefined),
    }),
  ]),
});

class TasteApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly balance?: number;
  readonly required?: number;
  readonly retryAfterMs?: number;
  // The server's own words, kept for --debug only; output/errors.ts never shows them.
  readonly serverMessage?: string;

  constructor(status: number, fields: ApiErrorFields = {}) {
    super(`The Taste Engine answered ${status}.`);
    this.name = "TasteApiError";
    this.status = status;
    this.code = fields.code;
    this.balance = fields.balance;
    this.required = fields.required;
    this.retryAfterMs = fields.retryAfterMs;
    this.serverMessage = fields.serverMessage;
  }
}

function retryAfterMs(headers: Headers): number | undefined {
  const value = headers.get("retry-after")?.trim() ?? "";
  // Seconds only; an HTTP date falls back to the usual backoff.
  if (!/^\d{1,6}$/.test(value)) return undefined;
  return Math.min(Number(value) * 1000, MAX_RETRY_AFTER_MS);
}

function decodeJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return undefined;
  }
}

function toApiError({ status, headers, bytes }: Answer): TasteApiError {
  const fields: ApiErrorFields = { retryAfterMs: retryAfterMs(headers) };
  const parsed = ERROR_BODY.safeParse(decodeJson(bytes));
  const detail = parsed.success ? parsed.data.detail : undefined;
  if (typeof detail === "string") fields.serverMessage = detail;
  else if (Array.isArray(detail)) fields.serverMessage = detail[0]?.msg;
  else if (detail) {
    fields.code = detail.error;
    fields.serverMessage = detail.message;
    fields.balance = detail.balance;
    fields.required = detail.required;
  } else fields.serverMessage = new TextDecoder().decode(bytes) || undefined;
  fields.serverMessage = fields.serverMessage?.slice(0, SERVER_MESSAGE_LIMIT);
  return new TasteApiError(status, fields);
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success)
    throw new CliError("INTERNAL", {}, { cause: parsed.error });
  return parsed.data;
}

function shouldRetry(retry: Retry, status: number): boolean {
  if (retry === "read") return status >= 500;
  return retry === "busy" && status === 503;
}

function createTasteApi(deps: Deps): TasteApi {
  const { auth, sleep } = deps;

  function endpoint(path: string, query: Query = {}): URL {
    const url = new URL(path, deps.baseUrl);
    for (const [name, value] of Object.entries(query))
      if (value !== undefined) url.searchParams.set(name, String(value));
    return url;
  }

  async function send(
    x: Exchange,
    credential: Record<string, string>
  ): Promise<Answer> {
    const headers: Record<string, string> = {
      "user-agent": USER_AGENT,
      ...(x.authenticated ? { accept: "application/json" } : {}),
      ...(x.json === undefined ? {} : { "content-type": "application/json" }),
      ...credential,
    };
    const response = await deps.fetch(x.url, {
      method: x.method,
      headers,
      body:
        x.form ?? (x.json === undefined ? undefined : JSON.stringify(x.json)),
      // A redirect would carry an x-api-key header to another host, so the API gets none. Asset
      // downloads carry no credential and may follow a CDN's redirects.
      redirect: x.authenticated ? "error" : "follow",
      signal: AbortSignal.timeout(x.timeoutMs ?? TIMEOUT_MS),
    });
    // The timeout covers the body too; a stalled or dropped body is the network's failure.
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!x.authenticated && response.url && !response.url.startsWith("https:"))
      throw new CliError("INVALID_URL");
    return { status: response.status, headers: response.headers, bytes };
  }

  // Sends with retries per x.retry and one re-try after a refreshed credential; returns the last
  // answer, which may be an error status for the caller to read.
  async function exchange(x: Exchange): Promise<Answer> {
    let refreshed = false;
    for (let attempt = 1; ; attempt += 1) {
      // Outside the try: a credential problem is the auth layer's error, never a network one.
      const credential = x.authenticated ? await auth.header() : {};
      let answer: Answer;
      try {
        answer = await send(x, credential);
      } catch (error) {
        if (error instanceof CliError) throw error;
        if (x.retry === "read" && attempt < ATTEMPTS) {
          await sleep(BACKOFF_MS * 2 ** (attempt - 1));
          continue;
        }
        throw new CliError("NETWORK", {}, { cause: error });
      }
      if (answer.status === 401 && x.authenticated && !refreshed) {
        refreshed = true;
        if (await auth.onUnauthorized()) {
          attempt -= 1;
          continue;
        }
      }
      if (attempt < ATTEMPTS && shouldRetry(x.retry, answer.status)) {
        await sleep(
          retryAfterMs(answer.headers) ?? BACKOFF_MS * 2 ** (attempt - 1)
        );
        continue;
      }
      return answer;
    }
  }

  async function call<T>(schema: z.ZodType<T>, x: Exchange): Promise<T> {
    const answer = await exchange(x);
    if (answer.status < 200 || answer.status >= 300) {
      if (x.retry === "busy" && answer.status === 503)
        throw new CliError("SEARCH_BUSY");
      throw toApiError(answer);
    }
    return parse(schema, decodeJson(answer.bytes));
  }

  // Result endpoints answer 409 NOT_READY until the first checkpoint lands: keep polling.
  async function callUnlessNotReady<T>(
    schema: z.ZodType<T>,
    x: Exchange
  ): Promise<T | "not_ready"> {
    try {
      return await call(schema, x);
    } catch (error) {
      if (
        error instanceof TasteApiError &&
        error.status === 409 &&
        (error.code === undefined || error.code === "NOT_READY")
      )
        return "not_ready";
      throw error;
    }
  }

  const get = (url: URL, retry: Retry = "read"): Exchange => ({
    url,
    method: "GET",
    retry,
    authenticated: true,
  });
  const write = (method: string, url: URL, json: unknown): Exchange => ({
    url,
    method,
    retry: "once",
    authenticated: true,
    json,
  });
  const id = encodeURIComponent;

  return {
    me: () => call(ME, get(endpoint("/design/me"))),

    createSubmission: (body, query = {}) =>
      call(
        SUBMISSION_ACCEPTED,
        write(
          "POST",
          endpoint("/design/submissions", {
            map: query.map,
            max_urls: query.maxUrls,
          }),
          body
        )
      ),

    createBrandKit({ name, bytes }) {
      const form = new FormData();
      form.set(
        "file",
        new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
        name
      );
      return call(SUBMISSION_ACCEPTED, {
        url: endpoint("/design/submissions/brand-kit"),
        method: "POST",
        retry: "once",
        authenticated: true,
        form,
        timeoutMs: LONG_TIMEOUT_MS,
      });
    },

    listSubmissions: ({ limit, offset, q, status, kind }) =>
      call(
        SUBMISSION_LIST,
        get(endpoint("/design/submissions", { limit, offset, q, status, kind }))
      ),

    getSubmission: (submissionId) =>
      call(
        SUBMISSION,
        get(endpoint(`/design/submissions/${id(submissionId)}`))
      ),

    getResult: (submissionId, sections) =>
      callUnlessNotReady(
        SUBMISSION_RESULT,
        get(
          // One comma-separated parameter: the API drops repeated ones.
          endpoint(`/design/submissions/${id(submissionId)}/result`, {
            sections: sections?.length ? sections.join(",") : undefined,
          })
        )
      ),

    getManifest: (submissionId) =>
      call(
        SUBMISSION_MANIFEST,
        get(endpoint(`/design/submissions/${id(submissionId)}/download`))
      ),

    setSubmissionVisibility: (submissionId, isPublic) =>
      call(
        SUBMISSION,
        write(
          "PATCH",
          endpoint(`/design/submissions/${id(submissionId)}/visibility`),
          { is_public: isPublic }
        )
      ),

    enhance: (body) =>
      call(
        ENHANCE_RESPONSE,
        write("POST", endpoint("/design/prompts/enhance"), body)
      ),

    search: (body) =>
      call(BRAND_SEARCH_RESULTS, {
        ...write("POST", endpoint("/search"), body),
        retry: "busy",
      }),

    // A GET, but it spends credits, so it is sent once like a paid POST.
    similar: (submissionId, topK) =>
      call(
        SIMILAR_BRANDS_RESULTS,
        get(
          endpoint("/search/similar", {
            submission_id: submissionId,
            top_k: topK,
          }),
          "once"
        )
      ),

    listSearches: ({ limit, offset, q, kind }) =>
      call(
        SEARCH_SUBMISSION_LIST,
        get(endpoint("/search/submissions", { limit, offset, q, kind }))
      ),

    createAdherence: (body) =>
      call(
        ADHERENCE_ACCEPTED,
        write("POST", endpoint("/judge/brand-adherence"), body)
      ),

    listAdherence: ({ limit, offset, q, status }) =>
      call(
        ADHERENCE_JOB_LIST,
        get(endpoint("/judge/brand-adherence", { limit, offset, q, status }))
      ),

    getAdherence: (jobId) =>
      call(ADHERENCE_JOB, get(endpoint(`/judge/brand-adherence/${id(jobId)}`))),

    getVerdict: (jobId) =>
      callUnlessNotReady(
        ADHERENCE_VERDICT,
        get(endpoint(`/judge/brand-adherence/${id(jobId)}/result`))
      ),

    setAdherenceVisibility: (jobId, isPublic) =>
      call(
        ADHERENCE_JOB,
        write(
          "PATCH",
          endpoint(`/judge/brand-adherence/${id(jobId)}/visibility`),
          { is_public: isPublic }
        )
      ),

    async download(url) {
      if (!URL.canParse(url) || new URL(url).protocol !== "https:")
        throw new CliError("INVALID_URL");
      const answer = await exchange({
        url: new URL(url),
        method: "GET",
        retry: "read",
        authenticated: false,
        timeoutMs: LONG_TIMEOUT_MS,
      });
      if (answer.status < 200 || answer.status >= 300)
        throw new TasteApiError(answer.status);
      return answer.bytes;
    },
  };
}

export { createTasteApi, TasteApiError };
export type { AuthProvider, ListQuery, TasteApi };
