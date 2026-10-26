// A local stand-in for the Taste Engine, for demos and end-to-end tests: every endpoint taste-cli
// calls, answering from the fixtures (or synthetic data) with the API's own envelopes. A job moves
// one step every few seconds, so a wait loop sees accepted, the steps, then completed; in fast mode
// (tests) it moves one step per status read instead, and a result read shows the step it is on.
// Not an emulator: no real extraction, no persistence. Magic inputs: a URL on a .invalid host makes
// the job fail; --credits sets the balance that ends in a 402.
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { Envelope } from "../src/api/fixtures.ts";
import type { Library, Template } from "./mock-data.ts";

type MockOptions = {
  library: Library;
  fast?: boolean;
  credits?: number;
  now?: () => number;
};
type Job = {
  kind: "submission" | "adherence";
  view: Record<string, unknown>;
  template: Template;
  // -1 while still accepted, then the index of the step it is on.
  index: number;
  createdAt: number;
  selective: boolean;
};
type Search = Record<string, unknown>;
type Request = {
  method: string;
  url: URL;
  body: unknown;
  text: string;
  key: string;
};
type Mock = { url: string; close(): Promise<void> };

const KEY_PREFIX = "taste_mock";
const STEP_MS = 2500;
const COST = 1;
const DEFAULT_CREDITS = 1000;
const FAILED_REASON = "The site could not be reached.";
const UNAUTHORIZED: Envelope = {
  status: 401,
  body: {
    detail: {
      error: "UNAUTHORIZED",
      message: "Bearer token or X-API-Key required",
    },
  },
};
const NO_ROUTE: Envelope = { status: 404, body: { detail: "Not Found" } };

function refusal(status: number, error: string, message: string): Envelope {
  return { status, body: { detail: { error, message } } };
}

function isWebUrl(value: unknown): value is string {
  const url = typeof value === "string" ? URL.parse(value) : null;
  return url?.protocol === "https:" || url?.protocol === "http:";
}

function failing(url: string): boolean {
  return URL.parse(url)?.hostname.endsWith(".invalid") ?? false;
}

function page<T>(items: T[], url: URL, fallback: number) {
  const limit = Number(url.searchParams.get("limit") ?? fallback);
  const offset = Number(url.searchParams.get("offset") ?? 0);
  return {
    items: items.slice(offset, offset + limit),
    total: items.length,
    limit,
    offset,
  };
}

function createMockHandler(options: MockOptions) {
  const { library } = options;
  const now = options.now ?? Date.now;
  const stepMs = options.fast ? 0 : STEP_MS;
  let credits = options.credits ?? DEFAULT_CREDITS;
  let sequence = 0;
  const jobs = new Map<string, Job>();
  const searches: Search[] = [];
  const iso = () => new Date(now()).toISOString();

  function charge(): Envelope | undefined {
    if (credits < COST)
      return {
        status: 402,
        body: {
          detail: {
            error: "INSUFFICIENT_CREDITS",
            message: "Not enough credits.",
            balance: credits,
            required: COST,
          },
        },
      };
    credits -= COST;
    return undefined;
  }

  function create(
    kind: Job["kind"],
    fields: Record<string, unknown>,
    template: Template,
    selective = false
  ): Record<string, unknown> {
    sequence += 1;
    const prefix = kind === "submission" ? "1" : "2";
    const id = `${prefix}0000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
    const view = {
      [kind === "submission" ? "submission_id" : "job_id"]: id,
      status: "accepted",
      ...fields,
      is_public: false,
      current_step: null,
      accepted_at: iso(),
      updated_at: iso(),
      completed_at: null,
      error: null,
      api_key_name: "mock",
      ...(kind === "submission" ? { credits_consumed: COST } : {}),
    };
    jobs.set(id, {
      kind,
      view,
      template,
      index: -1,
      createdAt: now(),
      selective,
    });
    return view;
  }

  function advance(job: Job, statusRead: boolean): void {
    const target = stepMs
      ? Math.floor((now() - job.createdAt) / stepMs) - 1
      : job.index + (statusRead ? 1 : 0);
    for (;;) {
      const step = job.template.steps[job.index + 1];
      if (!step || job.index >= target) return;
      job.index += 1;
      job.view.status = step.status;
      job.view.current_step = step.current_step ?? null;
      job.view.updated_at = iso();
      if (step.status === "completed") job.view.completed_at = iso();
      if (step.status === "failed") job.view.error = FAILED_REASON;
    }
  }

  function find(kind: Job["kind"], id: string): Job | undefined {
    const job = jobs.get(id);
    return job?.kind === kind ? job : undefined;
  }

  // The fields that tie a recorded answer to this job, laid over it.
  function own(job: Job): Record<string, unknown> {
    const { view } = job;
    const keys =
      job.kind === "submission"
        ? ["submission_id", "source_url", "sections"]
        : ["job_id", "reference_url", "candidate_url"];
    const fields: Record<string, unknown> = {};
    for (const key of [
      ...keys,
      "status",
      "current_step",
      "accepted_at",
      "completed_at",
      "is_public",
    ])
      if (key in view) fields[key] = view[key];
    return fields;
  }

  function result(job: Job): Envelope {
    advance(job, false);
    const status = job.view.status;
    if (status === "failed")
      return job.kind === "adherence"
        ? refusal(424, "BRAND_ADHERENCE_FAILED", "Brand adherence job failed")
        : { status: 200, body: { ...job.view } };
    if (status === "completed")
      return { status: 200, body: { ...job.template.final, ...own(job) } };
    if (job.index < Math.floor(job.template.steps.length / 2))
      return job.template.notReady;
    return { status: 200, body: { ...job.template.partial, ...own(job) } };
  }

  function views(kind: Job["kind"], request: Request) {
    const status = request.url.searchParams.get("status");
    const q = request.url.searchParams.get("q");
    return [...jobs.values()]
      .filter(
        (job) =>
          job.kind === kind &&
          (!status || job.view.status === status) &&
          (!q || JSON.stringify(job.view).includes(q))
      )
      .map((job) => job.view)
      .reverse();
  }

  function submissions(
    request: Request,
    id?: string,
    action?: string
  ): Envelope {
    const { method } = request;
    if (id === undefined) {
      if (method === "GET") {
        const kind = request.url.searchParams.get("kind");
        const matching = views("submission", request).filter(
          (view) => !kind || view.kind === kind
        );
        const { items, ...rest } = page(matching, request.url, 50);
        return { status: 200, body: { submissions: items, ...rest } };
      }
      const body = (request.body ?? {}) as Record<string, unknown>;
      if (!isWebUrl(body.url)) return library.invalidUrl;
      const sections = Array.isArray(body.sections) ? body.sections : null;
      const template = failing(body.url)
        ? library.failedExtraction
        : library.extraction(body.url, sections !== null);
      return (
        charge() ?? {
          status: 202,
          body: create(
            "submission",
            { source_url: body.url, kind: "website", sections },
            template,
            sections !== null
          ),
        }
      );
    }
    if (id === "brand-kit" && method === "POST") {
      const name =
        /filename="([^"]+)"/.exec(request.text)?.[1] ?? "brand-kit.pdf";
      return (
        charge() ?? {
          status: 202,
          body: create(
            "submission",
            { source_url: name, kind: "brand_kit" },
            library.kit
          ),
        }
      );
    }
    const job = find("submission", id);
    if (!job) return library.notFound;
    if (action === undefined) {
      advance(job, true);
      return { status: 200, body: job.view };
    }
    if (action === "result") return result(job);
    if (action === "download")
      return job.view.status === "completed"
        ? {
            status: 200,
            body: {
              ...library.manifest,
              submission_id: id,
              extraction_id: `ext-${id}`,
            },
          }
        : refusal(409, "NOT_READY", "Submission is extracting");
    if (action === "visibility" && method === "PATCH")
      return visibility(job, request);
    return NO_ROUTE;
  }

  function visibility(job: Job, request: Request): Envelope {
    const isPublic = (request.body as { is_public?: unknown } | null)
      ?.is_public;
    if (typeof isPublic !== "boolean") return library.invalidUrl;
    job.view.is_public = isPublic;
    return { status: 200, body: job.view };
  }

  function adherence(request: Request, id?: string, action?: string): Envelope {
    if (id === undefined) {
      if (request.method === "GET") {
        const { items, ...rest } = page(
          views("adherence", request),
          request.url,
          50
        );
        return { status: 200, body: { jobs: items, ...rest } };
      }
      const body = (request.body ?? {}) as Record<string, unknown>;
      const { reference_url: reference, candidate_url: candidate } = body;
      if (!isWebUrl(reference) || !isWebUrl(candidate))
        return library.invalidUrl;
      const sameSite =
        URL.parse(reference)?.hostname === URL.parse(candidate)?.hostname;
      const template = failing(candidate)
        ? library.failedCheck
        : library.check(sameSite);
      return (
        charge() ?? {
          status: 202,
          body: create(
            "adherence",
            { reference_url: reference, candidate_url: candidate },
            template
          ),
        }
      );
    }
    const job = find("adherence", id);
    if (!job) return refusal(404, "NOT_FOUND", "Brand adherence job not found");
    if (action === undefined) {
      advance(job, true);
      return { status: 200, body: job.view };
    }
    if (action === "result") return result(job);
    if (action === "visibility" && request.method === "PATCH")
      return visibility(job, request);
    return NO_ROUTE;
  }

  function remember(kind: string, fields: Record<string, unknown>): void {
    searches.unshift({
      id: `30000000-0000-4000-8000-${String(searches.length + 1).padStart(12, "0")}`,
      kind,
      status: "completed",
      result_count: 1,
      credits_consumed: COST,
      created_at: iso(),
      completed_at: iso(),
      ...fields,
    });
  }

  function search(request: Request, action?: string): Envelope {
    if (action === undefined && request.method === "POST") {
      const body = (request.body ?? {}) as Record<string, unknown>;
      if (typeof body.query !== "string" || !body.query.trim())
        return {
          status: 422,
          body: {
            detail: [
              {
                loc: ["body", "query"],
                msg: "Field required",
                type: "missing",
              },
            ],
          },
        };
      const depth = body.depth === "deep" ? "deep" : "fast";
      const refused = charge();
      if (refused) return refused;
      remember("search", { query: body.query, depth });
      return { status: 200, body: library.search(depth) };
    }
    if (action === "similar" && request.method === "GET") {
      const id = request.url.searchParams.get("submission_id") ?? "";
      const job = find("submission", id);
      if (!job) return library.notFound;
      if (job.selective || job.view.status !== "completed")
        return library.fullExtractionRequired;
      const refused = charge();
      if (refused) return refused;
      remember("similar", { query: job.view.source_url });
      return { status: 200, body: library.similar };
    }
    if (action === "submissions" && request.method === "GET") {
      const kind = request.url.searchParams.get("kind");
      const matching = searches.filter((s) => !kind || s.kind === kind);
      const { items, ...rest } = page(matching, request.url, 20);
      return { status: 200, body: { submissions: items, ...rest } };
    }
    return NO_ROUTE;
  }

  function enhance(request: Request): Envelope {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const id = body.submission_id;
    if (typeof id !== "string" || !find("submission", id))
      return library.notFound;
    return charge() ?? { status: 200, body: library.enhanced };
  }

  return function handle(request: Request): Envelope {
    if (!request.key.startsWith(KEY_PREFIX)) return UNAUTHORIZED;
    const parts = request.url.pathname.split("/").filter(Boolean);
    const [area, resource, id, action] = parts.map(decodeURIComponent);
    const { method } = request;
    if (area === "design" && resource === "me" && method === "GET")
      return { status: 200, body: library.me };
    if (area === "design" && resource === "submissions")
      return submissions(request, id, action);
    if (area === "design" && resource === "prompts" && id === "enhance")
      return enhance(request);
    if (area === "search") return search(request, resource);
    if (area === "judge" && resource === "brand-adherence")
      return adherence(request, id, action);
    return NO_ROUTE;
  };
}

async function read(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function startMock(options: MockOptions & { port?: number }): Promise<Mock> {
  const handle = createMockHandler(options);
  const server = createServer(
    (request: IncomingMessage, response: ServerResponse) => {
      void read(request)
        .then((text) => {
          const answer = handle({
            method: request.method ?? "GET",
            url: new URL(request.url ?? "/", "http://127.0.0.1"),
            body: parseJson(text),
            text,
            key: String(request.headers["x-api-key"] ?? ""),
          });
          response.writeHead(answer.status, {
            "content-type": "application/json",
          });
          response.end(JSON.stringify(answer.body));
        })
        // A body that never arrives whole, or a bug here: the API's plain-text
        // 500, and the mock keeps serving.
        .catch(() => {
          if (!response.headersSent)
            response.writeHead(500, { "content-type": "text/plain" });
          response.end("Internal Server Error");
        });
    }
  );
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}

export { createMockHandler, KEY_PREFIX, startMock };
export type { Mock, MockOptions };
