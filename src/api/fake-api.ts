// An in-memory Taste Engine for command tests: the same TasteApi as the HTTP client, deterministic,
// recording each call as "METHOD /path". Jobs it creates move one status forward each time they are
// read, so a command's wait loop runs for real. Failures answer as the client would: a TasteApiError
// with the status and the API's code.
import { CliError } from "../output/errors.ts";
import { TasteApiError } from "./client.ts";
import type { TasteApi } from "./client.ts";
import type {
  AdherenceJob,
  AdherenceStatus,
  AdherenceVerdict,
  BrandSearchResults,
  EnhanceResponse,
  Me,
  SearchSubmission,
  SimilarBrandsResults,
  Submission,
  SubmissionManifest,
  SubmissionResult,
  SubmissionStatus,
} from "./schemas.ts";

type FakeState = {
  balance: number;
  me: Me;
  submissions: Submission[];
  results: Record<string, SubmissionResult>;
  manifests: Record<string, SubmissionManifest>;
  adherence: AdherenceJob[];
  verdicts: Record<string, AdherenceVerdict>;
  searches: SearchSubmission[];
  searchResults: BrandSearchResults;
  similarResults: SimilarBrandsResults;
  enhanced: EnhanceResponse;
  downloads: Record<string, Uint8Array>;
  // Thrown by the named method, after the call is recorded.
  errors: Partial<Record<keyof TasteApi, Error>>;
};
type FakeApi = TasteApi & { calls: string[] };

const NOW = "2026-10-26T10:00:00Z";
const SUBMISSION_STEPS: readonly SubmissionStatus[] = [
  "queued",
  "crawling",
  "extracting",
  "completed",
];
const ADHERENCE_STEPS: readonly AdherenceStatus[] = [
  "extracting",
  "judging",
  "completed",
];
const COST = 1;
const CARD = {
  url: "https://example.com/",
  brand_name: "Example",
  identity_paragraph: "A calm, precise brand with generous whitespace.",
  match: "strong" as const,
  tags: ["fintech"],
};

function defaults(): FakeState {
  return {
    balance: 100,
    me: {
      user_id: "00000000-0000-4000-8000-000000000001",
      email: "person@example.com",
      role: null,
    },
    submissions: [],
    results: {},
    manifests: {},
    adherence: [],
    verdicts: {},
    searches: [],
    searchResults: { search_id: "search-1", depth: "fast", results: [CARD] },
    similarResults: { results: [CARD] },
    enhanced: {
      enhanced_prompt:
        "Design a pricing page in Example's calm, precise style.",
      brand_name: "Example",
    },
    downloads: {},
    errors: {},
  };
}

const notFound = () =>
  new TasteApiError(404, { code: "NOT_FOUND", serverMessage: "Not found." });
const notReady = () =>
  new TasteApiError(409, { code: "NOT_READY", serverMessage: "Not ready." });

// Runs a method body so a thrown TasteApiError becomes a rejection, as it would from the client.
function later<T>(body: () => T | PromiseLike<T>): Promise<T> {
  return new Promise<T>((resolve) => resolve(body()));
}

function page<T>(items: T[], limit = 50, offset = 0) {
  return {
    items: items.slice(offset, offset + limit),
    total: items.length,
    limit,
    offset,
  };
}

function createFakeApi(overrides: Partial<FakeState> = {}): FakeApi {
  const state: FakeState = { ...defaults(), ...overrides };
  const calls: string[] = [];
  // Statuses each job created here still has to move through.
  const ahead = new Map<string, string[]>();
  let sequence = 0;

  function enter(name: keyof TasteApi, method: string, path: string): void {
    calls.push(`${method} ${path}`);
    const injected = state.errors[name];
    if (injected) throw injected;
  }

  function charge(): void {
    if (state.balance < COST)
      throw new TasteApiError(402, {
        code: "INSUFFICIENT_CREDITS",
        balance: state.balance,
        required: COST,
      });
    state.balance -= COST;
  }

  function advance(id: string): string | undefined {
    return ahead.get(id)?.shift();
  }

  function submission(id: string): Submission {
    const found = state.submissions.find((s) => s.submission_id === id);
    if (!found) throw notFound();
    return found;
  }

  function job(id: string): AdherenceJob {
    const found = state.adherence.find((j) => j.job_id === id);
    if (!found) throw notFound();
    return found;
  }

  function accept(source_url: string, kind: Submission["kind"]) {
    charge();
    sequence += 1;
    const created: Submission = {
      submission_id: `sub-${sequence}`,
      status: "accepted",
      source_url,
      is_public: false,
      kind,
      accepted_at: NOW,
    };
    state.submissions.unshift(created);
    ahead.set(created.submission_id, [...SUBMISSION_STEPS]);
    return {
      submission_id: created.submission_id,
      status: created.status,
      source_url,
      accepted_at: NOW,
    };
  }

  const api: FakeApi = {
    calls,

    me: () =>
      later(() => {
        enter("me", "GET", "/design/me");
        return state.me;
      }),

    createSubmission: (body) =>
      later(() => {
        enter("createSubmission", "POST", "/design/submissions");
        return accept(body.url, "website");
      }),

    createBrandKit: (file) =>
      later(() => {
        enter("createBrandKit", "POST", "/design/submissions/brand-kit");
        return accept(`file:${file.name}`, "brand_kit");
      }),

    listSubmissions: ({ limit, offset, q, status, kind }) =>
      later(() => {
        enter("listSubmissions", "GET", "/design/submissions");
        const matching = state.submissions.filter(
          (s) =>
            (status === undefined || s.status === status) &&
            (kind === undefined || s.kind === kind) &&
            (q === undefined || s.source_url.includes(q))
        );
        const { items, ...rest } = page(matching, limit, offset);
        return { submissions: items, ...rest };
      }),

    getSubmission: (id) =>
      later(() => {
        enter("getSubmission", "GET", `/design/submissions/${id}`);
        const found = submission(id);
        const next = advance(id);
        if (next) {
          found.status = next;
          found.current_step = next;
          if (next === "completed") found.completed_at = NOW;
        }
        return found;
      }),

    getResult: (id) =>
      later(() => {
        enter("getResult", "GET", `/design/submissions/${id}/result`);
        const found = submission(id);
        const seeded = state.results[id];
        if (seeded) return seeded;
        if (found.status !== "completed") return "not_ready";
        return {
          submission_id: id,
          status: "completed",
          source_url: found.source_url,
          extraction_id: `ext-${id}`,
          completed_at: NOW,
          result: {
            design_system: {
              profile: { brand_name: "Example", tagline: null },
            },
            artifacts: {},
          },
        };
      }),

    getManifest: (id) =>
      later(() => {
        enter("getManifest", "GET", `/design/submissions/${id}/download`);
        const found = submission(id);
        const seeded = state.manifests[id];
        if (seeded) return seeded;
        if (found.status !== "completed") throw notReady();
        return {
          submission_id: id,
          extraction_id: `ext-${id}`,
          files: [{ path: "guidelines.json", url: null, content: "{}" }],
        };
      }),

    setSubmissionVisibility: (id, isPublic) =>
      later(() => {
        enter(
          "setSubmissionVisibility",
          "PATCH",
          `/design/submissions/${id}/visibility`
        );
        const found = submission(id);
        found.is_public = isPublic;
        return found;
      }),

    enhance: (body) =>
      later(() => {
        enter("enhance", "POST", "/design/prompts/enhance");
        submission(body.submission_id);
        return state.enhanced;
      }),

    search: (body) =>
      later(() => {
        enter("search", "POST", "/search");
        charge();
        state.searches.unshift({
          id: `search-${state.searches.length + 1}`,
          kind: "search",
          query: body.query,
          status: "completed",
          created_at: NOW,
        });
        return state.searchResults;
      }),

    similar: (id) =>
      later(() => {
        enter("similar", "GET", "/search/similar");
        submission(id);
        charge();
        return state.similarResults;
      }),

    listSearches: ({ limit, offset, q, kind, status }) =>
      later(() => {
        enter("listSearches", "GET", "/search/submissions");
        const matching = state.searches.filter(
          (s) =>
            (kind === undefined || s.kind === kind) &&
            (status === undefined || s.status === status) &&
            (q === undefined || (s.query ?? "").includes(q))
        );
        const { items, ...rest } = page(matching, limit ?? 20, offset);
        return { submissions: items, ...rest };
      }),

    createAdherence: (body) =>
      later(() => {
        enter("createAdherence", "POST", "/judge/brand-adherence");
        charge();
        sequence += 1;
        const created: AdherenceJob = {
          job_id: `job-${sequence}`,
          status: "accepted",
          reference_url: body.reference_url,
          candidate_url: body.candidate_url,
          accepted_at: NOW,
          is_public: false,
        };
        state.adherence.unshift(created);
        ahead.set(created.job_id, [...ADHERENCE_STEPS]);
        return { ...created };
      }),

    listAdherence: ({ limit, offset, q, status }) =>
      later(() => {
        enter("listAdherence", "GET", "/judge/brand-adherence");
        const matching = state.adherence.filter(
          (j) =>
            (status === undefined || j.status === status) &&
            (q === undefined ||
              j.reference_url.includes(q) ||
              j.candidate_url.includes(q))
        );
        const { items, ...rest } = page(matching, limit, offset);
        return { jobs: items, ...rest };
      }),

    getAdherence: (id) =>
      later(() => {
        enter("getAdherence", "GET", `/judge/brand-adherence/${id}`);
        const found = job(id);
        const next = advance(id);
        if (next) {
          found.status = next;
          found.current_step = next;
          if (next === "completed") found.completed_at = NOW;
        }
        return found;
      }),

    getVerdict: (id) =>
      later(() => {
        enter("getVerdict", "GET", `/judge/brand-adherence/${id}/result`);
        const found = job(id);
        if (found.status === "failed")
          throw new TasteApiError(424, { code: "BRAND_ADHERENCE_FAILED" });
        const seeded = state.verdicts[id];
        if (seeded) return seeded;
        if (found.status !== "completed") return "not_ready";
        return {
          job_id: id,
          status: "completed",
          reference_url: found.reference_url,
          candidate_url: found.candidate_url,
          accepted_at: found.accepted_at,
          completed_at: NOW,
          score: 0.82,
          recommendations: ["Use the primary color for links."],
          fixes: [],
        };
      }),

    setAdherenceVisibility: (id, isPublic) =>
      later(() => {
        enter(
          "setAdherenceVisibility",
          "PATCH",
          `/judge/brand-adherence/${id}/visibility`
        );
        const found = job(id);
        found.is_public = isPublic;
        return found;
      }),

    download: (url) =>
      later(() => {
        enter("download", "GET", url);
        const bytes = state.downloads[url];
        if (!bytes)
          throw new CliError("DOWNLOAD_FAILED", {
            file: url.split("/").pop() ?? "",
            status: 404,
          });
        return bytes;
      }),
  };
  return api;
}

export { createFakeApi };
export type { FakeApi, FakeState };
