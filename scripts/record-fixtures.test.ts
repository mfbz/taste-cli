import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTasteApi } from "../src/api/client.ts";
import { createFakeApi } from "../src/api/fake-api.ts";
import { fixtureState, loadFixtures } from "../src/api/fixtures.ts";
import { capture, findRecipe, record, RECIPES } from "./fixture-recipes.ts";
import type { Recording } from "./fixture-recipes.ts";
import { createLibrary } from "./mock-data.ts";
import { startMock } from "./mock-server.ts";
import type { Mock } from "./mock-server.ts";
import { approve, dependencyId, describeRecipe } from "./record-fixtures.ts";
import { scrubFiles } from "./scrub-fixtures.ts";

const KEY = ["taste", "mock", "rec"].join("_");

let dir: string;
let mock: Mock;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "taste-record-"));
  mock = await startMock({ library: createLibrary({}), fast: true });
});

afterEach(async () => {
  await mock.close();
  rmSync(dir, { recursive: true, force: true });
});

// Records one recipe against the local mock, exactly as the recorder does against Taste.
async function recordAgainstMock(name: string): Promise<Recording> {
  const recipe = findRecipe(name)!;
  const captured = capture(globalThis.fetch);
  const recording = await record(recipe, {
    api: createTasteApi({
      fetch: captured.fetch,
      baseUrl: mock.url,
      auth: {
        header: () => Promise.resolve({ "x-api-key": KEY }),
        onUnauthorized: () => Promise.resolve(false),
      },
      sleep: () => Promise.resolve(),
    }),
    exchanges: captured.exchanges,
    sleep: () => Promise.resolve(),
    now: () => 0,
    signal: new AbortController().signal,
    log: () => {},
    id: dependencyId(recipe, dir),
    kit: {
      name: "sample-guidelines.pdf",
      bytes: new Uint8Array([37, 80, 68, 70]),
    },
  });
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(recording));
  return recording;
}

describe("the fixture recipes", () => {
  it("are the brief's list, with what each spends", () => {
    expect(RECIPES.map((r) => [r.name, r.paid])).toEqual([
      ["me", false],
      ["history", false],
      ["extract-full", true],
      ["extract-full-2", true],
      ["extract-selective", true],
      ["manifest", false],
      ["kit", true],
      ["search-fast", true],
      ["search-deep", true],
      ["similar", true],
      ["check-pass", true],
      ["check-fail", true],
      ["enhance", true],
      ["error-404", false],
      ["error-422", true],
      ["similar-selective", true],
    ]);
  });

  it("record an extraction's steps, its 409, a partial result and the final result", async () => {
    const recording = await recordAgainstMock("extract-full");
    expect(recording.steps.map((s) => s.current_step ?? s.status)).toEqual([
      "queued",
      "crawl_pages",
      "extract_design_system",
      "write_guidelines",
      "completed",
    ]);
    expect(recording.data).toMatchObject({
      accepted: { source_url: "https://www.tastelabs.com/" },
      submission: { status: "completed" },
      not_ready: { status: 409, body: { detail: { error: "NOT_READY" } } },
      partial: { status: 200, body: { status: "extracting" } },
      result: { status: "completed" },
    });
    expect(recording.calls[0]).toBe("POST /design/submissions 202");
  });

  it("record a refusal as its status and raw envelope", async () => {
    const recording = await recordAgainstMock("error-404");
    expect(recording.data).toEqual({
      error: {
        status: 404,
        body: {
          detail: { error: "NOT_FOUND", message: "Submission not found" },
        },
      },
    });
  });

  it("refuse a recipe that needs an earlier recording until it exists", () => {
    expect(() => dependencyId(findRecipe("manifest")!, dir)).toThrow(
      /Record extract-full first/
    );
    expect(dependencyId(findRecipe("manifest")!, dir, "given-id")).toBe(
      "given-id"
    );
  });

  it("go from recording to scrubbed fixtures the fake API and the mock read", async () => {
    for (const { name } of RECIPES) await recordAgainstMock(name);
    const fixtures = join(dir, "fixtures");
    const written = await scrubFiles({
      from: dir,
      to: fixtures,
      home: homedir(),
    });
    expect(written).toHaveLength(RECIPES.length);
    const loaded = loadFixtures(fixtures);
    const api = createFakeApi(fixtureState(loaded));
    expect((await api.me()).email).toBe("person@example.com");
    expect((await api.listSubmissions({})).submissions).toHaveLength(4);
    expect(createLibrary(loaded).notFound.status).toBe(404);
    expect(createLibrary(loaded).fullExtractionRequired.body).toMatchObject({
      detail: { error: "FULL_EXTRACTION_REQUIRED" },
    });
  });
});

describe("approving a paid recipe", () => {
  it("is refused without a terminal, and nothing is asked", async () => {
    const ask = vi.fn(() => Promise.resolve("yes"));
    expect(await approve(false, ask)).toBe(false);
    expect(ask).not.toHaveBeenCalled();
  });

  it("takes yes and nothing else", async () => {
    expect(await approve(true, () => Promise.resolve("yes\n"))).toBe(true);
    expect(await approve(true, () => Promise.resolve("y"))).toBe(false);
    expect(await approve(true, () => Promise.resolve(""))).toBe(false);
  });

  it("says what it will call and that it spends credits", () => {
    const text = describeRecipe(
      findRecipe("search-deep")!,
      "https://api.tastelabs.com"
    );
    expect(text).toContain("POST /search (depth deep)");
    expect(text).toContain("dark brutalist developer tools");
    expect(text).toContain("spends credits");
    expect(describeRecipe(findRecipe("me")!, "x")).toContain("Free");
  });
});
