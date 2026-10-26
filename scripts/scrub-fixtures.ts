// npm run fixtures:scrub [-- <recipe>…]: copies recorded responses from tmp-fixtures/ into
// src/api/fixtures/ with personal data and secrets replaced, long lists and strings trimmed so every
// file stays well under the size guard, and the guards run on the result. Deterministic: the same
// recording always gives the same fixture. Nothing is written if any file would still trip a guard.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { format, resolveConfig } from "prettier";

import type { z } from "zod";

import { FIXTURE, FIXTURES_DIR } from "../src/api/fixtures.ts";
import { checkFile } from "../tools/checks/guards.ts";
import { findRecipe } from "./fixture-recipes.ts";

type Limits = { array: number; string: number };
type Raw = z.infer<typeof FIXTURE>;
// What one scrub run knows from all its recordings: personal values to replace wherever they appear,
// and the ids and queries the recipes themselves created (the only history worth keeping).
type Known = {
  literals: [RegExp, string][];
  ids: Set<string>;
  queries: Set<string>;
};
type ScrubOptions = {
  from: string;
  to: string;
  home: string;
  names?: string[];
};
type Written = { name: string; bytes: number };

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const RAW_DIR = join(ROOT, "tmp-fixtures");
const MAX_BYTES = 200 * 1024;
// Tighter each round, until the file fits under MAX_BYTES.
const FIRST_ROUND: Limits = { array: 50, string: 4000 };
const ROUNDS: readonly Limits[] = [
  FIRST_ROUND,
  { array: 20, string: 1000 },
  { array: 5, string: 200 },
];
const RECIPE_NAME = /^[a-z0-9-]+$/;
const PERSON_EMAIL = "person@example.com";
const REMOVED = "[removed]";
// Lists that grow with the page and say nothing more after a few items.
const SHORT_LISTS = new Set(["layout", "assets", "brand_assets"]);
const SHORT_LIST_ITEMS = 5;
// Personal or account values, replaced by key, and then wherever else their value shows up.
const BY_KEY: Readonly<Record<string, string>> = {
  user_id: "00000000-0000-4000-8000-000000000001",
  email: PERSON_EMAIL,
  api_key_id: "key_example",
  api_key_name: "example",
  batch_id: "batch_example",
  batch_label: "example batch",
  credit_ref_id: "credit_example",
};
// Account ids under any name, and anything about an API key, at any depth: the schemas are loose
// and raw bodies keep fields Taste may add.
const PERSONAL_ID =
  /(?:^|_)(?:user|org|organization|account|owner|team|workspace|customer|tenant)_id$/i;
const KEY_FIELD = /^(?:api_key_.+|key_prefix)$/i;
// One or two characters say nothing and match everywhere: those are replaced by key only.
const MIN_LITERAL = 3;
// A known value is replaced only as a whole token, so "default" never rewrites "defaultColor".
const TOKEN_CHAR = "[A-Za-z0-9_-]";
// Query parameters that carry a credential or a signature, on any host.
const CREDENTIAL_PARAM =
  /^(?:sig|signature|token|access_token|key|expires|policy|key-pair-id|x-amz-.*|x-goog-.*)$/i;
const ID_KEYS = new Set(["submission_id", "job_id", "search_id", "id"]);
const TASTE_API_HOST = "api.tastelabs.com";
// The same shapes the guards block (tools/checks/guards.ts), JWTs a little more broadly.
const TASTE_KEY = /\btaste_[A-Za-z0-9_-]{16,}/g;
const JWT = /\beyJ[\w-]+\.eyJ[\w-]+(?:\.[\w-]*)?/g;
// An email, plain or percent-encoded, unless it is a file name such as logo@2x.png.
const EMAIL =
  /[A-Za-z0-9._%+-]+(?:@|%40)[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.(?!(?:png|jpe?g|gif|svg|webp|avif|ico|css|js|woff2?|ttf|otf|pdf|mp4|webm)\b)[A-Za-z]{2,}\b/gi;
const WEB_URL = /https?:\/\/[^\s"'<>()]+/g;

function walk(
  value: unknown,
  visit: (key: string, value: unknown) => void,
  key = ""
): void {
  visit(key, value);
  if (Array.isArray(value)) for (const item of value) walk(item, visit, key);
  else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value)) walk(v, visit, k);
}

function placeholderFor(key: string): string | undefined {
  if (BY_KEY[key]) return BY_KEY[key];
  if (PERSONAL_ID.test(key)) return `example_${key.toLowerCase()}`;
  if (KEY_FIELD.test(key)) return "key_example";
  return undefined;
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function knownFrom(docs: readonly Raw[]): Known {
  const literals = new Map<string, string>();
  const ids = new Set<string>();
  const queries = new Set<string>();
  for (const doc of docs) {
    walk(doc, (key, value) => {
      if (typeof value !== "string" && typeof value !== "number") return;
      const text = String(value);
      const placeholder = placeholderFor(key);
      if (placeholder && text.length >= MIN_LITERAL && text !== placeholder)
        literals.set(text, placeholder);
      if (typeof value !== "string") return;
      if (doc.recipe !== "history" && ID_KEYS.has(key)) ids.add(value);
    });
    const query = findRecipe(doc.recipe)?.inputs.query;
    if (query && doc.recipe !== "history") queries.add(query);
  }
  // Longest first, so a value inside another is never replaced half way.
  return {
    literals: [...literals]
      .sort(([a], [b]) => b.length - a.length)
      .map(([value, placeholder]) => [
        new RegExp(`(?<!${TOKEN_CHAR})${escape(value)}(?!${TOKEN_CHAR})`, "g"),
        placeholder,
      ]),
    ids,
    queries,
  };
}

// A pre-signed asset URL carries its signature in the query: anything off the Taste API loses its
// query and fragment, and a Taste API URL loses any parameter that looks like a credential.
function unsign(url: string): string {
  const parsed = URL.parse(url);
  if (!parsed) return url;
  if (parsed.hostname !== TASTE_API_HOST) return url.replace(/[?#].*$/, "");
  const names = [...parsed.searchParams.keys()];
  if (!names.some((name) => CREDENTIAL_PARAM.test(name))) return url;
  for (const name of names)
    if (CREDENTIAL_PARAM.test(name)) parsed.searchParams.delete(name);
  return parsed.href;
}

function scrubText(text: string, known: Known, limits: Limits | null): string {
  let clean = text;
  for (const [pattern, placeholder] of known.literals)
    clean = clean.replace(pattern, placeholder);
  clean = clean
    .replace(TASTE_KEY, REMOVED)
    .replace(JWT, REMOVED)
    .replace(EMAIL, PERSON_EMAIL)
    .replace(WEB_URL, unsign);
  return limits && clean.length > limits.string
    ? `${clean.slice(0, limits.string)}…`
    : clean;
}

// limits is null outside data, so the calls and steps of a recording are never cut short.
function scrub(
  value: unknown,
  key: string,
  known: Known,
  limits: Limits | null
): unknown {
  const placeholder = placeholderFor(key);
  if (typeof value === "string")
    return placeholder ?? scrubText(value, known, limits);
  if (typeof value === "number" && placeholder) return placeholder;
  if (Array.isArray(value)) {
    const keep = !limits
      ? value.length
      : SHORT_LISTS.has(key)
        ? Math.min(SHORT_LIST_ITEMS, limits.array)
        : limits.array;
    return value.slice(0, keep).map((item) => scrub(item, key, known, limits));
  }
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, scrub(v, k, known, limits)])
    );
  return value;
}

function countBy(items: Record<string, unknown>[], key: string) {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const value = String(item[key]);
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

// The account's history is private: only entries a recipe created stay, and every total is
// recounted from what stays, so nothing hints at the rest.
function keepOwn(
  page: unknown,
  listKey: string,
  idKey: string,
  known: Known
): unknown {
  if (!page || typeof page !== "object") return page;
  const list = (page as Record<string, unknown>)[listKey];
  const items = (Array.isArray(list) ? list : []) as Record<string, unknown>[];
  const kept = items.filter(
    (item) =>
      known.ids.has(String(item[idKey])) ||
      (typeof item.query === "string" && known.queries.has(item.query))
  );
  const own: Record<string, unknown> = {
    [listKey]: kept,
    total: kept.length,
    limit: (page as Record<string, unknown>).limit ?? kept.length,
    offset: 0,
  };
  if (listKey === "submissions" && idKey === "submission_id") {
    const byStatus = countBy(kept, "status");
    own.totals = {
      completed: byStatus.completed ?? 0,
      failed: byStatus.failed ?? 0,
      in_progress:
        kept.length - (byStatus.completed ?? 0) - (byStatus.failed ?? 0),
    };
  }
  if (idKey === "id") own.total_by_status = countBy(kept, "status");
  return own;
}

function ownHistory(data: Record<string, unknown>, known: Known) {
  return {
    ...data,
    submissions: keepOwn(
      data.submissions,
      "submissions",
      "submission_id",
      known
    ),
    searches: keepOwn(data.searches, "submissions", "id", known),
    adherence: keepOwn(data.adherence, "jobs", "job_id", known),
  };
}

function scrubFixture(
  raw: unknown,
  limits: Limits = FIRST_ROUND,
  known?: Known
): unknown {
  const doc = FIXTURE.parse(raw);
  const k = known ?? knownFrom([doc]);
  const { data, ...rest } = doc;
  const own = doc.recipe === "history" ? ownHistory(data, k) : data;
  return {
    ...(scrub(rest, "", k, null) as object),
    data: scrub(own, "", k, limits),
  };
}

async function render(raw: Raw, known: Known, target: string): Promise<string> {
  const options = { ...(await resolveConfig(target)), filepath: target };
  let text = "";
  for (const limits of ROUNDS) {
    text = await format(
      JSON.stringify(scrubFixture(raw, limits, known)),
      options
    );
    if (Buffer.byteLength(text) < MAX_BYTES) return text;
  }
  throw new Error(
    `${target}: still over ${MAX_BYTES / 1024} KB after trimming`
  );
}

async function scrubFiles(options: ScrubOptions): Promise<Written[]> {
  const names =
    options.names ??
    readdirSync(options.from)
      .filter((file) => file.endsWith(".json"))
      .map((file) => file.slice(0, -".json".length));
  const odd = names.find((name) => !RECIPE_NAME.test(name));
  if (odd !== undefined) throw new Error(`Not a recipe name: ${odd}`);
  const problems: string[] = [];
  // Every recording in the folder, not only those being scrubbed: they all name values to hide and
  // the jobs the history may keep.
  const docs = new Map<string, Raw>();
  for (const file of readdirSync(options.from).sort()) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw: unknown = JSON.parse(
        readFileSync(join(options.from, file), "utf8")
      );
      docs.set(file.slice(0, -".json".length), FIXTURE.parse(raw));
    } catch (error) {
      problems.push(`${file}: not a recorded fixture (${String(error)})`);
    }
  }
  const known = knownFrom([...docs.values()]);
  const ready: { name: string; target: string; text: string }[] = [];
  for (const name of [...names].sort()) {
    const file = `${name}.json`;
    const target = join(options.to, file);
    const doc = docs.get(name);
    if (!doc) {
      if (!problems.some((p) => p.startsWith(file)))
        problems.push(`${file}: not recorded`);
      continue;
    }
    const text = await render(doc, known, target);
    problems.push(...checkFile(file, Buffer.from(text), options.home));
    ready.push({ name, target, text });
  }
  if (problems.length)
    throw new Error(`Nothing written:\n${problems.join("\n")}`);
  mkdirSync(options.to, { recursive: true });
  for (const { target, text } of ready) writeFileSync(target, text);
  return ready.map(({ name, text }) => ({
    name,
    bytes: Buffer.byteLength(text),
  }));
}

// Raw recordings hold the maintainer's data: if Git would not ignore them, stop before anything else.
function rawIsIgnored(): boolean {
  try {
    execFileSync(
      "git",
      ["check-ignore", "-q", "--no-index", "tmp-fixtures/recipe.json"],
      { cwd: ROOT, stdio: "ignore" }
    );
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const { positionals } = parseArgs({ allowPositionals: true });
  if (!rawIsIgnored())
    throw new Error(
      "tmp-fixtures/ is not ignored by Git: fix .gitignore first."
    );
  if (!existsSync(RAW_DIR))
    throw new Error("No tmp-fixtures/ yet: record a recipe first.");
  const written = await scrubFiles({
    from: RAW_DIR,
    to: FIXTURES_DIR,
    home: homedir(),
    names: positionals.length ? positionals : undefined,
  });
  for (const { name, bytes } of written)
    process.stderr.write(
      `src/api/fixtures/${name}.json  ${Math.ceil(bytes / 1024)} KB\n`
    );
}

if (import.meta.main)
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  });

export { knownFrom, scrubFiles, scrubFixture };
export type { Known, Limits };
