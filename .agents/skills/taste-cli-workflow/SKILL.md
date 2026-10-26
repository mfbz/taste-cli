---
name: taste-cli-workflow
description: Use when starting, finishing or shipping any change in the taste-cli repo. Covers branches and pull requests, the definition of done, the independent review, the credit rule for paid Taste Engine calls and how to ask for one, recording and scrubbing fixtures, the release workflow, and keeping TASTE-CLI.md, README, DESIGN.md and the skills in step with behaviour.
---

# taste-cli workflow

## Branches and pull requests

- `main` is the only long-lived branch and is always green. Start every change on a short branch from an up-to-date `main`: `feat/…`, `fix/…`, `perf/…`, `docs/…`, `chore/…`, `ci/…`, `test/…`, `refactor/…`. One topic per branch; conventional commits (`feat(extract): …`).
- Open the pull request against `main` with the template filled in. Its title is a conventional commit and, with the description, becomes the one squash commit on `main` and the release note. CI checks both with the commit guards.
- The maintainer squash-merges. Agents never merge, never push to `main`, never force-push, never `--no-verify`. Behind `main`? Merge `main` into the branch.
- Never bump the version (`package.json` stays `0.0.0`), tag or publish.
- No AI attribution anywhere: no `Co-Authored-By` trailers for tools, no "Generated with" lines.

## Definition of done

1. The behaviour is in its `TASTE-CLI.md` section (flags, `--json` shape, error codes, acceptance checks), and every acceptance check is proven by a test or a named manual check.
2. Test first: the test was seen failing for the right reason, then passing.
3. `npm run check` is green, and its result is quoted in the pull request.
4. No key, token or personal data reaches any output, log, error or fixture.
5. Docs change with behaviour, in the same pull request: `TASTE-CLI.md`, `README.md` (only what exists, never what is planned), `DESIGN.md` for anything a person sees, and the skills (this one, `taste-cli-conventions`, and the user skill once it exists). Repo tests check that the README names only real commands, flags and scripts.

## The independent review

Before opening the pull request, get an adversarial review from a fresh context that didn't write the change: Claude Code `/code-review high`, plus `/security-review` for sign-in, stored credentials, downloads, the guards, settings or workflows; or `codex review`. Treat findings as claims: reproduce each one with a failing test or command before fixing it, or reject it with a reason. Record found, fixed and rejected in the pull request's Evidence.

## Credits: the paid-call rule

Credits are the maintainer's money. Every paid call is approved by the maintainer first and logged in the PR.

- Paid: extractions (full, selective, deep, map), brand kits, searches (deep costs more), similar brands, adherence checks, and treat prompt enhancement as paid until proven otherwise. Free: reading the account, history, results of finished jobs, manifests.
- Ask before each paid call, one call per question, in this shape:
  - **Call:** the exact command or request (`taste extract https://stripe.com/ --json`).
  - **Why:** what it proves or records, and why a fixture or the mock can't do it.
  - **Expected cost:** an estimate in credits, marked as an estimate (prices per operation aren't published).
- Wait for a yes. No answer is a no. Never batch several paid calls under one yes, never retry a paid call automatically, and never spend more than the budget the maintainer set.
- Log every call in the pull request's credit log table (call, why, credits before and after when known), refunded failures included.

## Fixtures

Tests never call the Taste Engine: they use the fake API (`src/api/fake-api.ts`, seeded from the fixtures with `fixtureState()` from `src/api/fixtures.ts`), recorded responses and the local mock (`npm run mock`, CONTRIBUTING "Fixtures and credits").

- Recording runs one named recipe per invocation (`npm run fixtures:record -- <recipe>`; `--list` shows them, paid or free, with what each calls), after the maintainer's yes, using the maintainer's own sign in. A paid recipe asks for `yes` at a terminal and refuses without one. A job recipe given `--id <job id>` picks up a posted job with free polling, so a timeout or Ctrl-C never costs a second call. Record `history` last. Raw output goes to the gitignored `tmp-fixtures/`, never into `src/` and never into Git.
- An agent never runs a paid recipe itself: it asks in the shape above, and the maintainer runs it. Develop and demo against the mock instead.
- Scrub before committing (`npm run fixtures:scrub`): emails become `person@example.com`, user IDs a fixed placeholder UUID, the key id `key_example`, key names, batch and credit references placeholders, each replaced wherever else it appears; keys and tokens are removed, URLs off the Taste API lose their query, the history keeps only the recipes' own entries, and long arrays and strings are trimmed so every file stays under 200 KB. The guards run on the result, and nothing is written if one trips.
- Log every recorded recipe in the pull request's credit log, free ones and refused ones included.

## Releasing

Nothing is published while the repository is private, and the release workflow refuses to run then. Once the maintainer opens the repository, a release is by hand only: Actions → Release → Run workflow on `main` with a version `x.y.z` (CONTRIBUTING.md, "Releasing" and "Repository settings"). It stamps the version, runs `npm run check`, packs, publishes with provenance through trusted publishing, and creates the GitHub release from the merged pull request titles.
