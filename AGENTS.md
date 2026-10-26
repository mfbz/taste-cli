# AGENTS.md: taste-cli

taste-cli is an unofficial command line for the Taste Engine, Taste Labs' design API: extract a brand from a URL, search brands, check brand adherence and export a DESIGN.md, from a terminal, a script, CI or an agent. Its calls spend a user's credits, so credit and secret rules come before features. This file is for every coding agent; keep it short and move detail into skills.

Read in this order, only as far as the task needs:

1. `TASTE-CLI.md`: what the CLI is and how every command behaves (the source of truth). When code and that file disagree, flag it; never drift silently.
2. The skill for the area you touch (`.agents/skills/`, also visible to Claude Code as `.claude/skills/`).
3. `DESIGN.md` for anything a person sees in the terminal.

## Map

| Path                | What                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------- |
| `src/`              | the CLI: `main.ts` (bin entry), `cli.ts` (`run(argv, io)`), then one folder per layer |
| `src/output/`       | the error catalogue and the one way results and failures are written                  |
| `tools/checks/`     | guards (keys, tokens, personal paths, AI attribution, size) and repo-invariant tests  |
| `.githooks/`        | `pre-commit` and `commit-msg`, running the guards with plain Node                     |
| `.agents/skills/`   | skills for agents working on this repo                                                |
| `.github/`          | CI, the manual release, PR and issue templates                                        |
| `docs/superpowers/` | gitignored scratch for designs and plans; never committed                             |

## Commands

```bash
npm ci                 # install (Node 24, .nvmrc); also switches on the Git hooks
npm run check          # green checkpoint: format:check, lint, typecheck, test
npm run format         # Prettier (a Claude hook also formats each edited file)
npm test               # Vitest: src/ and tools/checks/, including the repo-wide guards
npm run build          # bundle to dist/main.mjs (tsdown)
npm run cli -- --help  # build, then run the CLI
```

## Decisions that bind

- Never read as official Taste Labs software, and never say why this tool exists. "Unofficial, not affiliated with Taste Labs, built on the Taste Engine API" appears in the README, the `--help` footer and NOTICE.
- No personal data in the repo: no author email, no absolute paths, no real user IDs or emails in fixtures, no API keys. Anyone may use and read this repo.
- No secrets in argv, in logs, in `--debug` output or in error messages.
- Never spend a user's credits by surprise (`TASTE-CLI.md`, "Credits").
- An animation never slows down or pollutes scripted use: it never plays outside an interactive terminal.
- An inaccurate DESIGN.md export is a failure: every value comes from the extraction; nothing is invented to fill a gap.
- Output: `--json` prints exactly one JSON document on stdout, errors included (`{ "ok": true, "data": … }` or `{ "ok": false, "error": { "code", "message", "hint", "retryable" } }`). Exit codes: 0 ok, 1 failure, 2 usage, 130 interrupted.
- **Errors come from the catalogue only** (`src/output/errors.ts`): never print a library's or the API's error text, or a typed value. Add a catalogue code instead.
- **Credits are real money:** every paid call is approved by the maintainer first and logged in the PR. Development runs against recorded fixtures and a local mock.
- No telemetry, no update notifier, no config file. No runtime dependency without the maintainer's OK. KISS.

## Code conventions

Details and examples: skill `taste-cli-conventions`.

- TypeScript strict (`noUncheckedIndexedAccess`, `erasableSyntaxOnly`), ES modules, kebab-case files, named exports, no barrel files, relative imports with the `.ts` extension, `import type` for types.
- File order: imports → types → constants → private helpers → exported functions; one `export { … }` at the end. Comments explain why, never what.
- zod at every boundary (env, files, network, CLI input). Tests co-located as `*.test.ts` (Vitest), `it` strings read as behaviour.

## Workflow

Details: skill `taste-cli-workflow`.

- `TASTE-CLI.md` is the one living spec. A change to what the CLI does edits its section there (behaviour, flags, the `--json` shape, acceptance checks tied to tests) in the same PR. Docs change with behaviour: `TASTE-CLI.md`, `README.md`, `DESIGN.md` and the skills describe what exists.
- Designs and plans are scratch in `docs/superpowers/` (gitignored); the PR description is the record.
- Stay inside the task; list anything else under "Follow-ups" in the PR.
- Test first: watch the test fail, then make it pass.
- Run `npm run check` before saying you are done, and quote its result.
- Before opening a PR, get an independent, adversarial review of the branch from a fresh context that didn't write it (Claude Code: `/code-review high`, plus `/security-review` for sign-in, stored credentials, downloads, the guards, settings or workflows; Codex: `codex review`). Findings are claims to verify: reproduce each one (a failing test or command) before fixing it, or reject it with a reason. Record what was found, fixed and rejected in the PR's Evidence.
- Ask the maintainer when `TASTE-CLI.md` is ambiguous; don't guess on product decisions. Mark anything unverified as such.

## Git

- Trunk-based: `main` is the only long-lived branch and is always green. Every change starts on a short branch from an up-to-date `main`: `feat/…`, `fix/…`, `perf/…`, `docs/…`, `chore/…`, `ci/…`, `test/…`, `refactor/…`. Conventional commits (`feat(extract): …`, `fix(wait): …`).
- A change reaches `main` only through a pull request whose checks pass. Push the branch, open the PR against `main` (`gh pr create`) with the template filled in; its title is a conventional commit, because it becomes the one commit on `main`. The maintainer reviews and squash-merges it; agents never merge.
- Behind `main`? Merge `main` into your branch (no rebase of pushed work, no force-push). Never push to `main`, never commit `.env` files, keys or tokens.
- Never bump versions (they stay `0.0.0` in the code), create tags or publish; releases are the maintainer's, by hand (CONTRIBUTING "Releasing").
- Never credit an AI tool as an author: no `Co-Authored-By` trailers for coding agents, no "Generated with …" lines, in commits, PRs, issues or docs.
- Guards check every commit (Git hooks, on from `npm install`), every committable file (`npm test`) and every PR's title and description (CI): no keys or tokens (Taste keys and session tokens included), no home-folder paths, no AI attribution, nothing over 1 MB. Fix the cause; never weaken a guard, never `--no-verify`, never change `core.hooksPath`.
