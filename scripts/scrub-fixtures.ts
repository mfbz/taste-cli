// npm run fixtures:scrub [-- <recipe>…]: copies recorded responses from tmp-fixtures/ into
// src/api/fixtures/ with personal data and secrets replaced, long lists and strings trimmed so every
// file stays well under the size guard, and the guards run on the result. Deterministic: the same
// recording always gives the same fixture. Nothing is written if any file would still trip a guard.
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

import { FIXTURE, FIXTURES_DIR } from "../src/api/fixtures.ts";
import { checkFile } from "../tools/checks/guards.ts";

type Limits = { array: number; string: number };
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
const PERSON_ID = "00000000-0000-4000-8000-000000000001";
const KEY_ID = "key_example";
const KEY_NAME = "example";
const REMOVED = "[removed]";
// Lists that grow with the page and say nothing more after a few items.
const SHORT_LISTS = new Set(["layout", "assets", "brand_assets"]);
const SHORT_LIST_ITEMS = 5;
const BY_KEY: Readonly<Record<string, string>> = {
  user_id: PERSON_ID,
  api_key_id: KEY_ID,
  api_key_name: KEY_NAME,
};
// The same shapes the guards block (tools/checks/guards.ts), JWTs a little more broadly.
const TASTE_KEY = /\btaste_[A-Za-z0-9_-]{16,}/g;
const JWT = /\beyJ[\w-]+\.eyJ[\w-]+(?:\.[\w-]*)?/g;
// An email, unless it is a file name such as logo@2x.png.
const EMAIL =
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.(?!(?:png|jpe?g|gif|svg|webp|avif|ico|css|js|woff2?|ttf|otf|pdf|mp4|webm)\b)[A-Za-z]{2,}\b/g;

function scrubText(text: string, limits: Limits | null): string {
  const clean = text
    .replace(TASTE_KEY, REMOVED)
    .replace(JWT, REMOVED)
    .replace(EMAIL, PERSON_EMAIL);
  return limits && clean.length > limits.string
    ? `${clean.slice(0, limits.string)}…`
    : clean;
}

// limits is null outside data, so the calls and steps of a recording are never cut short.
function scrub(value: unknown, key: string, limits: Limits | null): unknown {
  if (typeof value === "string") return BY_KEY[key] ?? scrubText(value, limits);
  if (Array.isArray(value)) {
    const keep = !limits
      ? value.length
      : SHORT_LISTS.has(key)
        ? Math.min(SHORT_LIST_ITEMS, limits.array)
        : limits.array;
    return value.slice(0, keep).map((item) => scrub(item, key, limits));
  }
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, scrub(v, k, limits)])
    );
  return value;
}

function scrubFixture(raw: unknown, limits: Limits = FIRST_ROUND): unknown {
  const { data, ...rest } = FIXTURE.parse(raw);
  return {
    ...(scrub(rest, "", null) as object),
    data: scrub(data, "", limits),
  };
}

async function render(raw: unknown, target: string): Promise<string> {
  const options = { ...(await resolveConfig(target)), filepath: target };
  let text = "";
  for (const limits of ROUNDS) {
    text = await format(JSON.stringify(scrubFixture(raw, limits)), options);
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
  const ready: { name: string; target: string; text: string }[] = [];
  const problems: string[] = [];
  for (const name of [...names].sort()) {
    const file = `${name}.json`;
    const target = join(options.to, file);
    let text: string;
    try {
      const raw: unknown = JSON.parse(
        readFileSync(join(options.from, file), "utf8")
      );
      text = await render(raw, target);
    } catch (error) {
      problems.push(`${file}: not a recorded fixture (${String(error)})`);
      continue;
    }
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

async function main(): Promise<void> {
  const { positionals } = parseArgs({ allowPositionals: true });
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

export { scrubFiles, scrubFixture };
export type { Limits };
