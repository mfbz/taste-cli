// npm run fixtures:scrub: copies tmp-fixtures/*.json to src/api/fixtures/ after two boring steps.
// Normalise: the ids the recipes created become fixed fake UUIDs, and URLs off the Taste API lose
// their query and fragment (signed download links). Check: anything that still looks personal or
// secret fails the run, listed as file:path, and nothing is written; a person fixes it by hand.
// Recipes record public content only (me and history are hand-written), so nothing else is repaired.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { format, resolveConfig } from "prettier";

import { FIXTURES_DIR } from "../src/api/fixtures.ts";
import { RECIPES } from "./fixture-recipes.ts";

type Docs = Record<string, unknown>;
type Visit = (path: string, key: string, value: unknown) => unknown;

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const RAW_DIR = join(ROOT, "tmp-fixtures");
const FAKE = "00000000-0000-4000-8000-";
const ID_KEYS = new Set([
  "submission_id",
  "job_id",
  "extraction_id",
  "search_id",
  "id",
]);
const TASTE_API_HOST = "api.tastelabs.com";
const WEB_URL = /https?:\/\/[^\s"'<>()]+/g;
const CHECKS: readonly [string, RegExp][] = [
  // example.com is the placeholder; logo@2x.png is a file name.
  [
    "email",
    /[\w.%+-]+@(?!example\.com\b)[\w-]+(?:\.[\w-]+)*\.(?!(?:png|jpe?g|gif|svg|webp|css|js|pdf)\b)[a-z]{2,}/i,
  ],
  ["JWT", /eyJ[\w-]+\.eyJ[\w-]+/],
  ["Taste key", /taste_[A-Za-z0-9_-]{16,}/],
  ["Bearer token", /Bearer\s+\S{8,}/i],
  [
    "unmapped UUID",
    /\b(?!00000000-0000-4000-8000-)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
  ],
  [
    "credential in a URL",
    /[?&](?:sig|signature|token|key|x-amz-[^=&]*|x-goog-[^=&]*|expires)=/i,
  ],
];

// Fixed per recipe, so the hand-written history can point at the recorded jobs.
function fakeId(recipe: string, n = 0): string {
  const index = RECIPES.findIndex((r) => r.name === recipe);
  return `${FAKE}${String((index + 1) * 100 + n).padStart(12, "0")}`;
}

function walk(value: unknown, path: string, visit: Visit, key = ""): unknown {
  if (Array.isArray(value))
    return value.map((v, i) => walk(v, `${path}[${i}]`, visit, key));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        walk(v, `${path}.${k}`, visit, k),
      ])
    );
  return visit(path, key, value);
}

function unsign(url: string): string {
  return URL.parse(url)?.hostname === TASTE_API_HOST
    ? url
    : url.replace(/[?#].*$/, "");
}

function normalise(docs: Docs): Docs {
  const ids = new Map<string, string>();
  // In recipe order, so an id gets the number of the recipe that created it.
  for (const { name } of RECIPES) {
    let n = 0;
    walk(docs[name], "", (_, key, value) => {
      if (
        ID_KEYS.has(key) &&
        typeof value === "string" &&
        !value.startsWith(FAKE) &&
        !ids.has(value)
      )
        ids.set(value, fakeId(name, n++));
      return value;
    });
  }
  const clean: Visit = (_, __, value) => {
    if (typeof value !== "string") return value;
    let text = value;
    for (const [real, fake] of ids) text = text.replaceAll(real, fake);
    return text.replace(WEB_URL, unsign);
  };
  return Object.fromEntries(
    Object.entries(docs).map(([name, doc]) => [name, walk(doc, "", clean)])
  );
}

function check(name: string, doc: unknown): string[] {
  const problems: string[] = [];
  walk(doc, `${name}.json:`, (path, _, value) => {
    if (typeof value === "string")
      for (const [what, pattern] of CHECKS)
        if (pattern.test(value)) problems.push(`${path} ${what}`);
    return value;
  });
  return problems;
}

async function main(): Promise<number> {
  try {
    execFileSync(
      "git",
      ["check-ignore", "-q", "--no-index", "tmp-fixtures/x.json"],
      { cwd: ROOT, stdio: "ignore" }
    );
  } catch {
    process.stderr.write(
      "tmp-fixtures/ is not ignored by Git: fix .gitignore first.\n"
    );
    return 1;
  }
  if (!existsSync(RAW_DIR)) {
    process.stderr.write("No tmp-fixtures/ yet: record a recipe first.\n");
    return 1;
  }
  const raw: Docs = {};
  for (const file of readdirSync(RAW_DIR).filter((f) => f.endsWith(".json")))
    raw[file.slice(0, -".json".length)] = JSON.parse(
      readFileSync(join(RAW_DIR, file), "utf8")
    ) as unknown;
  const docs = normalise(raw);
  const problems = Object.entries(docs).flatMap(([name, doc]) =>
    check(name, doc)
  );
  if (problems.length) {
    process.stderr.write(
      `Nothing written. Fix these by hand in tmp-fixtures/, then run again:\n${problems.join("\n")}\n`
    );
    return 1;
  }
  mkdirSync(FIXTURES_DIR, { recursive: true });
  for (const [name, doc] of Object.entries(docs)) {
    const target = join(FIXTURES_DIR, `${name}.json`);
    const options = { ...(await resolveConfig(target)), filepath: target };
    writeFileSync(target, await format(JSON.stringify(doc), options));
    process.stderr.write(`src/api/fixtures/${name}.json\n`);
  }
  return 0;
}

if (import.meta.main) void main().then((code) => (process.exitCode = code));

export { check, fakeId, normalise };
