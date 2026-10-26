// Recorded Taste Engine responses (scrubbed, in ./fixtures/), shared by the fake API and the local mock.
// A fixture is one recipe of scripts/record-fixtures.ts: the calls it made, the job steps it saw, and
// the responses it kept under data. None may exist yet, so every reader falls back to synthetic data.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import type { FakeState } from "./fake-api.ts";
import {
  ADHERENCE_JOB,
  ADHERENCE_VERDICT,
  BRAND_SEARCH_RESULTS,
  ENHANCE_RESPONSE,
  ME,
  SEARCH_SUBMISSION_LIST,
  SIMILAR_BRANDS_RESULTS,
  SUBMISSION,
  SUBMISSION_MANIFEST,
  SUBMISSION_RESULT,
} from "./schemas.ts";

type Step = z.infer<typeof STEP>;
type Fixture = z.infer<typeof FIXTURE>;
type Fixtures = Readonly<Record<string, Fixture>>;
// A response kept with its status, for refusals and not-ready answers: the raw envelope the API sent.
type Envelope = z.infer<typeof ENVELOPE>;

const FIXTURES_DIR = fileURLToPath(new URL("./fixtures/", import.meta.url));
const STEP = z.object({
  status: z.string(),
  current_step: z.string().nullish(),
});
const FIXTURE = z.object({
  recipe: z.string(),
  paid: z.boolean(),
  calls: z.array(z.string()),
  steps: z.array(STEP),
  data: z.record(z.string(), z.unknown()),
});
const ENVELOPE = z.object({ status: z.number(), body: z.unknown() });
const EXTRACTIONS = ["extract-full", "extract-full-2", "extract-selective"];
const CHECKS = ["check-pass", "check-fail"];

function loadFixtures(dir: string = FIXTURES_DIR): Fixtures {
  if (!existsSync(dir)) return {};
  const fixtures: Record<string, Fixture> = {};
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith(".json")) continue;
    const text = readFileSync(join(dir, file), "utf8");
    fixtures[file.slice(0, -".json".length)] = FIXTURE.parse(JSON.parse(text));
  }
  return fixtures;
}

// The named part of a fixture's data, parsed with the API's own schema; undefined when absent.
function part<T>(
  fixtures: Fixtures,
  recipe: string,
  key: string,
  schema: z.ZodType<T>
): T | undefined {
  const value = fixtures[recipe]?.data[key];
  return value === undefined ? undefined : schema.parse(value);
}

function envelope(
  fixtures: Fixtures,
  recipe: string,
  key: string
): Envelope | undefined {
  return part(fixtures, recipe, key, ENVELOPE);
}

// The fake API seeded with what was recorded: the account, finished extractions with their results
// and manifest, finished checks with their verdicts, and the search answers.
function fixtureState(fixtures: Fixtures = loadFixtures()): Partial<FakeState> {
  const state: Partial<FakeState> = {};
  const me = part(fixtures, "me", "me", ME);
  if (me) state.me = me;
  for (const recipe of [...EXTRACTIONS, "kit"]) {
    const submission = part(fixtures, recipe, "submission", SUBMISSION);
    const result = part(fixtures, recipe, "result", SUBMISSION_RESULT);
    if (!submission) continue;
    (state.submissions ??= []).push(submission);
    if (result) (state.results ??= {})[submission.submission_id] = result;
  }
  const manifest = part(fixtures, "manifest", "manifest", SUBMISSION_MANIFEST);
  if (manifest) state.manifests = { [manifest.submission_id]: manifest };
  for (const recipe of CHECKS) {
    const job = part(fixtures, recipe, "job", ADHERENCE_JOB);
    const verdict = part(fixtures, recipe, "verdict", ADHERENCE_VERDICT);
    if (!job) continue;
    (state.adherence ??= []).push(job);
    if (verdict) (state.verdicts ??= {})[job.job_id] = verdict;
  }
  const searches = part(
    fixtures,
    "history",
    "searches",
    SEARCH_SUBMISSION_LIST
  );
  if (searches) state.searches = searches.submissions;
  const search = part(fixtures, "search-fast", "results", BRAND_SEARCH_RESULTS);
  if (search) state.searchResults = search;
  const similar = part(fixtures, "similar", "results", SIMILAR_BRANDS_RESULTS);
  if (similar) state.similarResults = similar;
  const enhanced = part(fixtures, "enhance", "enhanced", ENHANCE_RESPONSE);
  if (enhanced) state.enhanced = enhanced;
  return state;
}

export { envelope, FIXTURE, FIXTURES_DIR, fixtureState, loadFixtures };
export type { Envelope, Fixture, Fixtures, Step };
