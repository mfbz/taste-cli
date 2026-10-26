# Contributing to taste-cli

Thanks for helping. taste-cli is built by people and by coding agents, with the same rules for both. Its calls spend real credits on the Taste Engine and it holds a user's sign-in, so the rules on credits and secrets come first.

## Setup

- Node 24 (`.nvmrc`), then `npm ci`. Installing also switches on the Git hooks (`core.hooksPath` → `.githooks/`).
- Windows: enable symlinks before cloning (`git config --global core.symlinks true`, Developer Mode on) so `.claude/skills` works.

```bash
npm run check          # format:check, lint, typecheck, test: must be green before a PR
npm run cli -- --help  # run the CLI from source
npm run build          # bundle to dist/main.mjs
```

## How work happens

1. **`TASTE-CLI.md` is the spec.** A change to what the CLI does (a command, a flag, an output, an error code) updates its section there in the same pull request, with acceptance checks tied to tests. Fixes, refactors, docs, CI and tooling keep it true.
2. **One topic per branch**, from an up-to-date `main`: `feat/…`, `fix/…`, `perf/…`, `docs/…`, `chore/…`, `ci/…`, `test/…`, `refactor/…`. Conventional commits.
3. **Tests first.** Write the test, watch it fail, make it pass.
4. **Green and reviewed.** `npm run check` passes locally and in CI, and the branch gets an independent, adversarial review before its pull request ([AGENTS.md](AGENTS.md), "Workflow"): findings are reproduced, then fixed or rejected with a reason in the pull request's Evidence.
5. **Pull request to `main`**, titled as a conventional commit (`fix(wait): …`). The maintainer reviews it and squash-merges it once the `ci` check passes, so each pull request becomes one commit on `main`; the branch is then deleted. If `main` moved on meanwhile, merge `main` into the branch (no force-push).

Coding agents (Claude Code, Codex and others) read [AGENTS.md](AGENTS.md) and the skills in `.agents/skills/`. Issues created with the "Task" form are ready for an agent to pick up.

## Definition of done

- The behaviour is in `TASTE-CLI.md`, and every acceptance check there is proven by a test or a named manual check.
- `npm run check` is green; CI's `ci` check is green (including the packed CLI installed and run on Linux, macOS and Windows).
- No API key, token or personal data appears in any output, log, error or fixture (tests assert it).
- The README and any doc the change makes wrong are updated.

## Fixtures and credits

Tests never call the Taste Engine. They run against recorded responses (fixtures, in `src/api/fixtures/`) and a local mock, so `npm test` is free and works offline.

- **Recording spends real credits.** Every paid call costs the maintainer money, so each one is approved by the maintainer first (what the call is, why it is needed, what it should cost) and logged in the pull request's credit log (the call, why, credits before and after when known). Free calls need no approval but are still listed.
- **One recipe per run.** `npm run fixtures:record -- --list` shows every recipe, whether it is paid and what it calls. `npm run fixtures:record -- <recipe>` uses your own sign in (`taste login`) or `TASTE_API_KEY`, prints what it will call, and for a paid recipe waits for `yes` typed at a terminal (it refuses without one). The recorder never repeats a paid call. A paid request is never retried by itself, except a search Taste turned away as busy (503), which Taste refunds.
- `kit` uploads `fixtures-input/sample-guidelines.pdf`, the guidelines of Acme, a made-up brand (four pages: cover, colors, typography, buttons and logo). It is committed so recordings are reproducible, and `npm run fixtures:sample-pdf` rebuilds it from `scripts/make-sample-guidelines.ts` (a test checks the two match). Another PDF can be given with `--file <pdf>`; it is never committed, but its file name can end up in the recorded `source_url`, so give it a neutral name.
- Recipes that build on another (`manifest`, `similar`, `enhance`, `similar-selective`) read its id from the earlier recording, or take `--id <id>`. A job recipe (an extraction, `kit`, a check) given `--id <job id>` picks up that job instead of posting a new one: if a wait times out or is interrupted, rerun it with the id it printed, and nothing is spent twice. The job must be one this recipe posted (same URL, sections or kind), or it is refused.
- **Recordings hold public content only.** `src/api/fixtures/me.json` and `history.json` are hand-written on purpose, with fake values (`user@example.com`, UUIDs starting `00000000-0000-4000-8000-`), so no account data is ever recorded. Raw answers go to `tmp-fixtures/<recipe>.json`, which Git ignores (a repo test checks it). Never add anything from it.
- **Normalise and check, then read by eye.** `npm run fixtures:scrub` reads every recipe's recording in `tmp-fixtures/` (record a recipe's `needs` too), maps the ids each recipe created to fixed fake UUIDs, sets the account fields (`user_id`, `api_key_name`, `credit_ref_id`, `batch_id`, `batch_label`) to fixed values, and strips the query and fragment from URLs off the Taste API (signed download links). It writes only files named after a recipe, so the hand-written ones are never overwritten. It then fails, listing `file:path`, if any email, JWT, Taste key, Bearer token, unmapped UUID or credential-looking URL parameter is left, and writes nothing; fix those by hand in `tmp-fixtures/` and run it again. It refuses to run if Git does not ignore `tmp-fixtures/`. Read every written file in `src/api/fixtures/` before committing it.
- A failed or refunded call is logged too: the log is the record of what was spent and why. The recorder prints the calls it made even when a recipe fails.
- **The mock.** `npm run mock` serves every endpoint the CLI calls on `127.0.0.1:4010` (`--port`, `--fast`, `--credits`), from the fixtures when they exist and synthetic data otherwise, with jobs moving through their steps over a few polls. Point taste at it with `TASTE_API_URL=http://127.0.0.1:4010` and `TASTE_API_KEY=taste_mock` (any key starting with `taste_mock`). A URL on a `.invalid` host makes a job fail, and `--credits 0` answers 402.
- **The live smoke.** `npm run smoke:live` builds the CLI and runs `whoami`, `history`, `history checks` and `history searches` against the real Taste Engine with your own sign in: free, and read-only. It prints one line per step (its name, `ok` or `failed` with the error code, how long it took) and never what Taste answered, so its output is safe to paste into a pull request. Paid commands are smoke tested by the maintainer by hand, approved and logged like any paid call.
- **The demo.** `npm run demo:record` re-records `assets/demo.gif`, the README's demo, with asciinema, agg and expect installed. It runs against the mock with a throwaway home folder, a mock key and a bare `$ ` prompt, so it is free and no path, host, user name or email can reach a frame. The `.cast` it keeps in `assets/` is ignored by Git; the GIF stays under 1 MB (the guards check). Re-record it when the opening or a command it shows changes, and look at the frames before committing.

## Guards

Every change passes the same guards, whoever writes it. They run three times:

- **On every commit.** `.githooks/pre-commit` checks what is staged and `.githooks/commit-msg` checks the message, so nothing bad ever becomes a commit. Plain Node 24 runs them; nothing needs installing first.
- **In `npm test`.** `tools/checks/guards-repo.test.ts` checks every file Git would commit, so a skipped hook is still caught in CI.
- **On every pull request.** CI's `pull-request` job checks the title (a conventional commit) and the description with the commit-message guards, because together they become the squash commit on `main`.

The guards block:

- private key blocks, Taste API keys (`taste_…`) and signed-in session tokens (JSON Web Tokens)
- the usual API and token formats (GitHub, npm, AWS, Slack, Google, OpenAI, Anthropic)
- the home folder of the computer running the check
- an AI tool or bot credited as a co-author (people crediting each other is fine)
- files over 1 MB

Claude Code is also denied `--no-verify`, changing `core.hooksPath`, editing `.githooks/`, pushing to `main` and merging pull requests (`.claude/settings.json`). Other agents get the same rules from AGENTS.md.

If a guard trips:

- **A key or token:** remove it and revoke it with its provider (a Taste key in the Taste Engine dashboard). If it was ever pushed anywhere, deleting it from Git isn't enough.
- **A path or an attribution line:** fix the file, or whatever generated it.

## Releasing

Nothing is published, and nothing can be while the repository is private: the release workflow refuses to run then. Once it is public, releases are by hand only:

- `.github/workflows/release.yml` runs from **Actions → Release → Run workflow** on `main`, with a version (`x.y.z`). It stamps the version, runs `npm run check`, packs, publishes to npm with provenance through trusted publishing (no npm token anywhere), and creates the GitHub release `vx.y.z` with notes from the merged pull request titles.
- The first version is `0.0.1`, which `package.json` holds; each release stamps the version it publishes, and its tag records it.
- Pull request titles become the release notes: write them for the people who use taste-cli.

## Repository settings (maintainer)

- Pull requests: squash merging only, with the pull request title and description as the commit; "Always suggest updating pull request branches" and "Automatically delete head branches" on.
- Wiki, Projects and Discussions off. Dependabot alerts and security updates on.
- A ruleset on `main`: pull requests only, squash only, the `ci` check required on an up-to-date branch, no force-push, no deletion.
- Secret scanning with push protection, and private vulnerability reporting ([SECURITY.md](SECURITY.md)).

Before the first release:

1. Claim the name: from a clean checkout of `main`, `npm publish --access public` by hand with your own npm account and two-factor authentication. This publishes the empty `0.0.0`; npm only offers trusted publishing for a package that exists.
2. On npmjs.com, in the package's settings: add a trusted publisher for this repository's `release.yml` with environment `npm`, then set publishing access to "Require two-factor authentication and disallow tokens".
3. On GitHub: create the `npm` environment, allowed to deploy from `main` only.

## Licence of contributions

Contributions are accepted under the [MIT licence](LICENSE).
