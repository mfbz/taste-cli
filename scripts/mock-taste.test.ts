import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { createTasteApi, TasteApiError } from "../src/api/client.ts";
import type { TasteApi } from "../src/api/client.ts";
import { loadFixtures } from "../src/api/fixtures.ts";
import { jobCheck, waitForJob } from "../src/api/poll.ts";
import { runCli } from "../src/fake-io.ts";
import { createLibrary } from "./mock-data.ts";
import { startMock } from "./mock-server.ts";
import type { Mock, MockOptions } from "./mock-server.ts";

const KEY = ["taste", "mock", "test"].join("_");
const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const instant = () => Promise.resolve();

let mock: Mock | undefined;
let dir: string | undefined;

afterEach(async () => {
  await mock?.close();
  mock = undefined;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

async function start(options: Partial<MockOptions> = {}) {
  mock = await startMock({
    library: createLibrary({}),
    fast: true,
    ...options,
  });
  return mock;
}

function client(url: string, key = KEY): TasteApi {
  return createTasteApi({
    fetch: globalThis.fetch,
    baseUrl: url,
    auth: {
      header: () => Promise.resolve({ "x-api-key": key }),
      onUnauthorized: () => Promise.resolve(false),
    },
    sleep: instant,
  });
}

async function refusedWith(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e
  );
  expect(error).toBeInstanceOf(TasteApiError);
  const { status, code } = error as TasteApiError;
  return { status, code };
}

async function extract(api: TasteApi, url: string, sections?: ["colors"]) {
  const { submission_id: id } = await api.createSubmission({ url, sections });
  const steps: string[] = [];
  const answers: string[] = [];
  await waitForJob({
    id,
    check: async () => {
      const job = await api.getSubmission(id);
      const result = await api.getResult(id);
      answers.push(result === "not_ready" ? "409" : result.status);
      return jobCheck(job, job);
    },
    onStep: (step) => steps.push(step),
    sleep: instant,
    now: () => 0,
    timeoutMs: 1000,
    signal: new AbortController().signal,
  });
  return { id, steps, answers, result: await api.getResult(id) };
}

describe("the mock Taste Engine", () => {
  it("answers taste whoami --json through the real CLI", async () => {
    const { url } = await start();
    const { code, doc } = await runCli(["whoami", "--json"], {
      env: { TASTE_API_URL: url, TASTE_API_KEY: KEY },
      fetch: globalThis.fetch,
      sleep: instant,
    });
    expect(code).toBe(0);
    expect(doc()).toMatchObject({
      ok: true,
      data: { method: "env-key", email: "person@example.com" },
    });
  });

  it("runs taste extract end to end with --json", async () => {
    const { url } = await start();
    const { code, out, err, doc } = await runCli(
      ["extract", "https://stripe.com", "--json"],
      {
        env: { TASTE_API_URL: url, TASTE_API_KEY: KEY },
        fetch: globalThis.fetch,
        sleep: instant,
      }
    );
    expect(code).toBe(0);
    expect(err).toBe("");
    expect(out.trim().split("\n")).toHaveLength(1);
    expect(doc()).toMatchObject({
      ok: true,
      data: { status: "completed", source_url: "https://stripe.com/" },
    });
  });

  it("ends a real taste extract on Ctrl-C with 130 and one document naming taste wait", async () => {
    // Not fast: the job takes seconds per step, so the interrupt lands mid-wait.
    const { url } = await start({ fast: false });
    const child = spawn(
      process.execPath,
      [MAIN, "extract", "https://stripe.com", "--json"],
      {
        env: { PATH: process.env.PATH, TASTE_API_URL: url, TASTE_API_KEY: KEY },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    setTimeout(() => child.kill("SIGINT"), 1_500);
    const code = await new Promise<number | null>((resolve) =>
      child.on("close", resolve)
    );
    expect(code).toBe(130);
    expect(stdout.trim().split("\n")).toHaveLength(1);
    const doc = JSON.parse(stdout) as {
      error: { code: string; hint: string; details: { id: string } };
    };
    expect(doc.error.code).toBe("INTERRUPTED");
    expect(doc.error.hint).toContain(`taste wait ${doc.error.details.id}`);
  });

  it("refuses a key that is not a mock key with the real 401", async () => {
    const { url } = await start();
    const other = ["taste", "live", "x"].join("_");
    expect(await refusedWith(client(url, other).me())).toEqual({
      status: 401,
      code: "UNAUTHORIZED",
    });
  });

  it("walks an extraction through its steps, a 409 and a partial result", async () => {
    const { url } = await start();
    const run = await extract(client(url), "https://stripe.com/");
    expect(run.steps).toEqual([
      "queued",
      "crawl_pages",
      "extract_design_system",
      "write_guidelines",
      "completed",
    ]);
    expect(run.answers[0]).toBe("409");
    expect(run.answers).toContain("extracting");
    expect(run.result).toMatchObject({
      submission_id: run.id,
      status: "completed",
      source_url: "https://stripe.com/",
      result: { design_system: { profile: { brand_name: "Example" } } },
    });
  });

  it("takes a few seconds per step unless fast", async () => {
    let now = 0;
    const { url } = await start({ fast: false, now: () => now });
    const api = client(url);
    const { submission_id: id } = await api.createSubmission({
      url: "https://stripe.com/",
    });
    expect((await api.getSubmission(id)).status).toBe("accepted");
    now += 3000;
    expect((await api.getSubmission(id)).status).toBe("queued");
    expect((await api.getSubmission(id)).status).toBe("queued");
  });

  it("serves the manifest, similar brands, enhance, search and history", async () => {
    const { url } = await start();
    const api = client(url);
    const { id } = await extract(api, "https://www.tastelabs.com/");
    const manifest = await api.getManifest(id);
    expect(manifest.files.map((f) => f.path)).toContain("DESIGN.md");
    expect((await api.similar(id)).results).toHaveLength(1);
    expect(
      (await api.enhance({ submission_id: id, prompt: "a pricing page" }))
        .brand_name
    ).toBe("Example");
    expect(
      (await api.search({ query: "dark brutalist", depth: "deep" })).depth
    ).toBe("deep");
    expect((await api.listSubmissions({})).submissions[0]?.submission_id).toBe(
      id
    );
    expect((await api.listSearches({})).submissions.map((s) => s.kind)).toEqual(
      ["search", "similar"]
    );
    expect((await api.setSubmissionVisibility(id, true)).is_public).toBe(true);
  });

  it("judges a page against its own site as a pass and another site as a fail", async () => {
    const { url } = await start();
    const api = client(url);
    async function check(candidate: string) {
      const { job_id: id } = await api.createAdherence({
        reference_url: "https://www.tastelabs.com/",
        candidate_url: candidate,
      });
      for (let i = 0; i < 5; i += 1) await api.getAdherence(id);
      return api.getVerdict(id);
    }
    const pass = await check("https://tastelabs.com/");
    const fail = await check("https://stripe.com/");
    expect(pass !== "not_ready" && pass.score).toBeGreaterThan(0.7);
    expect(fail !== "not_ready" && fail.score).toBeLessThan(0.5);
    expect((await api.listAdherence({})).jobs).toHaveLength(2);
  });

  it("answers the real error envelopes", async () => {
    const { url } = await start({ credits: 1 });
    const api = client(url);
    expect(await refusedWith(api.getSubmission("missing"))).toEqual({
      status: 404,
      code: "NOT_FOUND",
    });
    expect(
      await refusedWith(api.createSubmission({ url: "not a url" }))
    ).toEqual({
      status: 422,
      code: undefined,
    });
    const { submission_id: id } = await api.createSubmission({
      url: "https://linear.app/",
      sections: ["colors", "typography"],
    });
    expect(
      await refusedWith(api.createSubmission({ url: "https://stripe.com/" }))
    ).toEqual({
      status: 402,
      code: "INSUFFICIENT_CREDITS",
    });
    for (let i = 0; i < 6; i += 1) await api.getSubmission(id);
    expect(await refusedWith(api.similar(id))).toEqual({
      status: 422,
      code: "FULL_EXTRACTION_REQUIRED",
    });
  });

  it("fails a job on a .invalid host, with a 424 for a check", async () => {
    const { url } = await start();
    const api = client(url);
    const { job_id: id } = await api.createAdherence({
      reference_url: "https://www.tastelabs.com/",
      candidate_url: "https://down.invalid/",
    });
    for (let i = 0; i < 3; i += 1) await api.getAdherence(id);
    expect((await api.getAdherence(id)).status).toBe("failed");
    expect(await refusedWith(api.getVerdict(id))).toEqual({
      status: 424,
      code: "BRAND_ADHERENCE_FAILED",
    });
  });

  it("answers from recorded fixtures when they exist", async () => {
    dir = mkdtempSync(join(tmpdir(), "taste-mock-"));
    const fixture = (recipe: string, data: unknown, steps: unknown[] = []) =>
      writeFileSync(
        join(dir!, `${recipe}.json`),
        JSON.stringify({ recipe, paid: true, calls: [], steps, data })
      );
    fixture("me", {
      me: { user_id: "u-rec", email: "person@example.com", role: "member" },
    });
    fixture(
      "extract-full-2",
      {
        submission: {
          submission_id: "rec-1",
          source_url: "https://stripe.com/",
        },
        partial: {
          status: 200,
          body: { status: "extracting", result: { step: "partial" } },
        },
        result: {
          submission_id: "rec-1",
          status: "completed",
          source_url: "https://stripe.com/",
          result: { design_system: { profile: { brand_name: "Stripe" } } },
        },
      },
      [
        { status: "crawling", current_step: "crawl" },
        { status: "extracting", current_step: "colors" },
        { status: "completed", current_step: null },
      ]
    );
    const { url } = await start({ library: createLibrary(loadFixtures(dir)) });
    const api = client(url);
    expect((await api.me()).role).toBe("member");
    const run = await extract(api, "https://stripe.com/");
    expect(run.steps).toEqual(["crawl", "colors", "completed"]);
    expect(run.result).toMatchObject({
      submission_id: run.id,
      result: { design_system: { profile: { brand_name: "Stripe" } } },
    });
  });
});
