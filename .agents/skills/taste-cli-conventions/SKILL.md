---
name: taste-cli-conventions
description: Use when writing or reviewing code in the taste-cli repo. Covers the layout by layer, TypeScript rules, file order and exports, zod at boundaries, keeping API keys and tokens out of argv, logs and errors, the output contract (--json, exit codes, stderr), test style with Io seams and the fake API, and the green checkpoint.
---

# taste-cli code conventions

## Layout

- One package at the root. `src/main.ts` is the bin entry and only wires `process` to `run(argv, io)` in `src/cli.ts`, which returns the exit code. Every side effect (writing, fetch, the clock, sleeping, the browser, the keychain, prompts, the loopback server) reaches a command through `Io`, so all behaviour is tested in-process without spawning anything.
- `src/` is split by layer. A folder appears with the first code that needs it:
  - `output/`: the `--json` contract, the error catalogue, terminal detection, the theme, and the live progress line (the one place a timer writes to stderr).
  - `api/`: the typed REST client, zod schemas, polling and the fake API.
  - `auth/`: OAuth discovery, browser sign-in, the credential store, refresh.
  - `commands/`: one file per command, its logic plus its `render*` functions; `job.ts` holds what the job commands share (start, wait with progress, show, route an id by kind, save `--out` files).
  - `render/`: terminal pieces shared by several commands (score bars, swatches, progress).
  - `design-md/`, `download/`, `ui/` (the opening, the menu, the cursor), `config/` (environment, paths).
- Boundaries: `api/` never prints, `commands/` never call `fetch` (they get a `TasteApi`), `render/` is pure (data in, string out).
- Tests sit next to the code they cover. Repo rules live in `tools/checks/` as tests, so they fail loudly instead of being forgotten.

## TypeScript

- Strict, `noUncheckedIndexedAccess`: handle `undefined` from indexing instead of using `!`, except in tests.
- `erasableSyntaxOnly`: no enums, namespaces or parameter properties, so Node runs the TypeScript directly (tests, scripts, `node src/main.ts`).
- kebab-case file names; named exports; no `index.ts` barrels; import from the source file with its `.ts` extension; `import type` for types.
- File order: imports → types → constants → private helpers → exported functions. End modules with one `export { … }` line (and `export type { … }`).
- Comments explain why (a constraint, a trade-off, a past bug), never what.
- Paths from `import.meta.url`, never `process.cwd()`. Settings come from flags and `process.env` only; never read a `.env` or a config file.

## Boundaries

- Validate with zod wherever data enters: environment, files, API responses, CLI arguments. Inside, trust the types.
- Server text is untrusted: run it through `plain()` (`src/output/output.ts`) before it reaches a terminal.
- Paths and URLs in a download manifest are untrusted too: files are written only through `writeBundle` (`src/download/bundle.ts`), which checks every path and URL before writing anything and never writes through a symlink. A failure after a job is done goes through `whileSaving`, so it keeps the job's id and the free `taste wait <id> --out` hint. The client caps every answer it reads (8 MB for the API, 100 MB for an asset).
- No new runtime dependency without the maintainer's OK; a small algorithm is inlined with tests instead.

## Secrets

- API keys and tokens never come from argv, and never reach logs, `--debug` output, error messages or `--json` documents. A key-shaped argument is refused.
- Errors: throw `new CliError(CODE, params)` with a code from the catalogue in `src/output/errors.ts` (add one if needed). Never put a library's or the API's message, or a typed value, into output; params must be names, paths or words (anything else shows as "…").
- Tests build key- and token-shaped values at run time from parts. Never a literal key in the repo: the guards block it.

## Output

- `--json`: exactly one JSON document on stdout, errors included (`{ "ok": true, "data": … }` or `{ "ok": false, "error": { "code", "message", "hint", "retryable" } }`); nothing else on stdout.
- Exit codes: 0 ok, 1 failure, 2 usage, 130 interrupted.
- Human output: results on stdout; errors, notes, progress and prompts on stderr. Colour and motion only when the terminal allows them (`NO_COLOR`, `FORCE_COLOR`, `CI`, `TERM=dumb`, `--no-motion`, a pipe).
- Copy follows `DESIGN.md`: short and plain, no em dashes, no exclamation marks.

## Tests

- Vitest, `foo.ts` next to `foo.test.ts`; `describe` per unit, `it` as a behaviour sentence.
- Write the test first and watch it fail for the right reason.
- Drive commands through `run(argv, io)` with a captured `stdout`/`stderr` and the seams the command needs (the fake API as `io.api`, a fake clock, an instant `sleep`; `src/job-seams.ts` sets these up for the job commands from the recorded fixtures). Never call the live Taste Engine from a test: use the fake API and recorded fixtures, or the local mock with `io.fetch`.
- A paid request is sent once. A failure in flight carries `{ paid: "yes" }` so its hint says to check `taste history`, and a failure while waiting on a started job carries the job's id (`whileWaiting`) so its hint says `taste wait <id>`; never a bare "try again". Start a paid job through `startJob` and wait through `awaitJob` (`src/commands/job.ts`): they tell the hard stop (`ctx.inFlight`) what a Ctrl-C would leave behind.
- Cover what users will hit, not only the happy path: piped output, `--json`, bad input, a missing sign-in, a 402, a network failure, Ctrl-C.

## Green checkpoint

`npm run check` = format:check + lint (zero warnings) + typecheck + test. Run it before saying you are done.

Example module shape:

```ts
import { z } from "zod";

import { CliError } from "../output/errors.ts";

type Limit = { limit: number };

const MAX_LIMIT = 100;
const LIMIT = z.coerce.number().int().min(1).max(MAX_LIMIT);

function parseLimit(text: string): Limit {
  const parsed = LIMIT.safeParse(text);
  if (!parsed.success)
    throw new CliError("USAGE_INVALID_VALUE", { option: "--limit" });
  return { limit: parsed.data };
}

export { parseLimit };
export type { Limit };
```
