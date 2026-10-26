import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
import { approve, dependencyId, spends } from "./record-fixtures.ts";
import { check, fakeId, normalise } from "./scrub-fixtures.ts";

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
async function recordAgainstMock(
  name: string,
  given?: string
): Promise<Recording> {
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
    id: dependencyId(recipe, dir, given),
    kit: {
      name: "sample-guidelines.pdf",
      bytes: new Uint8Array([37, 80, 68, 70]),
    },
  });
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(recording));
  return recording;
}

describe("the fixture recipes", () => {
  it("go from recording, through normalise and check, to fixtures the fake API and the mock read", async () => {
    const recordings: Record<string, unknown> = {};
    for (const { name } of RECIPES)
      recordings[name] = await recordAgainstMock(name);
    const docs = normalise(recordings);
    expect(Object.entries(docs).flatMap(([n, d]) => check(n, d))).toEqual([]);
    const fixtures = join(dir, "fixtures");
    mkdirSync(fixtures);
    for (const [name, doc] of Object.entries(docs))
      writeFileSync(join(fixtures, `${name}.json`), JSON.stringify(doc));
    const loaded = loadFixtures(fixtures);
    const api = createFakeApi(fixtureState(loaded));
    expect((await api.getSubmission(fakeId("extract-full"))).source_url).toBe(
      "https://www.tastelabs.com/"
    );
    expect(createLibrary(loaded).notFound.status).toBe(404);
  });

  it("pick up a posted job with --id by polling only, and refuse one posted for another input", async () => {
    const api = createTasteApi({
      fetch: globalThis.fetch,
      baseUrl: mock.url,
      auth: {
        header: () => Promise.resolve({ "x-api-key": KEY }),
        onUnauthorized: () => Promise.resolve(false),
      },
      sleep: () => Promise.resolve(),
    });
    const posted = await api.createSubmission({ url: "https://stripe.com/" });
    expect(spends(findRecipe("extract-full-2")!, posted.submission_id)).toBe(
      false
    );
    const extraction = await recordAgainstMock(
      "extract-full-2",
      posted.submission_id
    );
    expect(extraction.calls.some((c) => c.startsWith("POST"))).toBe(false);
    expect(extraction.data).toMatchObject({ result: { status: "completed" } });
    await expect(
      recordAgainstMock("extract-full", posted.submission_id)
    ).rejects.toThrow(/was posted for https:\/\/stripe\.com\//);
  });
});

describe("approving a paid recipe", () => {
  it("takes yes typed at a terminal, and nothing else", async () => {
    const ask = vi.fn(() => Promise.resolve("yes"));
    expect(await approve(false, ask)).toBe(false);
    expect(ask).not.toHaveBeenCalled();
    expect(await approve(true, () => Promise.resolve("yes\n"))).toBe(true);
    expect(await approve(true, () => Promise.resolve("y"))).toBe(false);
  });
});
