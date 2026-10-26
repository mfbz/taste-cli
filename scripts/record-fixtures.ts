// npm run fixtures:record -- <recipe> [--file <pdf>] [--id <id>] | --list
// Records one recipe against the Taste Engine with the CLI's own client, auth provider and stored
// sign in (or TASTE_API_KEY), and writes the raw answers to tmp-fixtures/<recipe>.json, never into
// src/ (npm run fixtures:scrub does that). A paid recipe says what it will call and waits for the
// maintainer to type yes at a terminal; without a terminal it refuses. One recipe per run, and the
// recorder never repeats a paid call (the client retries only search's 503, which Taste refunds).
// A job recipe given --id picks up a job already posted, for free.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { TasteApiError } from "../src/api/client.ts";
import { DEFAULT_API_URL } from "../src/config/env.ts";
import { createContext } from "../src/context.ts";
import { processIo } from "../src/io.ts";
import { CliError } from "../src/output/errors.ts";
import { createOutput } from "../src/output/output.ts";
import { createTheme } from "../src/output/theme.ts";
import {
  callLine,
  capture,
  findRecipe,
  record,
  RECIPES,
} from "./fixture-recipes.ts";
import type { Kit, Recipe } from "./fixture-recipes.ts";
import { OUTPUT as SAMPLE_GUIDELINES } from "./make-sample-guidelines.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT_DIR = join(ROOT, "tmp-fixtures");

function listRecipes(): string {
  return RECIPES.map(
    (r) => `${r.name.padEnd(18)} ${r.paid ? "paid" : "free"}  ${r.calls}`
  ).join("\n");
}

// A job recipe picking up a posted job only polls, which is free.
function spends(recipe: Recipe, id?: string): boolean {
  return recipe.paid && !(recipe.resumes && id);
}

function describeRecipe(recipe: Recipe, apiUrl: string, id?: string): string {
  const inputs = Object.entries(recipe.inputs).map(([k, v]) => `  ${k}: ${v}`);
  const resuming = recipe.resumes && id;
  return [
    `Recipe ${recipe.name} against ${apiUrl}`,
    resuming
      ? `Calls: free polling of job ${id}, already posted`
      : `Calls: ${recipe.calls}`,
    ...(inputs.length && !resuming ? ["Inputs:", ...inputs] : []),
    spends(recipe, id)
      ? "This spends credits from the signed-in account. Taste does not publish prices: note the balance before and after, and log it in the pull request."
      : "Free: reads only.",
  ].join("\n");
}

// Only a person at a terminal can approve spending; a pipe or CI never can.
async function approve(
  interactive: boolean,
  ask: () => Promise<string>
): Promise<boolean> {
  if (!interactive) return false;
  return (await ask()).trim() === "yes";
}

// The id a recipe builds on: --id, else the one its recorded dependency got.
function dependencyId(
  recipe: Recipe,
  dir: string,
  given?: string
): string | undefined {
  if (given) return given;
  if (!recipe.needs) return undefined;
  const file = join(dir, `${recipe.needs}.json`);
  if (!existsSync(file))
    throw new Error(`Record ${recipe.needs} first, or pass --id <id>.`);
  const recorded = JSON.parse(readFileSync(file, "utf8")) as {
    data?: { accepted?: { submission_id?: unknown } };
  };
  const id = recorded.data?.accepted?.submission_id;
  if (typeof id !== "string") throw new Error(`${file} has no submission id.`);
  return id;
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      list: { type: "boolean", default: false },
      file: { type: "string" },
      id: { type: "string" },
    },
  });
  if (values.list || positionals.length !== 1) {
    process.stderr.write(
      `Usage: npm run fixtures:record -- <recipe> [--file <pdf>] [--id <id>]\n\n${listRecipes()}\n`
    );
    return values.list ? 0 : 2;
  }
  const recipe = findRecipe(positionals[0] ?? "");
  if (!recipe) throw new Error(`No recipe ${positionals[0]}; see --list.`);

  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  const output = createOutput({
    json: false,
    debug: false,
    theme: createTheme(0),
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  });
  const io = processIo(
    {
      stdout: (text) => process.stdout.write(text),
      stderr: (text) => process.stderr.write(text),
    },
    controller.signal
  );
  const captured = capture(globalThis.fetch);
  const ctx = createContext({ ...io, fetch: captured.fetch }, output);
  const apiUrl = ctx.env.apiUrl ?? DEFAULT_API_URL;
  try {
    const identity = await ctx.auth.describe();
    if (!identity)
      throw new Error("Not signed in: run taste login, or set TASTE_API_KEY.");
    const id = dependencyId(recipe, OUT_DIR, values.id);
    let kit: Kit | undefined;
    // The kit recipe reads the committed sample unless given another PDF.
    const file =
      values.file ?? (recipe.name === "kit" ? SAMPLE_GUIDELINES : undefined);
    if (file) kit = { name: basename(file), bytes: readFileSync(file) };
    process.stderr.write(
      `${describeRecipe(recipe, apiUrl, id)}\nSigned in with: ${identity.method}\n`
    );
    if (spends(recipe, id)) {
      const interactive = io.interactive === true;
      if (!interactive)
        process.stderr.write(
          "Refused: a paid recipe needs yes typed at a terminal.\n"
        );
      const ok = await approve(interactive, async () => {
        const rl = createInterface({
          input: process.stdin,
          output: process.stderr,
        });
        try {
          return await rl.question("Type yes to spend credits: ", {
            signal: controller.signal,
          });
        } finally {
          rl.close();
        }
      });
      if (!ok) {
        process.stderr.write("Nothing called.\n");
        return 1;
      }
    }
    const recording = await record(recipe, {
      api: ctx.api(),
      exchanges: captured.exchanges,
      sleep: io.sleep ?? (() => Promise.resolve()),
      now: Date.now,
      signal: controller.signal,
      log: (line) => process.stderr.write(`${line}\n`),
      id,
      kit,
    });
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(
      join(OUT_DIR, `${recipe.name}.json`),
      `${JSON.stringify(recording, null, 2)}\n`
    );
    process.stderr.write(
      `Wrote tmp-fixtures/${recipe.name}.json (${recording.calls.length} calls). Next: npm run fixtures:scrub (it reads every recording in tmp-fixtures/)\n`
    );
    return 0;
  } catch (error) {
    // What was sent before the failure, so a paid call that failed can still be logged.
    process.stderr.write(
      `Calls made:\n${captured.exchanges.map((e) => `  ${callLine(e)}`).join("\n") || "  none"}\n`
    );
    if (error instanceof CliError || error instanceof TasteApiError)
      return output.fail(error);
    throw error;
  }
}

if (import.meta.main)
  main().then(
    (code) => (process.exitCode = code),
    (error: unknown) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`
      );
      process.exitCode = 1;
    }
  );

export { approve, dependencyId, describeRecipe, listRecipes, spends };
