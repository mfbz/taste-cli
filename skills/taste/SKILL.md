---
name: taste
description: Use when a person asks you to extract a brand or design system from a website, find design references, check a page against a brand, turn a brand guidelines PDF into tokens, or write a DESIGN.md from a site, using the taste CLI.
---

# taste

`taste` is a command line for the Taste Engine, Taste Labs' design API (unofficial, not affiliated with Taste Labs). It extracts brands, searches them, checks a page against a brand and exports a DESIGN.md. `taste --help`, and `--help` after any command, list every flag.

## Rules

- **Always add `--json`.** stdout is then exactly one JSON document, errors included: `{"ok":true,"data":…}` or `{"ok":false,"error":{"code","message","hint","retryable"}}`. Progress goes to stderr. Branch on `error.code`, never on the message text.
- **Ask the person before any command that spends credits:** `extract`, `kit`, `check`, `search`, `similar` and `enhance`. Credits are their money. Say which command you will run and why, and wait for a yes. `whoami`, `history`, `wait` and `share` are free.
- **Never put a key or token on the command line.** taste refuses one there (`KEY_IN_ARGV`) and it would sit in shell history. The person signs in with `taste login` themselves, or sets `TASTE_API_KEY` in the environment.
- Don't run a paid command again after a failure until the error says it is safe (see below): a request that failed on the way may already have been charged.

## Tasks

| The person wants                         | Run                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------- |
| to know if taste is signed in            | `taste whoami --json`                                               |
| a brand from a website                   | `taste extract stripe.com --json`                                   |
| a DESIGN.md for their repo               | `taste extract stripe.com --format design-md --out stripe`          |
| a brand kit from a guidelines PDF        | `taste kit guidelines.pdf --json`                                   |
| design references for a look             | `taste search "calm fintech pricing" --top 10 --json`               |
| brands that look like one they extracted | `taste similar stripe.com --json`                                   |
| to check a page against a brand          | `taste check https://preview.example.com --against acme.com --json` |
| a pass or fail gate (CI)                 | `taste check "$PREVIEW_URL" --against acme.com --min 0.8 --json`    |
| a prompt rewritten in a brand's terms    | `taste enhance "a pricing page" --brand stripe.com --json`          |
| what they ran before                     | `taste history --json`, `taste history checks --json`               |

- **A DESIGN.md:** prefer `--format design-md`. It is rendered on the computer from the result, at no extra cost, and contains only what the extraction holds. To write the file, redirect stdout (`taste extract stripe.com --format design-md > DESIGN.md`) or use `--out <dir>`, which saves `DESIGN.md` with the other files. Under `--json`, `data` is the raw result instead.
- **Long jobs** (`extract`, `kit`, `check`) can take minutes. Start with `--no-wait --json`, keep `data.id`, then `taste wait <id> --json` (free). `taste wait <id> --format design-md` turns a finished extraction into a DESIGN.md for free.
- **A gate:** `--min <score>` (0 to 1) makes `check` exit 1 with `BELOW_THRESHOLD` when the score is lower; `error.details` holds the whole verdict, recommendations included.
- `similar` and `enhance` need a full extraction of the brand first (one made without `--sections`).

## Exit codes and errors

Exit codes: `0` ok, `1` failure, `2` usage error (nothing was sent), `130` interrupted.

- `retryable: true`: running the same command again is safe and costs nothing extra.
- `error.details.id` present: a job started and runs on. Run `taste wait <id> --json`; never start it again.
- `NOT_SIGNED_IN`, `SESSION_EXPIRED`, `INVALID_API_KEY`: ask the person to run `taste login`, or to set `TASTE_API_KEY`. Don't try to sign in for them.
- `INSUFFICIENT_CREDITS`: tell the person their balance and the price from the message; stop.
- `BELOW_THRESHOLD`: the check ran. Report the score and the recommendations from `error.details`.
- `WAIT_TIMEOUT`: still running. `taste wait <id> --json` picks it up.
- `NETWORK`, `TIMEOUT` after a paid command: it may have been charged. Look first: `taste history --json` for an extraction or a kit, `taste history checks --json` for a check, `taste history searches --json` for a search.
- `JOB_FAILED`, `ADHERENCE_FAILED`: Taste refunds it. Show the reason; ask before running it again.
- `FULL_EXTRACTION_REQUIRED`, `NOT_FOUND` from `similar` or `enhance`: the brand needs `taste extract <url>` first, which spends credits: ask.
- `PRIVATE_URL`, `INVALID_URL`, `USAGE_INVALID_VALUE` and other `USAGE_*` codes: fix the command; nothing was spent.
- `SEARCH_BUSY`, `RATE_LIMITED`, `UPSTREAM`: wait a minute, then try again.
- `OUTPUT_EXISTS`: the `--out` folder has files. Ask before adding `--overwrite`.
