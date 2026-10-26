# taste-cli

The living spec: what `taste` is and how every command behaves. A change to what the CLI does updates its section here in the same pull request, with acceptance checks tied to tests.

taste-cli is unofficial, not affiliated with Taste Labs, built on the Taste Engine API.

## Status

Built: `taste --version`, `taste --help`, the interactive session (bare `taste` in a terminal), the global flags `--json` and `--debug`, the usage-error path, signing in (`taste login`, `taste logout` and `taste whoami`), the job commands `taste extract`, `taste kit`, `taste check` and `taste wait` with `--out` to save a result's files and `--format design-md` to export one as a DESIGN.md, `taste search`, `taste similar`, `taste enhance`, `taste history` and `taste share`: every command below.

## What it is

A command line for the Taste Engine, Taste Labs' design API: extract a brand from a URL, search a corpus of brands, judge brand adherence, build brand kits from PDFs and enhance prompts. Taste in your terminal, your scripts, your CI and your agents, in one command.

## Interface

Global flags:

- `-v, --version`: print the version (`0.0.0` in the code; versions live in Git tags).
- `-h, --help`: print the help, ending with the line "taste is unofficial, not affiliated with Taste Labs, built on the Taste Engine API."
- `--json`: machine output.
- `--debug`: on failure, add the error's class and stack frames on stderr.

Motion is turned off with `TASTE_NO_MOTION=1`, not a flag. There is no `--yes`: a typed command never prompts, and a paid one spends when it runs.

### Output contract

- `--json` writes exactly one JSON document on stdout, errors included: `{"ok":true,"data":…}` or `{"ok":false,"error":{"code","message","hint","retryable"}}`, for every path including help, version, usage errors and Ctrl-C. Progress never reaches stdout.
- `error.details` is there only where a code carries structured data: `{"id"}`, the job to `taste wait` on, once a job has started; for `BELOW_THRESHOLD` the check's whole `--json` data (see `taste check`).
- Without `--json`, results go to stdout and errors, notes, progress and prompts to stderr. A pipe gets no ANSI.
- Exit codes: 0 ok, 1 failure, 2 usage, 130 interrupted.
- Errors come only from a catalogue (`src/output/errors.ts`): code, message, hint, retryable. Untrusted server text is stripped of control characters before display.
- `retryable: true` means running the same command again is safe and costs nothing extra. It is `false` whenever the hint is `taste wait <id>` (a started job runs on; running the command again would start and pay for another) or the paid in-flight hint (the request may already have been charged).
- Warnings a person must see (a saved sign in ignored, a keychain that may still hold one) go to stderr in both modes, prefixed `warning:`; under `--json` stdout still carries only the one document.
- Ctrl-C aborts what is in flight and the command ends through the usual output. A second Ctrl-C, or a command that hasn't stopped two seconds later, ends the process at once, with the same exit code and document.
- After Ctrl-C the hint says to run the command again, or, when a job was started, `taste wait <id>` to pick it up, or, while a paid request is being sent, where to look first (see "Credits"). The hard stop (a second Ctrl-C, or the two seconds running out) uses the same hint from what the command said is in flight, and without `--json` clears any progress line before its message. It never adds a second document: once the command has written its own, it exits without another, and a Ctrl-C after the command finished exits with the command's own code.
- A request that gets no answer within its deadline fails with `TIMEOUT` ("The Taste Engine didn't answer in time."), a connection that fails with `NETWORK` ("Couldn't reach the Taste Engine.").
- An API answer is at most 8 MB (the largest recorded result is under 200 KB): a larger one is cut off and fails with `RESPONSE_TOO_LARGE`, never retried, and for a paid request with the paid in-flight hint.

Acceptance (proven by `src/cli.test.ts` and `src/main.test.ts`):

- `taste --version` prints `0.0.0` and exits 0; under `--json` it is `{"ok":true,"data":{"version":"0.0.0"}}`.
- `taste --help`, and `taste` with no command, print the help with the unofficial line and exit 0; under `--json` the help is `data.help`.
- An unknown option exits 2 and names the option but never its value; under `--json` it is one document with `error.code` `USAGE_UNKNOWN_OPTION`. An unknown command exits 2 with `USAGE_UNKNOWN_COMMAND`.
- A reader that closes the pipe early is not an error.
- A Taste key (`taste_` followed by long random text) or a token (a JWT) anywhere in argv, as a whole argument or a whole option value, is refused with `KEY_IN_ARGV` (exit 2) before any command runs, and is never echoed. File names and words that only start with `taste_`, such as `taste_logo_final.pdf` or `taste_engine_reviews`, go through (`src/cli.test.ts`).
- `--debug` adds only the error's class name and stack frames; an error's message and its cause never reach output, in either mode (`src/cli.test.ts`).
- Ctrl-C ends a running command with exit 130 and, under `--json`, one `INTERRUPTED` document (`src/main.test.ts`); without a job the hint is "Run the command again." (`src/output/output.test.ts`).
- A second Ctrl-C, or one after the command wrote its document, never writes a second document; the hard stop's hint names the job or the paid request in flight (`src/interrupt.test.ts`, `src/output/output.test.ts`).
- `retryable` is false on every `taste wait <id>` and paid in-flight hint (`src/output/errors.test.ts`).
- A timed out request is `TIMEOUT`, distinct from `NETWORK` (`src/api/client.test.ts`).
- Store warnings reach stderr under `--json` too, with exactly one document on stdout (`src/output/output.test.ts`, `src/commands/whoami.test.ts`).

### Configuration

Settings come from flags and these environment variables only; taste never reads a `.env` or a config file.

- `TASTE_API_KEY`: an API key. When set, every command uses it instead of any saved sign in, and the saved one is not even opened. `login`, `logout` and `whoami` say so on stderr.
- `TASTE_API_URL`: the Taste Engine's address, `https://api.tastelabs.com` by default. It takes an `https` address, or `http` on `127.0.0.1`, `::1` or `localhost` (for a local mock), with no user name or password in it; anything else fails with `INVALID_ENV` (exit 2) before a request is made. Sign in checks the account against it too. The sign in service itself is always Taste's.
- `TASTE_NO_MOTION`: set to anything but `0` or `false` to turn animation off.

Where a sign in is kept:

- In the system keychain (macOS Keychain, Windows Credential Manager, Secret Service on Linux), service `taste-cli`, account `default`.
- Where there is no usable keychain, in `credentials.json` in the config folder, readable only by you (file `0600`, folder `0700`), with one warning on stderr each time. A credentials file that others can read, or that can't be parsed, is ignored with a warning and reads as not signed in.
- The config folder: `$XDG_CONFIG_HOME/taste-cli` or `~/.config/taste-cli` on macOS and Linux, `%APPDATA%\taste-cli` on Windows. It also holds `client.json` (the public OAuth client registration, not a secret) and a lock file that keeps two processes from refreshing a session at once.

## Credits

Credits are real money. These rules hold for every command that spends them (today `extract`, `kit`, `check`, `search`, `similar` and `enhance`):

- The command's `--help` says it spends credits. A command typed directly does not ask for confirmation: typing it is the decision. The interactive menu marks each action that spends credits `(uses credits)` and asks before spending.
- Every flag, the address and the file are checked before the one request that spends credits, so a mistake costs nothing.
- A paid request is never retried by itself, except a search Taste turned away as busy (503), which Taste refunds. Not after a network failure, a timeout or any other 5xx; a busy search that stays busy ends with `SEARCH_BUSY`.
- A paid request that fails in flight (`NETWORK`, `TIMEOUT`, or Ctrl-C while it is being sent) may still have reached Taste and been charged. Its error is not retryable and the hint says where to look before running it again, never to try again: `taste history` for an extraction or a brand kit, `taste history checks` for a check, `taste history searches` for a search or similar brands, and for an enhancement, which no history lists, the credits in the Taste account. `taste history` with no options lists extractions and brand kits newest first, running ones included, so a job that did start is the first row, with the id to `taste wait` on.
- Once a job has started, it runs on Taste's side whatever happens to taste: Ctrl-C, `--timeout`, a network failure or a Taste error while waiting all end with the job's id and the hint `taste wait <id>`, which picks it up for free (`error.details.id` under `--json`).
- Failed jobs, searches and similar-brand requests are refunded by Taste.

## Commands

### `taste`

With no arguments, in an interactive terminal (stdin, stdout and stderr all terminals, `CI` unset, `TERM` not `dumb`), `taste` starts a session; anywhere else (a pipe, CI, `TERM=dumb`, `--json`, any argument) it prints the help as `taste --help` does, with no animation bytes.

The session, all on stderr except each command's result:

1. The opening (DESIGN.md, "The opening and the menu"): about half a second, skipped by any key or Ctrl-C; the last frame only without motion (`TASTE_NO_MOTION`, `NO_COLOR`, `TERM=dumb`); one line in a terminal narrower than 64 columns. The cursor is always shown again.
2. One line on who taste is signed in as, read locally without a request: `Signed in as <email>.`, `Signed in with an API key.`, `Using an API key from TASTE_API_KEY.` or `Not signed in.`
3. A menu: Extract a brand, Check brand adherence, Search brands, Brand kit from a PDF, Enhance a prompt (each marked `(uses credits)`), History, Sign in or Sign out (whichever applies), Quit.

Each action asks for its inputs (an address is checked as `taste extract` checks it, under the field, as it is typed), asks `<what>? It uses credits.` before anything that spends them, then runs the same code as the command typed directly (`taste extract <url>`, `taste check <url> --against <url>`, `taste search <query>`, `taste kit <file>`, `taste enhance <prompt> --brand <brand>`, `taste history [list]`, `taste login`, `taste logout`), and comes back to the menu. A failed action shows its error and comes back to the menu too.

- Ctrl-C (or Escape) at a prompt goes back to the menu without spending anything; at the menu it quits with exit 0.
- Ctrl-C while an action runs ends the session the way it ends that command: exit 130, and for a started job the hint `taste wait <id>`.

Acceptance (proven by `src/commands/session.test.ts` and `src/ui/opening.test.ts`):

- Choosing Extract a brand and confirming runs the extraction and prints its summary; declining the confirm makes no request.
- A private address is refused at the prompt, before any request.
- Ctrl-C at a prompt returns to the menu; at the menu the session exits 0.
- Not interactive, or with `CI` set: the help, and no `ESC[?25l` in the output.
- Without motion the opening writes only its last frame; a key press jumps to the last frame; the cursor is shown again when drawing fails; a narrow terminal gets one line.

### `taste login`

Signs in and saves the sign in. Free: no credits are spent.

- `taste login`: in a terminal, opens the browser to sign in to Taste (OAuth with PKCE and a redirect to a local port). The address is printed on stderr too, in case the browser doesn't open. The session refreshes itself shortly before it ends.
- `taste login --api-key`: asks for an API key at a hidden prompt on stderr. Needs a terminal.
- `taste login --with-api-key`: reads an API key from stdin to the end (`taste login --with-api-key < key.txt`). For scripts and CI. When stdin is a terminal it first says how to end the input (Ctrl-D, or Ctrl-Z then Enter on Windows).

A key is checked with `GET /design/me` before it is saved, so a wrong key replaces nothing. A key is never taken as an argument (see `KEY_IN_ARGV`). `--api-key` and `--with-api-key` can't be combined (`USAGE_CONFLICTING_OPTIONS`).

`--json`: `{"ok":true,"data":{"method":"session"|"key","email":string|null,"store":"keychain"|"file"}}`. Human: `✓ Signed in as <email>.` (with an API key: `✓ Signed in as <email> with an API key.`).

Errors: `LOGIN_NOT_INTERACTIVE` (the browser or the prompt without a terminal, or under `--json`; the hint names `--with-api-key` and `TASTE_API_KEY`), `INVALID_KEY_INPUT` (exit 2: empty input, or more than one word), `INVALID_API_KEY`, `LOGIN_CANCELLED` (exit 130: the prompt was cancelled), `LOGIN_TIMEOUT`, `LOGIN_DENIED`, `LOGIN_PORTS_BUSY`, `LOGIN_FAILED`, `CREDENTIALS_STORE_FAILED`.

Acceptance (proven by `src/commands/login.test.ts`):

- `--with-api-key` with a key on stdin and a `/design/me` that accepts it stores `{kind:"key"}`, sends it as `x-api-key` to `TASTE_API_URL` when set, and the key appears in no output, human or `--json`.
- A key Taste refuses stores nothing (`INVALID_API_KEY`); empty or multi-word input is refused before any request (`INVALID_KEY_INPUT`).
- `--api-key` without a terminal, or under `--json`, fails with `LOGIN_NOT_INTERACTIVE` and never prompts; a cancelled prompt saves nothing and exits 130.
- `taste login` without a terminal, or under `--json`, fails with `LOGIN_NOT_INTERACTIVE` and opens no browser.
- In a terminal, the browser sign in prints the address on stderr, stores the session and prints `Signed in as <email>`; no token appears in any output. Ctrl-C while it waits exits 130 and saves nothing.
- With `TASTE_API_KEY` set, a note says it is used instead of the saved sign in.
- `--with-api-key` on a terminal stdin says how to end the input; from a pipe it says nothing.
- `--api-key` without a terminal fails with `error.code` `LOGIN_NOT_INTERACTIVE` under `--json`.

### `taste logout`

Forgets the saved sign in, in the keychain and in the credentials file. Signing out when not signed in is not an error. It does not sign the browser session out on Taste's side.

`--json`: `{"ok":true,"data":{"signedOut":true}}`. Human: `✓ Signed out.`

Acceptance (proven by `src/commands/logout.test.ts`):

- `taste logout` twice exits 0 both times and leaves nothing stored.
- With `TASTE_API_KEY` set, a note says the key is still used.
- When the keychain can't be reached, the credentials file is removed and a warning on stderr, in both modes, says a sign in saved in the keychain earlier may remain.

### `taste whoami`

Shows which credential taste would use and whose account it is, confirmed with one free request to `GET /design/me` (a session is refreshed first if it must be). Precedence: `TASTE_API_KEY`, then the saved sign in.

`--json`: `{"ok":true,"data":{"method":"env-key"|"key"|"session","email":string|null,"store":"keychain"|"file"|null}}` (`store` is `null` for `env-key`). Human: `Signed in as <email> (browser session).`, `Signed in as <email> (API key).` or `Using an API key from TASTE_API_KEY (<email>).`

Errors: `NOT_SIGNED_IN` (nothing saved, or a saved sign in that can't be read), `SESSION_EXPIRED` (a session Taste refuses and that can't be refreshed; it is removed only when the sign in service refuses the refresh), `INVALID_API_KEY` (a key Taste refuses).

Acceptance (proven by `src/commands/whoami.test.ts` and `src/auth/provider.test.ts`):

- With nothing saved, or a corrupt credentials file, it fails with `NOT_SIGNED_IN` and the hint `taste login`, never a stack trace, even with `--debug`.
- With `TASTE_API_KEY` set it reports `{"method":"env-key"}` without opening the keychain, and never prints the key.
- A session is sent as a bearer token and refreshed when it ends within a minute; on a 401 it is refreshed once and the request retried. A refused refresh ends with `SESSION_EXPIRED`; a network failure during a refresh stays `NETWORK`.
- A key Taste refuses ends with `INVALID_API_KEY`.

### `taste extract <url>`

Extracts a brand from a website. **Spends credits.** One `POST /design/submissions`, then free polling until the job ends, then one read of the result.

- `<url>`: a public `http` or `https` address; a bare domain such as `stripe.com` means `https://stripe.com/`. An address on this computer or a private network (`localhost`, `127.0.0.1`, `10.x`, `192.168.x`, `*.local`, `file:`) fails with `PRIVATE_URL` before any request; anything else unusable with `INVALID_URL`.
- `--sections <names>`: extract only these sections, separated by commas (the API's names: `profile`, `layout`, `colors`, `typography`, `surfaces`, `elevation`, `interactions`, `actions`, `navigation`, `data_display`, `structure`, `icons`, `assets`, `sections`, `brand_assets`). An unknown or empty name fails with `USAGE_INVALID_SECTIONS`, whose hint lists them.
- `--deep`: Taste's slower, deeper analysis (`enable_deep_analysis`). Can't be combined with `--sections` (`USAGE_CONFLICTING_OPTIONS`).
- `--force`: extract again even when Taste holds a recent result.
- `--map`, `--max-urls <n>`: map mode, which finds the site's pages and extracts them too, up to `n` (1 to 200). `--map` with `--sections` fails with `SELECTIVE_MAP_UNSUPPORTED` before any request, as the API would; `--max-urls` without `--map` fails with `USAGE_NEEDS_OPTION`. Unverified: map mode has only been run against the mock, and taste waits on the one submission id the API returns.
- `--format <format>`: `summary` (the default), `json`, the whole result as Taste sent it, indented, for a file or another tool, or `design-md`, the brand as a DESIGN.md file (see "Exporting a DESIGN.md").
- `--no-wait`: print the job's id on stdout and return at once; stderr says `taste wait <id>`.
- `--timeout <seconds>`: stop waiting after this long (default 600, at most 86400). The job carries on; the error is `WAIT_TIMEOUT` with `taste wait <id>`.
- `--out <dir>`, `--overwrite`: once the job is done, save its files into `dir` (see "Saving the files"). Can't be combined with `--no-wait` (`USAGE_CONFLICTING_OPTIONS`); `--overwrite` without `--out` fails with `USAGE_NEEDS_OPTION`.

While it waits, progress goes to stderr: in a terminal that allows motion one line redraws in place (`⠋ Crawling · 12s`); elsewhere each step is one line (`Crawling · 12s`); under `--json` nothing. It ends with `✓ Extracted <brand> in 48s`, or `✓ Extracted <brand> (cached)` when Taste served a recent result.

Human output on stdout: the brand and its tagline, the style classification, the tone, the palette (a truecolor or 256-colour swatch, the hex and the name; the hex and name alone without colour), the type families, the source address, the id, and `taste wait <id> --format json` for everything. Fields the result doesn't have are left out. Every string from Taste is cleaned of control characters.

`--json`: `{"ok":true,"data":<the result exactly as GET /design/submissions/{id}/result returned it>}`; with `--no-wait`, `{"ok":true,"data":{"id":string,"status":string}}`.

Errors: `INVALID_URL`, `PRIVATE_URL`, `USAGE_INVALID_SECTIONS`, `USAGE_CONFLICTING_OPTIONS`, `USAGE_NEEDS_OPTION`, `USAGE_INVALID_VALUE`, `SELECTIVE_MAP_UNSUPPORTED`, `INSUFFICIENT_CREDITS`, `JOB_FAILED` (with the job's own reason), `WAIT_TIMEOUT`, `INTERRUPTED`, `NETWORK`, `TIMEOUT`, `UPSTREAM`, `RATE_LIMITED`, the `--out` errors below, and the sign in errors of `taste whoami`.

Acceptance (proven by `src/commands/extract.test.ts`, `src/render/brand-summary.test.ts` and `scripts/mock-taste.test.ts`):

- The summary names the brand and every primary colour of the recorded tastelabs.com and stripe.com extractions; a brand kit is summarised from its own shape; a selective result without a profile falls back to the address.
- A pipe gets no ANSI and one note per step; a terminal gets one line redrawn in place and cleared before anything else is written.
- `--json` data equals the recorded result; `--no-wait` prints only the id and makes only the `POST`.
- `--map --sections colors`, `--deep --sections colors`, an unknown section, `--max-urls` without `--map` and out-of-range values exit 2 and make no request. `localhost:3000`, a private address and `file:` fail with `PRIVATE_URL` and make no request.
- Ctrl-C during the wait exits 130 with one document whose `error.hint` contains `taste wait <id>` and whose `error.details.id` is the id, in-process and in a real process against the mock.
- `--timeout` and a network failure while waiting end with `taste wait <id>`; a failed job shows its reason; a 402 stops before waiting.
- `taste extract https://stripe.com --json` against the local mock gives `ok:true`.

#### Exporting a DESIGN.md (`--format design-md`)

`extract`, `kit` and `wait` (for an extraction or a brand kit) take `--format design-md`: the finished result is written on stdout as a [DESIGN.md](https://github.com/google-labs-code/design.md) file, so `taste extract stripe.com --format design-md > DESIGN.md` works; progress stays on stderr. With `--out`, the same file is also saved as `DESIGN.md` in the folder, next to the result's files (it replaces a file of that name in the manifest). Free beyond the extraction itself: it is rendered locally from the result (`src/design-md/render.ts`). `--json` is unchanged: the document carries the result, not the file. `wait --format design-md` with a check's id fails with `USAGE_FORMAT_UNSUPPORTED` (exit 2), once a read of the check confirms it is one.

It follows the DESIGN.md format version `alpha` (google-labs-code/design.md `docs/spec.md`, read 2026-10-26; its linter `@google/design.md` is 0.4.0). The front matter has `version`, `name`, `description` and the token maps; the body has the spec's sections in its order. Only what the extraction holds is written: a token or section with nothing behind it is left out, never guessed. Token names are the extraction's own names, slugified (lowercase, accents dropped, anything else to `-`); a second of the same name gets `-2`. Every string from Taste is cleaned of control characters and put on one line, every YAML string is double quoted, and a line of prose that markdown would read as a heading, list, quote or rule is escaped, so nothing from Taste can end the front matter or add a section. The file ends with the line `Extracted from <source> on <date> with the Taste Engine, via taste-cli <version> (unofficial).`: the date is the day Taste completed the job (`completed_at`), today when the result doesn't say; a brand kit's `file://` source is shown as its file name.

| DESIGN.md                  | From a website extraction                                                                                                                                                                                                                                                        | From a brand kit                                                                                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`                  | `alpha`, the spec's version                                                                                                                                                                                                                                                      | same                                                                                                                                                        |
| `name`                     | `profile.brand_name`, else the source's host                                                                                                                                                                                                                                     | same                                                                                                                                                        |
| `description`              | `profile.brand_signature`                                                                                                                                                                                                                                                        | `profile.summary`                                                                                                                                           |
| `colors.<name>`            | each of `colors.baseline` and `colors.secondary` with a hex: its `name` to its `hex`, as written                                                                                                                                                                                 | each of `colors.palette` with a hex                                                                                                                         |
| `typography.<role>`        | each variant of `typography.titles`, `paragraphs`, `labels`, `others`, `highlights`: `role` to `fontFamily` (the variant's `name`, unless a CSS expression such as `var(--mono)`), `fontSize` (a px, em or rem value only, so `clamp()` is left out), `fontWeight`, `lineHeight` | each of `typography.hierarchy`: `role` to `family`, `size` and `line_height` with `unit`, `weight`                                                          |
| `rounded`                  | not written: a website gives a radius as a word (`rounded`), not a scale                                                                                                                                                                                                         | not written; a button's radius is on its component                                                                                                          |
| `spacing`                  | `columns`, `gutter` and `max-width` from `layout.grid`, `button-gap` from `actions.button_group.spacing`                                                                                                                                                                         | not written: the recorded kit's `layout` lists are empty and their shape is unpublished                                                                     |
| `components.button-<name>` | each of `actions.button_list`: `visuals.default` `background` and `text_color` to `backgroundColor` and `textColor`, `padding` when it is one dimension; `-hover` from `visuals.hover` when it differs                                                                           | each of `buttons`: `button-<role>` (`-<state>` unless `default`), from its `css`: `background`, `color`, `border-radius` to `rounded`, `padding`            |
| `components.top-nav`       | `navigation.top_nav`: `background.hex`, `height`                                                                                                                                                                                                                                 | not written                                                                                                                                                 |
| component colours          | a colour equal to a palette hex becomes a reference, such as `{colors.blurple}`; any other CSS colour (`#hex`, `rgb()`, `hsl()`, `transparent`) is written as is                                                                                                                 | same                                                                                                                                                        |
| `## Overview`              | `brand_signature`, then Style (`style_classification`), Industry, Tone (`copy_tone`), Keywords, Accents and Highlights (`visual_language`)                                                                                                                                       | `summary`, then Tagline, Tone, Personality, Audience                                                                                                        |
| `## Colors`                | `colors.insights`, then each colour with its `rules.description`                                                                                                                                                                                                                 | each colour with its `when_to_use`                                                                                                                          |
| `## Typography`            | `typography.insights`                                                                                                                                                                                                                                                            | each of `typefaces` with its `when_to_use`                                                                                                                  |
| `## Layout`                | `layout.insights`, `section_separation`, `breakpoints`                                                                                                                                                                                                                           | not written                                                                                                                                                 |
| `## Elevation & Depth`     | each of `elevation.shadows.levels` (`description` and `css_value`), then `surfaces.highlights`                                                                                                                                                                                   | not written                                                                                                                                                 |
| `## Components`            | each button's `usage`, `actions.button_group.description`, `interactions.insights`                                                                                                                                                                                               | not written (the tokens carry the buttons)                                                                                                                  |
| `## Do's and Don'ts`       | not written                                                                                                                                                                                                                                                                      | `profile.voice.do` and `dont`, then every rule outside `colors` (those are under Colors), a `spec` rule with no figure in its words followed by its `value` |

Not mapped: `profile.strategy`, `style_classification.reasoning`, `surfaces.solid_colors` and `gradients`, `interactions.animations`, `data_display`, `structure`, `icons`, `assets`, `brand_assets`, `sections`, a kit's `logo`, `photography`, `graphics`, `applications`, `cards`, `motion`, colour `shades` and `pairs`. They stay in `--format json` and the `--out` files.

The official linter (`npx @google/design.md lint`) passes the three goldens with 0 errors. Its warnings are the data's, not the file's: no colour token named `primary` (an extraction names its colours, it doesn't rank them), contrast measured against a `transparent` button background, and palette colours no component references.

Acceptance (proven by `src/design-md/render.test.ts` and `src/commands/wait.test.ts`):

- The recorded stripe.com, tastelabs.com and brand kit results render byte for byte as `src/design-md/__golden__/{stripe,tastelabs,kit}.DESIGN.md`, and every hex in their front matter is in the recorded result.
- A result without `colors` writes no `colors:` key.
- `wait <id> --format design-md --out <dir>` prints the file on stdout, nothing of it on stderr, and saves the same bytes as `DESIGN.md`.

#### Saving the files (`--out`)

`extract`, `kit` and `wait` (for an extraction or a brand kit) take `--out <dir>`: once the job is done, its files are read from the download manifest (`GET /design/submissions/{id}/download`, free) and saved under `dir`, at the relative paths the manifest names: `guidelines.json`, `design_system.md`, the captured HTML, CSS and screenshot, and the brand's assets. Inline files are written as they are; the rest are downloaded, four at a time, from public `https` addresses only, with no Taste credential and every redirect checked the same way. An entry carrying both is written from its inline content. The `--json` document and the summary are the same as without `--out`; a line on stderr says how many files were saved and where.

- The folder is checked before the paid request: it may be missing (it is created) or empty; one with files in it fails with `OUTPUT_EXISTS` unless `--overwrite` is given, which replaces files of the same name and leaves the others. A path that is a file, or a folder taste can't read, fails with `OUTPUT_UNUSABLE`. **Use a folder only you can write to**: on macOS and Linux a folder that was already there (`dir` itself or one inside it) must be yours and not writable by others, or the save stops with `BUNDLE_PATH_UNSAFE`, so no one else can swap it for a symlink between the check and the write. Folders taste creates are readable only by you (`0700`). An existing `--out` folder is checked this way before the paid request, so `--out /tmp` is refused before anything is spent. Windows has no such bits to read, so this check is skipped there. Drives without real owners (exFAT or FAT, a macOS external drive set to ignore ownership, some container mounts) can fail it too: pick a folder on your own disk.
- Every path and address in the manifest is the server's, so all of them are checked before anything is written. A path that is absolute (`/etc/x`, `C:\x`, `\\server\x`), names a drive or a stream (`:`), has a `..` segment anywhere (even one that would come back down; a name that merely starts with `..`, such as `..foo`, is fine), a segment ending in a dot or a space, a character Windows refuses (`<>"|?*`), a control character (C0, DEL or C1), or a Windows device name with any extension (`CON`, `PRN`, `AUX`, `NUL`, `COM0` to `COM9`, `LPT0` to `LPT9`, on every system) fails with `BUNDLE_PATH_UNSAFE`. More than 2000 entries, two entries landing on the same file (compared without case and in one Unicode form, as macOS and Windows compare names), a file that is also another entry's folder, an entry with nothing to save, or an address that isn't public `https` fail with `BUNDLE_INVALID`. Either way nothing is written.
- Nothing is written through a symlink: every folder from `dir` down to a file's is checked with `lstat`, each file is created with `wx`, which refuses anything already in its place, and `--overwrite` removes a file before creating it rather than writing through it. `dir` itself may be a symlink: it is the person's choice.
- An asset that is gone for good is skipped, not fatal: one over the size cap below (it is as large on every run), or one whose unsigned address (typically the brand's own site, `?v=123` and image-resizer queries included) is refused with a 4xx other than 408 and 429, such as a 403 from the brand's CDN. The rest are saved and the command ends successfully. One `warning:` on stderr lists the skipped files by path (cleaned as in errors: no control characters, key-shaped tokens redacted, at most 120 characters) with their status or `too large` (the first 10, then a count), the saved line says how many were skipped, and under `--json` the data gains `"skipped":[{"path":string,"status":number|"too large"}]` next to the result's own fields (only when something was skipped). With `--overwrite`, an older file of the same name is removed, so the folder holds only this result. A refused signed link is never skipped. A link is signed when its query has one of these keys, in any case: `token`, `signature`, `sig`, `x-amz-signature`, `x-goog-signature`, `expires`, `policy`, `key-pair-id` (Taste's own storage, S3, GCS, CloudFront). Its signature may have expired, and each run gets fresh links, so it stops the save with `BUNDLE_INCOMPLETE` like a network failure, a timeout, a 5xx, a 408 or a 429.
- An asset is at most 100 MB: a larger `Content-Length` is refused before reading, and a body that runs past it is cut off, with `DOWNLOAD_TOO_LARGE`. Known limit: an address is judged by its name, without a DNS lookup, so a public name that resolves to a private address is fetched. The request carries no credential and what comes back only lands in your folder.
- Once the job is done, every failure to save keeps its id: `error.details.id` and a hint to save again for free with `taste wait <id> --out` (with `--overwrite` where the folder has files), never to run the paid command again, and never retryable. `BUNDLE_INVALID` is the exception: nothing is saved, and its hint is `taste wait <id>`, which shows the result for free. The rule holds for `OUTPUT_EXISTS` and `OUTPUT_UNUSABLE` (the folder changed while the job ran), `BUNDLE_PATH_UNSAFE`, and `SAVE_FAILED` for anything else (the manifest can't be read, for one). A sign in or credit problem while saving (`NOT_SIGNED_IN`, `SESSION_EXPIRED`, `INVALID_API_KEY`, `FORBIDDEN`, `INSUFFICIENT_CREDITS`) keeps its own code and hint, with the id added. A download or a write that fails partway ends with `BUNDLE_INCOMPLETE`: how many files were saved and skipped, and the path of the one that failed (never its address), cleaned of control characters and cut to 120 characters. A file whose write failed is removed, never left half written. Ctrl-C stops before the next file and ends with `taste wait <id>`.
  Acceptance (proven by `src/download/bundle.test.ts`, `src/commands/extract.test.ts`, `src/commands/kit.test.ts` and `src/commands/wait.test.ts`):

- The recorded manifest's files are written at its paths with its inline content, and only its URL entries are downloaded.
- `../x`, `/etc/x`, `a/../../x`, `C:\x`, `\\server\x`, `CON`, `nul.txt`, `a|b` and the other hostile paths fail with `BUNDLE_PATH_UNSAFE` and leave the temporary folder empty; `..foo` is accepted. A symlink planted in `dir`, to a folder or a file outside it, fails the same way and nothing outside is touched; so does a folder others can write to, `dir` included, and new folders are `0700`.
- An entry whose URL points to a private host (`169.254.169.254`) or is `http`, more than 2000 entries, and two names equal but for case or Unicode form fail with `BUNDLE_INVALID` before any download or write.
- A download failing on the second of three files with a 502 reports 1 of 3 saved and 0 skipped; a 503, 408, 429 or network failure stops the same way, naming the file by its path; a write failing halfway leaves no partial file.
- An asset at an unsigned address answering 403 or 404 is skipped: the rest are saved, the exit is 0, a warning names its path and status, cleaned, and `--json` lists it under `skipped`. An address with `?v=1` or a Next.js image query answering 403 is skipped too. A signed link (`?token=…`, `?X-Amz-Signature=…`, CloudFront's `Signature` and `Key-Pair-Id`) answering 403 stops with `BUNDLE_INCOMPLETE`, naming the path, the id and the free `taste wait <id> --out`, and its address appears nowhere. An asset over 100 MB is skipped as `too large`, and with `--overwrite` its older copy is removed.
- An existing folder others can write to fails with `BUNDLE_PATH_UNSAFE` before any request; a sign in or credit error while saving keeps its code with `details.id`.
- A folder with files fails with `OUTPUT_EXISTS` before any request; `--overwrite` replaces files of the same name.
- After a paid `extract`, a hostile manifest and a manifest that can't be read end with the job's id in `error.details.id` and `taste wait <id> --out` in the hint; an invalid one with the id and `taste wait <id>`.
- An asset over 100 MB is refused by its `Content-Length`, and an endless one is cut off once past it, read once (`src/api/client.test.ts`).
- The mock's manifest is all inline, and `extract --out` against it sends nothing off this machine (`scripts/mock-taste.test.ts`).
- No more than four downloads run at once.

### `taste kit <file.pdf>`

Extracts a brand kit from a brand guidelines PDF. **Spends credits.** The file is checked before the upload: it must exist and be a file (`FILE_NOT_FOUND`), be at most 50 MB (`FILE_TOO_LARGE`, refused without reading it) and start with `%PDF-` and not be empty (`INVALID_FILE`). Then one `POST /design/submissions/brand-kit` (never served from a cache), and the same waiting, progress, `--format`, `--no-wait`, `--timeout`, `--out`, output and `--json` shapes as `taste extract`.

Acceptance (proven by `src/commands/kit.test.ts`):

- The committed sample PDF uploads and its summary shows the brand, its colours and its type.
- A `.txt` file, an empty file, a missing path, a folder and a file over 50 MB fail before any upload.
- `--out` saves the brand kit's files; a folder with files in it fails before the upload.

### `taste search "<query>"`

Searches Taste's corpus of brands for the look you describe. **Spends credits** (more with `--deep`); a failed search is refunded. One `POST /search`, answered at once: there is no job.

- `<query>`: 2 to 400 characters once trimmed (the API's limits); anything else fails with `USAGE_INVALID_QUERY` before a request.
- `--deep`: `depth: "deep"`, slower and closer, and each card says why it matched. Without it, `depth: "fast"`.
- `--top <n>`: how many brands, 1 to 30 (`top_k`; Taste's default is 6). Out of range fails with `USAGE_INVALID_VALUE`.
- `--industry <industry>`, `--page-type <type>`: hard filters (`filters.industry`, `filters.page_type`), checked against the API's values (`src/api/schemas.ts`, `INDUSTRY` and `PAGE_TYPE`). An unknown one fails with `USAGE_INVALID_INDUSTRY` (the hint names a few and points at `taste search --help`, which lists them all) or `USAGE_INVALID_PAGE_TYPE` (the hint lists them all), never echoing what was typed.

Human output on stdout: numbered cards. Each one: the brand's name in bold (or its address's host), its match and badge dimmed; its address; the reason it matched, or its identity paragraph when Taste gave no reason, dimmed; its primary palette (`palette.primary`) as swatches and hexes, as many as fit, or the hexes alone without colour, left out when there is none; its tags, dimmed. In a terminal each line is cut with `…` to the width (at least 40 columns), the `…` never in bold; a pipe gets every line whole, as `taste history` does. Then, dimmed: `Extract one in full with taste extract <url> (spends credits).` No results: `No brands found.`

`--json`: `{"ok":true,"data":<the answer exactly as POST /search returned it>}` (`search_id`, `depth`, `results`, `query_tags`).

While the request is in flight, Ctrl-C, a network failure and a timeout end with the hint "It may have reached Taste and been charged. Check taste history searches before you run it again, so you don't pay twice.", never retryable. A 503 is `SEARCH_BUSY` (retryable: Taste turned it away before any work).

Errors: `USAGE_INVALID_QUERY`, `USAGE_INVALID_INDUSTRY`, `USAGE_INVALID_PAGE_TYPE`, `USAGE_INVALID_VALUE`, `INSUFFICIENT_CREDITS`, `SEARCH_BUSY`, `REQUEST_REJECTED`, `UPSTREAM`, `RATE_LIMITED`, `NETWORK`, `TIMEOUT`, `INTERRUPTED`, and the sign in errors of `taste whoami`.

Acceptance (proven by `src/commands/search.test.ts`, `src/render/cards.test.ts` and `scripts/mock-taste.test.ts`):

- The recorded fast and deep searches render as numbered cards with each brand's name, match, address and primary hexes; a card without a palette has no colour line; one without a name shows its host; control characters from Taste are stripped; swatches only in a colour terminal, and only for real hexes.
- `--json` data equals the recorded answer; `--deep`, `--top`, `--industry` and `--page-type` reach the API as `depth`, `top_k` and `filters`.
- `--industry nope`, `--page-type nope`, `--top 0` or `31`, a one-character and a 401-character query exit 2 with no request; `--industry nope` names a few valid industries.
- The hard stop is told a paid request is in flight, then that nothing is; a network failure in flight ends with the exact search hint above, not retryable; `--help` says it spends credits.

### `taste similar <id|url>`

Brands from Taste's corpus that look like one of your full extractions, as the same cards as `taste search`. **Spends credits**; a failed request is refunded. One `GET /search/similar`, sent once like a paid `POST`.

- `<id|url>`: an extraction's id (a UUID, sent as it is), or a site's address, checked as `taste extract` checks it. Anything else, such as the bare word `stripe`, fails with `USAGE_INVALID_BRAND` (exit 2) before any request, its hint suggesting `stripe.com`. An address is looked up with free reads of `GET /design/submissions?q=<host>&status=completed&kind=website&limit=100`, paging with `offset` up to three pages (the list keeps every extraction, several per address). An entry matches on its host without a leading `www.` (the port counts) and its path without a trailing slash; the scheme and the query don't count. Of the matches, sorted by `accepted_at`, newest first, without relying on the list's order, the first full extraction (made without `--sections`) is used. taste never starts an extraction on its own. With no match, it fails with `NOT_FOUND` and the hint `Run taste extract <url> first. It spends credits.`; with only selective ones, `FULL_EXTRACTION_REQUIRED` and `Run taste extract <url> without --sections first. It spends credits.`; both before anything is spent. The address in a hint drops any user name, password, query and fragment, and is cut to 120 characters. A selective extraction's id gets the API's 422, the same `FULL_EXTRACTION_REQUIRED`.
- `--top <n>`: how many brands, 1 to 30 (`top_k`; Taste's default is 18).

Human output, `--json` (`{"ok":true,"data":<the answer exactly as GET /search/similar returned it>}`), Ctrl-C and network failures: as `taste search`.

Errors: `NOT_FOUND`, `FULL_EXTRACTION_REQUIRED`, `USAGE_INVALID_BRAND`, `INVALID_URL`, `PRIVATE_URL`, `USAGE_INVALID_VALUE`, `INSUFFICIENT_CREDITS`, `UPSTREAM`, `RATE_LIMITED`, `NETWORK`, `TIMEOUT`, `INTERRUPTED`, and the sign in errors of `taste whoami`.

Acceptance (proven by `src/commands/similar.test.ts`, `src/commands/resolve-brand.test.ts` and `scripts/mock-taste.test.ts`):

- The recorded tastelabs.com extraction's id shows the recorded similar brands as cards; `--json` data equals the recorded answer.
- `tastelabs.com` finds the recorded extraction with one list read (`q`, `status`, `kind`, `limit`, `offset`) and sends `--top` as `top_k`; `www.`, a trailing slash and the scheme don't matter, a port and another page of the site do, the newest full extraction by `accepted_at` wins whatever the list's order, a running one is skipped, and a match on the second page is found while one past the third is not.
- `stripe` alone exits 2 with `USAGE_INVALID_BRAND`, suggesting `stripe.com`, and sends nothing.
- An address with no extraction is `NOT_FOUND` naming `taste extract <url>`; `linear.app`, recorded only with `--sections`, is `FULL_EXTRACTION_REQUIRED` naming it too; neither makes a paid request. A selective extraction's id gets the recorded 422 as `FULL_EXTRACTION_REQUIRED`.
- `--top 0`, `31` and `two` exit 2 with no request; a private address fails before any request.
- A network failure in flight ends with the exact search hint above, not retryable (`src/api/client.test.ts` too).

### `taste check <candidate-url> --against <reference-url>`

Judges how closely a site follows a reference brand, such as a preview deployment against production. **Spends credits.** One `POST /judge/brand-adherence` (`{candidate_url, reference_url}`), then free polling of `GET /judge/brand-adherence/{id}` for its steps until it ends, then one read of `GET /judge/brand-adherence/{id}/result`.

- `<candidate-url>`, `--against <reference-url>`: both checked as `taste extract` checks its address (a bare domain means `https://`, `PRIVATE_URL` and `INVALID_URL` before any request). `--against` is required (`USAGE_MISSING_ARGUMENT`).
- `--min <score>`: a score from 0 to 1, such as `0.8`, the check must reach. Anything else (`2`, `-0.1`, `high`) fails with `USAGE_INVALID_VALUE` (exit 2) before any request. Below it, the command exits 1 with `BELOW_THRESHOLD`; a verdict with no score never reaches it. Without `--min` a finished check exits 0 whatever its score.
- `--no-wait`, `--timeout <seconds>`: as `taste extract`. `--min` with `--no-wait` fails with `USAGE_CONFLICTING_OPTIONS`: there is no verdict to judge.

Progress on stderr as `taste extract`, ending with `✓ Checked <candidate host> in 4m 01s`.

Human output on stdout, laid out at least 40 columns wide: the score with two decimals and a 20-cell bar (`█` and `░`; none while the score is null), coloured, with `✓` or `✗` and the minimum, only with `--min`; the candidate and reference addresses; every recommendation, numbered in Taste's order and wrapped to the width; the fixes summed by `action` (`20 fixes: snap_to_token 19, align_profile_field 1`), the first three in full and `taste wait <id> --format json` for the rest; the id and `taste share <id>`. Every string from Taste is cleaned of control characters. Below `--min` the verdict is shown first, then the error on stderr.

`--json`: `{"ok":true,"data":{"id","score","passed","min","recommendations","fixes"}}`: `score` is Taste's (0 to 1, or null), `passed` is `score >= min`, and `passed` and `min` are `null` without `--min`; `recommendations` and `fixes` are as Taste sent them. Below `--min`: `{"ok":false,"error":{"code":"BELOW_THRESHOLD",…,"details":<that same data, with passed false>}}`, so a script reads the findings without another call. With `--no-wait`, `{"ok":true,"data":{"id","status"}}`.

A failed check (the job's status `failed`, or a `424` on its result) ends with `ADHERENCE_FAILED`, its message carrying the job's own reason cleaned of control characters, and `error.details.id`. Failed checks are refunded by Taste. A failure while the `POST` is in flight has the paid hint pointing at `taste history checks`; once the check has started, every failure while waiting names `taste wait <id>`.

Errors: as `taste extract` without the `--out` and section errors, plus `BELOW_THRESHOLD` and `ADHERENCE_FAILED`.

Acceptance (proven by `src/commands/check.test.ts` and `src/render/verdict.test.ts`):

- The recorded `check-pass` verdict renders its score, its numbered recommendations and `taste share <id>`.
- The recorded `check-fail` verdict with `--min 0.8` exits 1 with `BELOW_THRESHOLD` and `error.details.score` 0.15; `check-pass` with `--min 0.8` exits 0; without `--min` it exits 0 with `passed` and `min` null; `--min 2` exits 2.
- A partial verdict (score null) draws no bar; the glyph shows only against a minimum; fixes are summed by action with the first three in full.

### `taste enhance "<prompt>" --brand <id|url>`

Rewrites a prompt in a brand's terms, grounded in one of your full extractions. **Spends credits.** One `POST /design/prompts/enhance` (`{submission_id, prompt}`), with a 120 s deadline, sent once.

- `<prompt>`: sent as typed; a blank one fails with `USAGE_INVALID_PROMPT` before a request.
- `--brand <id|url>`: required (`USAGE_MISSING_ARGUMENT` without it), found as `taste similar` finds its brand, with the same errors before anything is spent.

Human output: the enhanced prompt alone on stdout, exactly as Taste wrote it apart from one trailing newline (none added when it already ends with one), so `taste enhance "a pricing page" --brand stripe.com | pbcopy` copies just the prompt. Control characters other than newlines and tabs are stripped, as with all server text. On stderr: `✓ Enhanced for <brand>.`, the brand's name, else its address's host, else what `--brand` named.

`--json`: `{"ok":true,"data":<the answer exactly as POST /design/prompts/enhance returned it>}` (`enhanced_prompt`, `brand_name`, `source_url`, `model_used`), and nothing on stderr.

While the request is in flight, Ctrl-C, a network failure and a timeout end with the hint "It may have reached Taste and been charged. Enhancements aren't listed in taste history, so check your credits in your Taste account before you run it again.", never retryable.

Errors: as `taste similar`, plus `USAGE_INVALID_PROMPT` and `USAGE_MISSING_ARGUMENT`.

Acceptance (proven by `src/commands/enhance.test.ts` and `scripts/mock-taste.test.ts`):

- stdout is the recorded `enhanced_prompt` plus one newline, exactly; a prompt ending with a newline gets no second one; control characters are stripped and newlines and tabs kept.
- `--json` data equals the recorded answer, with nothing on stderr.
- `--brand https://www.tastelabs.com/` finds the recorded extraction with one list read before the one `POST`; a selective id or address is `FULL_EXTRACTION_REQUIRED`; a missing `--brand` or a blank prompt exits 2 with no request.
- The hard stop is told a paid request is in flight, then that nothing is; a network failure in flight ends with the exact enhance hint; `--help` says it spends credits.

### `taste history [extractions|checks|searches]`

Lists one page of your extractions and brand kits (the default), brand adherence checks or searches, newest first, as Taste keeps them. Free: it only reads.

- `--status <status>`: only this status. Extractions: `accepted`, `queued`, `crawling`, `extracting`, `completed`, `failed`. Checks: `accepted`, `extracting`, `judging`, `completed`, `failed`. Searches: `completed`, `failed`, `in_progress`. Any other fails with `USAGE_INVALID_VALUE` before a request.
- `--search <text>`: only entries whose address (extractions, checks) or query (searches) contains this.
- `--limit <n>` (1 to 100, default 20) and `--offset <n>` (default 0): the page.

Human output on stdout: a table with a dimmed header, one row per entry: the id, when it started (UTC, to the minute), the status and the address, or for a check its score and candidate address, or for a search its query. The list doesn't carry a check's score, so each completed check's verdict is read for it, four at a time; one that can't be read leaves its cell empty, and with `--debug` a `debug:` line on stderr names the check and the kind of failure. In a terminal the last column is cut with `…` to the width; a pipe gets it whole. When there are more, a dimmed line says how many are shown and the `--offset` for the next page. An empty list says `No extractions found.` (or checks, or searches).

`--json`: `{"ok":true,"data":<the list exactly as the API returned it>}` (`GET /design/submissions`, `GET /judge/brand-adherence` or `GET /search/submissions`), and no verdict reads.

Acceptance (proven by `src/commands/history.test.ts`):

- `taste history` lists the recorded extractions with their ids, dates, statuses and addresses in one request.
- `--json` data equals the API's list for checks and searches, with no other request.
- Checks show their recorded scores (0.90, 0.15); a verdict that can't be read leaves the cell empty, silently unless `--debug`; searches show their query.
- `--status`, `--search`, `--limit` and `--offset` reach the API as `status`, `q`, `limit` and `offset`; an unknown status, a limit out of range and an unknown list exit 2 with no request.
- A page short of the total names the next `--offset`; control characters from Taste are stripped; a terminal's width cuts the last column, a pipe doesn't.

### `taste wait <id>`

Picks up a job started earlier, with `--no-wait` or one interrupted or out of time, and ends it as the command that started it would. Free: it only reads. The id may be an extraction or brand kit (`GET /design/submissions/{id}`) or a brand adherence check (on a 404 there, `GET /judge/brand-adherence/{id}`); an id that is neither fails with `NOT_FOUND`. Takes `--format`, `--timeout` and `--out` as `taste extract` does; `--out` with a check's id fails with `USAGE_OUT_UNSUPPORTED` and `--format design-md` with `USAGE_FORMAT_UNSUPPORTED` (exit 2) before waiting on it, once a read of the check confirms it is one; an id that is neither stays `NOT_FOUND`. With `--out`, it is the free way to save a finished extraction's files again.

An extraction or brand kit ends as `taste extract` does. An adherence check ends as `taste check` without `--min` does (`✓ Checked <candidate host> in 4m 01s` on stderr, the verdict on stdout, a failed check `ADHERENCE_FAILED`), or with `--format json` the verdict as Taste sent it, indented; `--json` data is the verdict exactly as `GET /judge/brand-adherence/{id}/result` returned it.

Acceptance (proven by `src/commands/wait.test.ts`):

- A recorded extraction's id shows its summary; `--json` data equals the recorded result.
- A recorded adherence job's id is routed to its verdict (`GET` the submission, 404, then the job and its result), and `--format json` prints it; a running one is followed to its verdict.
- An unknown id is `NOT_FOUND`; Ctrl-C ends with the same id to wait on.
- `--out` with the recorded extraction's id saves the recorded manifest's files and sends no `POST`; with a check's id it exits 2 after the two reads that confirm it; with an unknown id it is `NOT_FOUND`.

### `taste share <id>`

Makes a finished result public, so anyone with its address can read it without signing in, or, with `--private`, private again. Free. The id is routed as `taste wait` routes it: `PATCH /design/submissions/{id}/visibility`, and on a 404 there `PATCH /judge/brand-adherence/{id}/visibility`; an id that is neither fails with `NOT_FOUND`. Taste serves a public result from its own result endpoint without authentication (the API reference, "Update visibility"), so that is the address given: `<TASTE_API_URL>/design/submissions/{id}/result` or `<TASTE_API_URL>/judge/brand-adherence/{id}/result`. The API itself returns no address.

`--json`: `{"ok":true,"data":{"id":string,"public":boolean,"url":string|null}}`; `url` is `null` once private. `public` is what Taste's answer says, never what was asked; an answer that doesn't say fails with `VISIBILITY_UNKNOWN` (retryable: setting it again is harmless). Human: `✓ Public. Anyone with this address can read the result, without signing in:` and the address on the next line, or `✓ Private. Only your account can read <id>.`

Acceptance (proven by `src/commands/share.test.ts`):

- A recorded extraction's id becomes public with one `PATCH` and the result address on `TASTE_API_URL`; `--private` makes it private again with `url` `null`.
- A check's id is routed to the check after the submission's 404; an unknown id is `NOT_FOUND`; an answer without `is_public` is `VISIBILITY_UNKNOWN`.

## Not in scope

- Telemetry, an update notifier or analytics of any kind.
- Multiple accounts or profiles, and a config file: flags and environment variables only.
- Wrapping Taste's MCP server: the CLI talks REST.
- Local rendering, screenshots or browser automation: the Taste Engine does that server side.
