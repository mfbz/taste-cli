// The recordings taste-cli's fixtures come from, one recipe each, run by scripts/record-fixtures.ts with
// the CLI's own client. A recipe is data (its name, whether it spends credits, what it calls, its
// inputs) plus the few lines that make those calls. Every response is captured raw on the way in, so
// a 409 or a refusal is kept as the exact envelope the API sent.
import { TasteApiError } from "../src/api/client.ts";
import type { TasteApi } from "../src/api/client.ts";
import type { Envelope, Step } from "../src/api/fixtures.ts";
import { jobCheck, waitForJob } from "../src/api/poll.ts";
import type { SubmissionAccepted } from "../src/api/schemas.ts";

type Exchange = { method: string; path: string; status: number; body: unknown };
type Capture = { fetch: typeof globalThis.fetch; exchanges: Exchange[] };
type Kit = { name: string; bytes: Uint8Array };
type RunContext = {
  api: TasteApi;
  exchanges: Exchange[];
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  now: () => number;
  signal: AbortSignal;
  log: (line: string) => void;
  // The id of the recording this recipe builds on (Recipe.needs), or one given with --id.
  id?: string;
  kit?: Kit;
};
type Recorded = { steps: Step[]; data: Record<string, unknown> };
type Recipe = {
  name: string;
  paid: boolean;
  calls: string;
  inputs: Readonly<Record<string, string>>;
  // A recipe whose recording gives this one its id.
  needs?: string;
  run(c: RunContext): Promise<Recorded>;
};
type Recording = {
  recipe: string;
  paid: boolean;
  calls: string[];
  steps: Step[];
  data: Record<string, unknown>;
};

// Long jobs (a deep analysis, a brand kit) can take many minutes; waitForJob backs off meanwhile.
const WAIT_MS = 20 * 60_000;
const QUERY = "dark brutalist developer tools";
const MISSING_ID = "00000000-0000-4000-8000-00000000f404";

function capture(fetch: typeof globalThis.fetch): Capture {
  const exchanges: Exchange[] = [];
  return {
    exchanges,
    fetch: async (input, init) => {
      const response = await fetch(input, init);
      const url = new URL(
        input instanceof Request ? input.url : input.toString()
      );
      const text = await response.clone().text();
      let body: unknown = text;
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        // Not JSON (a plain-text 500): kept as text.
      }
      exchanges.push({
        method: init?.method ?? "GET",
        path: `${url.pathname}${url.search}`,
        status: response.status,
        body,
      });
      return response;
    },
  };
}

function noteStep(
  steps: Step[],
  job: { status: string; current_step?: string | null }
) {
  const last = steps.at(-1);
  const step = { status: job.status, current_step: job.current_step ?? null };
  if (last?.status !== step.status || last.current_step !== step.current_step)
    steps.push(step);
}

// The first answer on a result path that matches: the 409 before the first checkpoint, or the first
// partial 200 while the job still runs.
function firstAnswer(
  c: RunContext,
  id: string,
  match: (e: Exchange) => boolean
): Envelope | undefined {
  const found = c.exchanges.find(
    (e) => e.path.includes(`/${id}/result`) && match(e)
  );
  return found && { status: found.status, body: found.body };
}

function isPartial(e: Exchange): boolean {
  const status = (e.body as { status?: unknown } | null)?.status;
  return e.status === 200 && status !== "completed";
}

async function wait<
  T extends {
    status: string;
    current_step?: string | null;
    error?: string | null;
  },
>(
  c: RunContext,
  id: string,
  read: () => Promise<T>,
  peek: () => Promise<unknown>
): Promise<{ job: T; steps: Step[] }> {
  const steps: Step[] = [];
  const job = await waitForJob<T>({
    id,
    timeoutMs: WAIT_MS,
    sleep: c.sleep,
    now: c.now,
    signal: c.signal,
    onStep: (step, ms) => c.log(`  ${Math.round(ms / 1000)}s  ${step}`),
    check: async () => {
      const job = await read();
      noteStep(steps, job);
      // Free: reading the result while the job runs records the 409 and a partial answer.
      if (job.status !== "completed" && job.status !== "failed") await peek();
      return jobCheck(job, job);
    },
  });
  return { job, steps };
}

async function extraction(
  c: RunContext,
  accepted: SubmissionAccepted
): Promise<Recorded> {
  const id = accepted.submission_id;
  c.log(`Submission ${id}`);
  const { job, steps } = await wait(
    c,
    id,
    () => c.api.getSubmission(id),
    () => c.api.getResult(id)
  );
  return {
    steps,
    data: {
      accepted,
      submission: job,
      not_ready: firstAnswer(c, id, (e) => e.status === 409),
      partial: firstAnswer(c, id, isPartial),
      result: await c.api.getResult(id),
    },
  };
}

async function check(
  c: RunContext,
  reference: string,
  candidate: string
): Promise<Recorded> {
  const accepted = await c.api.createAdherence({
    reference_url: reference,
    candidate_url: candidate,
  });
  const id = accepted.job_id;
  c.log(`Job ${id}`);
  const { job, steps } = await wait(
    c,
    id,
    () => c.api.getAdherence(id),
    () => c.api.getVerdict(id)
  );
  return {
    steps,
    data: {
      accepted,
      job,
      not_ready: firstAnswer(c, id, (e) => e.status === 409),
      partial: firstAnswer(c, id, isPartial),
      verdict: await c.api.getVerdict(id),
    },
  };
}

// A call the API must refuse: its status and the exact envelope it sent.
async function refusal(
  c: RunContext,
  call: () => Promise<unknown>
): Promise<Recorded> {
  try {
    await call();
  } catch (error) {
    const last = c.exchanges.at(-1);
    if (error instanceof TasteApiError && last)
      return {
        steps: [],
        data: { error: { status: last.status, body: last.body } },
      };
    throw error;
  }
  throw new Error("The API accepted a call this recipe expected it to refuse.");
}

function need<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`This recipe needs ${what}.`);
  return value;
}

// A recipe without a job: its answers, and no steps.
const answers = (data: Record<string, unknown>): Recorded => ({
  steps: [],
  data,
});

const RECIPES: readonly Recipe[] = [
  {
    name: "me",
    paid: false,
    calls: "GET /design/me",
    inputs: {},
    run: async (c) => answers({ me: await c.api.me() }),
  },
  {
    name: "history",
    paid: false,
    calls:
      "GET /design/submissions, GET /search/submissions, GET /judge/brand-adherence (first page each)",
    inputs: { limit: "20" },
    run: async (c) =>
      answers({
        submissions: await c.api.listSubmissions({ limit: 20 }),
        searches: await c.api.listSearches({ limit: 20 }),
        adherence: await c.api.listAdherence({ limit: 20 }),
      }),
  },
  ...(
    [
      ["extract-full", "https://www.tastelabs.com/"],
      ["extract-full-2", "https://stripe.com/"],
    ] as const
  ).map(([name, url]): Recipe => ({
    name,
    paid: true,
    calls:
      "POST /design/submissions (full extraction), then free polling of the submission and its result",
    inputs: { url },
    run: async (c) => extraction(c, await c.api.createSubmission({ url })),
  })),
  {
    name: "extract-selective",
    paid: true,
    calls:
      "POST /design/submissions with sections, then free polling of the submission and its result",
    inputs: { url: "https://linear.app/", sections: "colors,typography" },
    run: async (c) =>
      extraction(
        c,
        await c.api.createSubmission({
          url: "https://linear.app/",
          sections: ["colors", "typography"],
        })
      ),
  },
  {
    name: "manifest",
    paid: false,
    calls:
      "GET /design/submissions/{id}/download (the manifest only, no files)",
    inputs: { id: "extract-full" },
    needs: "extract-full",
    run: async (c) =>
      answers({ manifest: await c.api.getManifest(need(c.id, "an id")) }),
  },
  {
    name: "kit",
    paid: true,
    calls:
      "POST /design/submissions/brand-kit (the PDF given with --file), then free polling",
    inputs: { file: "--file <path>" },
    run: async (c) => {
      const kit = need(c.kit, "--file <path> to a PDF");
      return extraction(c, await c.api.createBrandKit(kit));
    },
  },
  ...(["fast", "deep"] as const).map((depth): Recipe => ({
    name: `search-${depth}`,
    paid: true,
    calls: `POST /search (depth ${depth})`,
    inputs: { query: QUERY, depth },
    run: async (c) =>
      answers({ results: await c.api.search({ query: QUERY, depth }) }),
  })),
  {
    name: "similar",
    paid: true,
    calls: "GET /search/similar on the extract-full submission",
    inputs: { id: "extract-full" },
    needs: "extract-full",
    run: async (c) =>
      answers({ results: await c.api.similar(need(c.id, "an id")) }),
  },
  {
    name: "check-pass",
    paid: true,
    calls:
      "POST /judge/brand-adherence, then free polling of the job and its verdict",
    inputs: {
      reference: "https://www.tastelabs.com/",
      candidate: "https://www.tastelabs.com/research",
    },
    run: (c) =>
      check(
        c,
        "https://www.tastelabs.com/",
        "https://www.tastelabs.com/research"
      ),
  },
  {
    name: "check-fail",
    paid: true,
    calls:
      "POST /judge/brand-adherence, then free polling of the job and its verdict",
    inputs: {
      reference: "https://www.tastelabs.com/",
      candidate: "https://stripe.com/",
    },
    run: (c) => check(c, "https://www.tastelabs.com/", "https://stripe.com/"),
  },
  {
    name: "enhance",
    paid: true,
    calls: "POST /design/prompts/enhance on the extract-full submission",
    inputs: { id: "extract-full", prompt: "a pricing page for a design tool" },
    needs: "extract-full",
    run: async (c) =>
      answers({
        enhanced: await c.api.enhance({
          submission_id: need(c.id, "an id"),
          prompt: "a pricing page for a design tool",
        }),
      }),
  },
  {
    name: "error-404",
    paid: false,
    calls: "GET /design/submissions/{id} on an id that does not exist",
    inputs: { id: MISSING_ID },
    run: (c) => refusal(c, () => c.api.getSubmission(MISSING_ID)),
  },
  // Expected to be refused before any work, but they reach endpoints that charge, so they ask first.
  {
    name: "error-422",
    paid: true,
    calls:
      "POST /design/submissions with a URL that is not one (expected 422, no charge)",
    inputs: { url: "not a url" },
    run: (c) => refusal(c, () => c.api.createSubmission({ url: "not a url" })),
  },
  {
    name: "similar-selective",
    paid: true,
    calls:
      "GET /search/similar on the extract-selective submission (expected 422 FULL_EXTRACTION_REQUIRED, no charge)",
    inputs: { id: "extract-selective" },
    needs: "extract-selective",
    run: (c) => refusal(c, () => c.api.similar(need(c.id, "an id"))),
  },
];

function findRecipe(name: string): Recipe | undefined {
  return RECIPES.find((recipe) => recipe.name === name);
}

// Consecutive identical calls (a poll) are kept once, so the list reads as what the recipe did.
function callList(exchanges: Exchange[]): string[] {
  const calls: string[] = [];
  for (const e of exchanges) {
    const line = `${e.method} ${e.path} ${e.status}`;
    if (calls.at(-1) !== line) calls.push(line);
  }
  return calls;
}

async function record(recipe: Recipe, c: RunContext): Promise<Recording> {
  const { steps, data } = await recipe.run(c);
  return {
    recipe: recipe.name,
    paid: recipe.paid,
    calls: callList(c.exchanges),
    steps,
    data,
  };
}

export { capture, findRecipe, record, RECIPES };
export type { Capture, Exchange, Kit, Recipe, Recording, RunContext };
