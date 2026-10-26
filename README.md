# taste-cli

Taste in your terminal, your scripts, your CI and your agents.

> taste-cli is unofficial, not affiliated with Taste Labs, built on the Taste Engine API.

![taste opening its menu, extracting stripe.com, saving it as a DESIGN.md, and checking it against another brand with a minimum score](assets/demo.gif)

A command line for the [Taste Engine](https://docs.tastelabs.com), Taste Labs' design API. Extract a brand from a website or a guidelines PDF, export it as a DESIGN.md, check a site against a brand, search brands, find similar ones and enhance prompts, from a terminal, a script, CI or an agent. Every behaviour below is specified in full in [TASTE-CLI.md](TASTE-CLI.md).

## Contents

- [Status](#status)
- [Install](#install)
- [Quick start](#quick-start)
- [Interactive mode](#interactive-mode): `taste` on its own
- [Sign in](#sign-in): `login`, `logout`, `whoami`
- [Credits](#credits)
- [Extract a brand](#extract-a-brand): `extract`
- [Extract a brand kit](#extract-a-brand-kit): `kit`
- [Check a site against a brand](#check-a-site-against-a-brand): `check`
- [Pick a job up again](#pick-a-job-up-again): `wait`
- [Save the files](#save-the-files): `--out`
- [Export a DESIGN.md](#export-a-designmd): `--format design-md`
- [Search brands](#search-brands): `search`, `similar`
- [Enhance a prompt](#enhance-a-prompt): `enhance`
- [History](#history): `history`
- [Share a result](#share-a-result): `share`
- [Brand checks in CI](#brand-checks-in-ci)
- [Scripts and agents](#scripts-and-agents): pipes, CI gates, the agent skill
- [Machine output](#machine-output): `--json`, exit codes, Ctrl-C
- [Error codes](#error-codes)
- [Environment and terminal](#environment-and-terminal)
- [Development](#development)

## Status

Every command is built: `taste` signs in, extracts a brand from a website or a brand guidelines PDF, saves its files, exports it as a DESIGN.md, checks a site against a brand, picks up a job started earlier, searches brands, finds similar ones, enhances prompts, lists your history and shares a result. It isn't released yet: it runs from source (see [Install](#install)), and the few paths that have only run against the local mock say so where they are described.

## Install

Node.js 24 or later. taste-cli isn't on npm; run it from source:

```sh
git clone https://github.com/mfbz/taste-cli.git
cd taste-cli
npm ci
npm run build
npm link        # puts `taste` on your PATH
```

```sh
taste --help      # every command; --help after a command for its flags
taste --version   # the version
```

## Quick start

```sh
taste login                                     # sign in with your browser
taste extract stripe.com                        # a brand from a website (spends credits)
taste wait <id> --format design-md > DESIGN.md  # that result as a DESIGN.md, for free
taste check https://preview.acme.com --against acme.com --min 0.8   # exit 1 below 0.8
taste                                           # or a menu of every action
```

## Interactive mode

Run `taste` on its own in a terminal for a menu:

```sh
taste
```

A short opening types `◇ taste` with its tagline and version over a thin rule, a line says who you are signed in as, and a menu offers every action: extract a brand, check brand adherence, search brands, a brand kit from a PDF, enhance a prompt, your history, sign in or out. Each action asks for what it needs, marks what spends credits and asks before spending them, then runs the same code as the command typed directly. Ctrl-C at a prompt goes back to the menu; at the menu it quits.

It never runs in a pipe, in CI (`CI` set), under `TERM=dumb` or under `--json`: there `taste` prints the help, with no animation. Any key skips the opening; `TASTE_NO_MOTION=1` (or `NO_COLOR`) shows only its last frame.

## Sign in

```sh
taste login                              # sign in with your browser
taste login --api-key                    # or type an API key at a hidden prompt
taste login --with-api-key < key.txt     # or pipe one in, for scripts and CI
taste whoami                             # which account taste is using
taste logout                             # forget the saved sign in
```

Free: no credits are spent.

| Command        | Prints                                                                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `taste login`  | `✓ Signed in as <email>.`, or with a key `✓ Signed in as <email> with an API key.` (`✓ Signed in.` when Taste returns no email)  |
| `taste whoami` | `Signed in as <email> (browser session).`, `Signed in as <email> (API key).` or `Using an API key from TASTE_API_KEY (<email>).` |
| `taste logout` | `✓ Signed out.` Signing out twice is not an error. It doesn't sign the browser out of Taste.                                     |

- `taste login` opens the browser and prints the address on stderr too, in case the browser doesn't open. The session refreshes itself.
- The browser and the hidden prompt need a terminal. Without one, or under `--json`, they fail with `LOGIN_NOT_INTERACTIVE`: pipe a key to `taste login --with-api-key` instead, or set `TASTE_API_KEY`.
- A key is checked with Taste before it is saved, so a wrong key replaces nothing (`INVALID_API_KEY`). taste never takes a key as a command line argument: one in argv is refused with `KEY_IN_ARGV`.
- The sign in is kept in your system keychain (service `taste-cli`), or, where there is none, in a file only you can read in `~/.config/taste-cli` (`%APPDATA%\taste-cli` on Windows), with a warning each time.
- `TASTE_API_KEY` uses a key without saving it, and wins over any saved sign in; `login`, `logout` and `whoami` say so.

`--json` data: `login` gives `{"method":"session"|"key","email","store":"keychain"|"file"}`, `whoami` gives `{"method":"env-key"|"key"|"session","email","store"}` (`store` is `null` for `env-key`), `logout` gives `{"signedOut":true}`.

## Credits

`extract`, `kit`, `check`, `search`, `similar` and `enhance` spend credits from your Taste account; everything else is free. Their `--help` says so, and typed directly they never ask for confirmation: typing the command is the decision. The [interactive menu](#interactive-mode) asks first.

- Every flag, address and file is checked before the one request that spends credits, so a mistake costs nothing.
- A paid request is never retried by itself, except a search Taste turned away as busy (503), which Taste refunds.
- A paid request that fails on the way (network, timeout, Ctrl-C, a 5xx from Taste) may still have been charged. Its error is not retryable and says where to look first: `taste history` for an extraction or a brand kit, `taste history checks` for a check, `taste history searches` for a search or similar brands, your credits in your Taste account for an enhancement.
- Once a job (`extract`, `kit`, `check`) has started it runs on Taste's side whatever happens to taste: the error names its id, and `taste wait <id>` picks it up for free.
- Failed jobs, searches and similar-brand requests are refunded by Taste.

## Extract a brand

```sh
taste extract stripe.com                               # wait with live progress, then a summary
taste extract stripe.com --sections colors,typography  # only some sections
taste extract stripe.com --deep                        # slower, deeper analysis
taste extract stripe.com --force                       # again, even if Taste has a recent result
taste extract stripe.com --map --max-urls 20           # find the site's pages and extract them too
taste extract stripe.com --format json > stripe.json   # the whole result, as Taste sent it
taste extract stripe.com --format design-md > DESIGN.md  # the brand as a DESIGN.md file
taste extract stripe.com --no-wait                     # print the job's id and return
taste extract stripe.com --timeout 1200                # wait up to 20 minutes
```

Spends credits.

- **The address**: a public `http` or `https` address. A bare domain such as `stripe.com` means `https://stripe.com/`. An address on this computer or a private network (`localhost`, `127.0.0.1`, `10.x`, `192.168.x`, `*.local`, `file:`) fails with `PRIVATE_URL`, anything else unusable with `INVALID_URL`, both before any request.
- `--sections <names>`: only these, separated by commas: `profile`, `layout`, `colors`, `typography`, `surfaces`, `elevation`, `interactions`, `actions`, `navigation`, `data_display`, `structure`, `icons`, `assets`, `sections`, `brand_assets`. An unknown or empty name fails with `USAGE_INVALID_SECTIONS`. `similar` and `enhance` can't use an extraction made with `--sections`.
- `--deep`: Taste's slower, deeper analysis. Not with `--sections` (`USAGE_CONFLICTING_OPTIONS`).
- `--force`: extract again even when Taste holds a recent result.
- `--map`: find the site's pages and extract them too; `--max-urls <n>` (1 to 200) caps how many. Not with `--sections` (`SELECTIVE_MAP_UNSUPPORTED`); `--max-urls` needs `--map` (`USAGE_NEEDS_OPTION`). Map mode has only been run against the local mock so far.
- `--format <format>`: `summary` (the default), `json`, or `design-md`, the brand as a DESIGN.md file (see [Export a DESIGN.md](#export-a-designmd)).
- `--no-wait`: print the job's id alone on stdout and return at once; stderr says `Started. Run taste wait <id> to pick it up.` Under `--json` the data is `{"id","status"}`.
- `--timeout <seconds>`: stop waiting after this long (default 600, at most 86400). The job carries on: `WAIT_TIMEOUT` names `taste wait <id>`.
- `--out <dir>`, `--overwrite`: save the result's files, see [Save the files](#save-the-files).

While it waits, progress goes to stderr (one line redrawn in place in a terminal, one line per step elsewhere, nothing under `--json`), ending with `✓ Extracted <brand> in 48s` or `✓ Extracted <brand> (cached)`. The summary on stdout: the brand and its tagline, style, tone, the palette as swatches with hexes and names, the type families, the source address, the id, and `taste wait <id> --format json` for everything.

`--json` data: the result exactly as Taste returned it.

## Extract a brand kit

```sh
taste kit guidelines.pdf
taste kit guidelines.pdf --no-wait
taste kit guidelines.pdf --out acme --format json
taste kit guidelines.pdf --format design-md > DESIGN.md
```

Spends credits. Extracts a brand kit from a brand guidelines PDF. The file is checked before the upload: it must exist and be a file (`FILE_NOT_FOUND`), be at most 50 MB (`FILE_TOO_LARGE`) and be a PDF that isn't empty (`INVALID_FILE`). It takes `--format`, `--no-wait`, `--timeout`, `--out` and `--overwrite` as `extract` does, with the same progress, summary and `--json` shapes.

## Check a site against a brand

```sh
taste check https://acme-git-feature.vercel.app --against https://acme.com             # a preview against production
taste check https://acme-git-feature.vercel.app --against https://acme.com --min 0.8   # exit 1 below 0.8
taste check https://acme-git-feature.vercel.app --against https://acme.com --json | jq '.data.score'
taste check https://acme-git-feature.vercel.app --against https://acme.com --no-wait   # print the job's id and return
```

Spends credits. Judges how closely the first site follows the brand of the one after `--against`. Both addresses are checked as `extract` checks its address (`PRIVATE_URL`, `INVALID_URL`) before anything is spent.

- `--min <score>`: a score from 0 to 1 the check must reach, for CI. Below it (or with no score at all) the command exits 1 with `BELOW_THRESHOLD`. Anything outside 0 to 1 fails with `USAGE_INVALID_VALUE`. Without `--min` a finished check always exits 0. Not with `--no-wait` (`USAGE_CONFLICTING_OPTIONS`).
- `--no-wait`, `--timeout <seconds>`: as for `extract`.

Progress goes to stderr as for `extract`, ending with `✓ Checked <host> in 4m 01s`. On stdout: the score with two decimals and a 20-cell bar (with `✓` or `✗` and the minimum only with `--min`), the two addresses, every recommendation numbered in Taste's order, the fixes counted by action with the first three in full, the id and `taste share <id>`. Below `--min` the verdict is printed, then the error. A check that fails on Taste's side ends with `ADHERENCE_FAILED` and its reason; Taste refunds it.

`--json` data: `{"id","score","passed","min","recommendations","fixes"}`; `passed` and `min` are `null` without `--min`. Below `--min` the document is the `BELOW_THRESHOLD` error, with that same data in `error.details`, so a script has the recommendations without another call.

## Pick a job up again

```sh
taste wait <id>                      # an extraction, a brand kit or a brand adherence check
taste wait <id> --format json        # the whole result
taste wait <id> --format design-md > DESIGN.md   # an extraction or a brand kit as a DESIGN.md, for free
taste wait <id> --timeout 1200
taste wait <id> --out stripe         # save a finished extraction's files, for free
```

Free. Picks up a job started with `--no-wait`, or one interrupted or out of time, and ends as the command that started it would. The id may be an extraction, a brand kit or a brand adherence check; one that is neither fails with `NOT_FOUND`. A check ends as `taste check` without `--min` does. `--out` with a check's id fails with `USAGE_OUT_UNSUPPORTED`, and `--format design-md` with `USAGE_FORMAT_UNSUPPORTED`. `--timeout` and `--format` work as for `extract`.

`--json` data: the result, or for a check the verdict, exactly as Taste returned it.

## Save the files

```sh
taste extract stripe.com --out stripe            # extract, then save its files into ./stripe
taste wait <id> --out stripe --overwrite         # save them again, for free
```

`extract`, `kit` and `wait` take `--out <dir>`: once the job is done, its files (`guidelines.json`, `design_system.md`, the captured HTML, CSS and screenshot, the brand's assets) are saved under `dir`, and a line on stderr says how many and where.

- The folder is checked before anything is spent. It may be missing (it is created, readable only by you) or empty. One with files in it fails with `OUTPUT_EXISTS` unless you add `--overwrite`, which replaces files of the same name.
- Use a folder only you can write to: on macOS and Linux one that others can write to fails with `BUNDLE_PATH_UNSAFE`, so `--out /tmp` is refused before anything is spent.
- Nothing is ever written outside the folder or through a symlink: a file path from Taste that would leave it fails with `BUNDLE_PATH_UNSAFE`, and nothing is written.
- An asset that is gone for good (refused at its own address, or over 100 MB) is skipped with a warning; under `--json` the data gains `"skipped":[{"path","status"}]`.
- Once the job is done, every failure to save keeps its id (`error.details.id`) and says how to get it again for free: `taste wait <id> --out`, or `taste wait <id>` for `BUNDLE_INVALID`.

## Export a DESIGN.md

```sh
taste extract stripe.com --format design-md > DESIGN.md           # extract, then write the file
taste kit guidelines.pdf --format design-md > DESIGN.md           # from a brand guidelines PDF
taste wait <id> --format design-md > DESIGN.md                    # from a finished job, for free
taste extract stripe.com --format design-md --out stripe          # print it, and save stripe/DESIGN.md with the other files
```

`--format design-md` turns a finished extraction or brand kit into a [DESIGN.md](https://github.com/google-labs-code/design.md), the format coding agents read to follow a design system. The file goes to stdout and progress to stderr, so redirecting stdout gives a clean file. With `--out` it is also saved as `DESIGN.md` in the folder.

- It follows the DESIGN.md format version `alpha`: front matter with `name`, `description` and the tokens (`colors`, `typography`, `spacing`, `components`), then the sections Overview, Colors, Typography, Layout, Elevation & Depth, Components and Do's and Don'ts.
- Only what the extraction holds is written. A token or section with nothing behind it is left out, never guessed. Token names are the extraction's own, such as `blurple` or `heading-xl`.
- It is rendered on your computer from the result: no extra request, no extra credits.
- It ends with where and when it was extracted: `Extracted from https://stripe.com/ on 2026-10-20 with the Taste Engine, via taste-cli 0.0.0 (unofficial).`
- `--json` still prints the result as Taste sent it.

How each field maps, and the examples rendered from recorded results, are in [TASTE-CLI.md](TASTE-CLI.md) and `src/design-md/__golden__/`.

## Search brands

```sh
taste search "dark brutalist developer tools"                 # 6 brands, fast
taste search "calm fintech pricing" --deep --top 10           # slower, closer, with a reason per brand
taste search "playful onboarding" --industry saas --page-type landing_page
taste similar stripe.com                                      # brands that look like your stripe.com extraction
taste similar <id> --top 5
taste search "dark brutalist developer tools" --json | jq -r '.data.results[].url'
```

`search` and `similar` spend credits (a deep search costs more). Both answer at once, with no job to wait for, and print numbered cards: the brand and how well it matched, its address, why it matched (or how it looks), its primary colours and its tags. In a terminal each line is cut to the width; a pipe gets every line whole.

- `search "<query>"`: the look you want, 2 to 400 characters (`USAGE_INVALID_QUERY` otherwise).
  - `--deep`: a slower, closer search; each brand says why it matched.
  - `--top <n>`: 1 to 30 brands (Taste's default is 6).
  - `--industry <industry>`, `--page-type <type>`: only brands of that kind. An unknown value fails with `USAGE_INVALID_INDUSTRY` or `USAGE_INVALID_PAGE_TYPE`; `taste search --help` lists them all.
- `similar <id|url>`: brands from Taste's corpus that look like one of your full extractions.
  - Give an extraction's id, or the site's address: taste finds your newest finished full extraction of it with a free lookup, and never starts one. With none it fails with `NOT_FOUND`, with only ones made with `--sections` with `FULL_EXTRACTION_REQUIRED`; both name the `taste extract <url>` to run, and spend nothing. A bare word such as `stripe` fails with `USAGE_INVALID_BRAND`, which suggests `stripe.com`.
  - `--top <n>`: 1 to 30 brands (Taste's default is 18).

`--json` data: Taste's answer as it came. A search is `{"search_id","depth","results":[…],"query_tags":{…}}`; similar is `{"results":[…]}`. Each result is a card with `url`, `brand_name`, `identity_paragraph`, `match`, `reason`, `badge`, `tags`, `palette`, `typography` and `screenshot_url`.

## Enhance a prompt

```sh
taste enhance "Design a pricing page" --brand stripe.com
taste enhance "Design a pricing page" --brand stripe.com | pbcopy    # straight to the clipboard
taste enhance "An onboarding flow" --brand <id> > prompt.txt
```

Spends credits. Rewrites a prompt in a brand's terms, from one of your full extractions.

- `"<prompt>"`: sent as you typed it; a blank one is refused with `USAGE_INVALID_PROMPT`.
- `--brand <id|url>`: required. An extraction's id or a site's address, found as `similar` finds it, with the same errors.

The enhanced prompt alone goes to stdout, ending with one newline, so it pipes cleanly; `✓ Enhanced for <brand>.` goes to stderr. `--json` data: Taste's answer, `{"enhanced_prompt","brand_name","source_url","model_used"}`.

## History

```sh
taste history                                  # your extractions and brand kits, newest first
taste history checks --status failed           # brand adherence checks that failed
taste history searches --search fintech        # searches whose query has "fintech"
taste history --limit 50 --offset 50           # the next page
```

Free. Lists one page of a list, newest first: `extractions` (the default, brand kits included), `checks` or `searches` (similar brands included).

- `--status <status>`: extractions take `accepted`, `queued`, `crawling`, `extracting`, `completed`, `failed`; checks take `accepted`, `extracting`, `judging`, `completed`, `failed`; searches take `completed`, `failed`, `in_progress`. Any other fails with `USAGE_INVALID_VALUE`.
- `--search <text>`: only entries whose address (extractions, checks) or query (searches) contains it.
- `--limit <n>` (1 to 100, default 20) and `--offset <n>` (default 0): the page.

It prints a table: the id, when it started (UTC, to the minute), the status and the address. Checks show a `score` column (two decimals, empty while there is none) and the candidate address; searches show the query. When there are more, a last line names the `--offset` for the next page.

`--json` data: the list exactly as Taste returned it.

## Share a result

```sh
taste share <id>             # make it public and print its address
taste share <id> --private   # private again
```

Free. Works on an extraction's, a brand kit's or a check's id. Made public, it prints `✓ Public. Anyone with this address can read the result, without signing in:` and the result's address on Taste's API (`https://api.tastelabs.com/design/submissions/<id>/result`, or `/judge/brand-adherence/<id>/result` for a check). Made private, it prints `✓ Private. Only your account can read <id>.` That the public address opens without signing in comes from Taste's API reference; it hasn't been verified live yet.

`--json` data: `{"id","public":true|false,"url":string|null}`; `public` is what Taste's answer says.

## Brand checks in CI

Check every Vercel preview against production, and fail the build when it drifts from the brand. Add your Taste API key as the repository secret `TASTE_API_KEY`, then:

```yaml
# .github/workflows/brand-check.yml
name: Brand check
on: deployment_status
jobs:
  taste:
    if: github.event.deployment_status.state == 'success' && github.event.deployment.environment != 'Production'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          repository: mfbz/taste-cli
          path: taste-cli
          token: ${{ secrets.TASTE_CLI_TOKEN }} # read access, while the repository is private
      - uses: actions/setup-node@v7
        with:
          node-version: 24
      - run: npm ci && npm run build && npm link
        working-directory: taste-cli
      - run: taste check "$PREVIEW_URL" --against https://acme.com --min 0.8
        env:
          TASTE_API_KEY: ${{ secrets.TASTE_API_KEY }}
          PREVIEW_URL: ${{ github.event.deployment_status.target_url }}
```

- Each run spends credits, as `taste check` does anywhere.
- The preview must be readable without signing in: with Vercel's Deployment Protection on, Taste can't open it.
- taste-cli isn't on npm yet, so this builds it from the repository, as in [Install](#install). While the repository is private, `TASTE_CLI_TOKEN` is a token that can read it.
- In CI there is no animation and no colour: the verdict prints as plain text in the log, and `BELOW_THRESHOLD` exits 1, which fails the job.

## Scripts and agents

Every command is a plain process: arguments in, the result on stdout, progress on stderr, an exit code out. So taste fits into a pipe, a script, a CI job or an agent's tool call like any other Unix tool.

```sh
taste extract stripe.com --format design-md > DESIGN.md                     # a brand, as the file coding agents read
taste search "calm fintech pricing" --json | jq -r '.data.results[].url'    # design references, one address per line
taste enhance "Design a pricing page" --brand stripe.com | pbcopy           # a prompt in a brand's terms, on the clipboard
taste check "$PREVIEW_URL" --against acme.com --min 0.8                     # a gate: exit 1 below 0.8
taste extract stripe.com --no-wait --json | jq -r '.data.id'                # start a job now, taste wait on it later
```

- **CI:** `--min` turns `check` into a pass or fail step, as in [Brand checks in CI](#brand-checks-in-ci).
- **Agents:** `--json` gives one document per run, errors included, with a stable `code` to branch on and `retryable` to say whether running it again is safe ([Machine output](#machine-output), [Error codes](#error-codes)). A key is never taken on the command line, so an agent's transcript never holds one.
- **The skill:** [`skills/taste/SKILL.md`](skills/taste/SKILL.md) teaches a coding agent to use taste well: always `--json`, ask the person before anything that spends credits, `--format design-md` for a DESIGN.md, `--no-wait` and `taste wait` for long jobs, and what to do on each error code. Once the repository is public, `npx skills add mfbz/taste-cli` installs it; until then, copy `skills/taste/` into your agent's skills folder.

## Machine output

Every command takes `--json` for scripts and agents, and `--debug` to add an error's class and stack frames on stderr.

- `--json` prints exactly one JSON document on stdout, errors included, on every path (help, version, usage errors and Ctrl-C too). Progress, notes and warnings never reach stdout.
- Success: `{"ok":true,"data":…}`, with each command's data in its section above.
- Failure: `{"ok":false,"error":{"code","message","hint","retryable"}}`, plus `"details":{"id"}` when a job is involved: the id to `taste wait` on. For `BELOW_THRESHOLD`, `details` is the check's data instead. Branch on `code`; `message` and `hint` are for people.
- `retryable: true` means running the same command again is safe and costs nothing extra. It is `false` whenever the hint is `taste wait <id>` (the job runs on) or a paid request may already have been charged.
- Exit codes: `0` ok, `1` failure (including a check below `--min`), `2` usage error (nothing was sent), `130` interrupted.
- Ctrl-C stops what is in flight and exits 130 with one `INTERRUPTED` document. Its hint says to run the command again, or `taste wait <id>` once a job has started, or where to look while a paid request was being sent. A second Ctrl-C ends at once, with the same code and no second document.
- Without `--json`, results go to stdout and errors, notes, progress and prompts to stderr. An error is one line saying what happened and one saying what to do.

```sh
taste extract stripe.com --no-wait --json | jq -r '.data.id'
taste whoami --json | jq -r '.error.code // "ok"'
```

## Error codes

The codes scripts most often branch on. Every code, with its message and hint, is in `src/output/errors.ts`.

| Code                                                                                                              | Exit | Means                                                                                           |
| ----------------------------------------------------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------- |
| `USAGE_*`, such as `USAGE_INVALID_VALUE`, `USAGE_MISSING_ARGUMENT`, `USAGE_UNKNOWN_OPTION`, `USAGE_INVALID_BRAND` | 2    | The command line is wrong; nothing was sent                                                     |
| `INVALID_URL`, `PRIVATE_URL`                                                                                      | 2    | The address can't be used, or points at this computer or a private network                      |
| `KEY_IN_ARGV`                                                                                                     | 2    | A key or token was on the command line; remove it from your shell history and rotate it         |
| `INVALID_ENV`                                                                                                     | 2    | `TASTE_API_URL` isn't an address taste accepts                                                  |
| `NOT_SIGNED_IN`, `SESSION_EXPIRED`, `INVALID_API_KEY`                                                             | 1    | Sign in with `taste login`, or fix the key                                                      |
| `LOGIN_NOT_INTERACTIVE`                                                                                           | 1    | That way of signing in needs a terminal                                                         |
| `INSUFFICIENT_CREDITS`                                                                                            | 1    | Not enough credits; the message has your balance and the price                                  |
| `NOT_FOUND`                                                                                                       | 1    | No such id, or no finished extraction of that address                                           |
| `FULL_EXTRACTION_REQUIRED`                                                                                        | 1    | `similar` and `enhance` need an extraction made without `--sections`                            |
| `JOB_FAILED`                                                                                                      | 1    | The job failed, with its reason; Taste refunds it                                               |
| `ADHERENCE_FAILED`                                                                                                | 1    | Taste couldn't compare the two sites, with its reason; Taste refunds it                         |
| `BELOW_THRESHOLD`                                                                                                 | 1    | The check scored below `--min`; `error.details` has the verdict                                 |
| `WAIT_TIMEOUT`                                                                                                    | 1    | Still running after `--timeout`; `taste wait <id>` picks it up                                  |
| `SEARCH_BUSY`                                                                                                     | 1    | Taste turned the search away as busy; retryable                                                 |
| `NETWORK`, `TIMEOUT`                                                                                              | 1    | Taste couldn't be reached or didn't answer; after a paid request, check before running it again |
| `UPSTREAM`, `RATE_LIMITED`                                                                                        | 1    | A problem on Taste's side, or too many requests; try again only when `retryable` is true        |
| `OUTPUT_EXISTS`, `OUTPUT_UNUSABLE`, `BUNDLE_PATH_UNSAFE`, `BUNDLE_INVALID`, `BUNDLE_INCOMPLETE`, `SAVE_FAILED`    | 1    | `--out` couldn't save; the hint names the free way to get it again                              |
| `INTERRUPTED`                                                                                                     | 130  | Ctrl-C                                                                                          |
| `INTERNAL`                                                                                                        | 1    | A bug in taste-cli; run again with `--debug` and report it                                      |

## Environment and terminal

taste reads only its flags and these environment variables, never a `.env` or a config file.

| Variable          | Effect                                                                                                                                                                                                                                        |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TASTE_API_KEY`   | An API key to use instead of any saved sign in, without saving it                                                                                                                                                                             |
| `TASTE_API_URL`   | The Taste Engine's address (default `https://api.tastelabs.com`): an `https` address, or `http` on `127.0.0.1`, `::1` or `localhost` for a local mock, with no user name or password. Anything else fails with `INVALID_ENV` before a request |
| `TASTE_NO_MOTION` | Set to anything but `0` or `false`: no animation                                                                                                                                                                                              |
| `NO_COLOR`        | Set and not empty: no colour and no animation                                                                                                                                                                                                 |
| `FORCE_COLOR`     | Colour even without a terminal: `2` for 256 colours, `3` for truecolor, anything else for 16; `0` or `false` is ignored                                                                                                                       |
| `CI`              | Set: no animation                                                                                                                                                                                                                             |
| `TERM=dumb`       | No colour unless `FORCE_COLOR` is set, and no animation                                                                                                                                                                                       |

A pipe gets plain text unless `FORCE_COLOR` is set, and never animation. Progress redraws one line in place only in a terminal that allows motion; elsewhere each step is one plain line.

## Development

```sh
npm run check          # format:check, lint, typecheck, test
npm run cli -- --help  # build, then run the CLI from source
npm run mock           # a local mock Taste Engine on 127.0.0.1:4010, free
npm run smoke:live     # the free, read-only commands against the real Taste Engine, with your sign in
npm run demo:record    # record assets/demo.gif against the mock (asciinema, agg and expect)
```

How changes are made, tested and reviewed: [CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md).

## Credits and license

Built on the [Taste Engine API](https://docs.tastelabs.com). Taste, Taste Labs and the Taste Engine are Taste Labs' names; see [NOTICE.md](NOTICE.md). Licensed [MIT](LICENSE).
