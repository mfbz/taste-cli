# taste-cli

The living spec: what `taste` is and how every command behaves. A change to what the CLI does updates its section here in the same pull request, with acceptance checks tied to tests.

taste-cli is unofficial, not affiliated with Taste Labs, built on the Taste Engine API.

## Status

Built: `taste --version`, `taste --help`, the global flags `--json` and `--debug`, the usage-error path, signing in (`taste login`, `taste logout` and `taste whoami`), the job commands `taste extract`, `taste kit` and `taste wait` with `--out` to save a result's files, `taste history` and `taste share`. Every other command below is planned: its section is filled in by the pull request that builds it.

## What it is

A command line for the Taste Engine, Taste Labs' design API: extract a brand from a URL, search a corpus of brands, judge brand adherence, build brand kits from PDFs and enhance prompts. Taste in your terminal, your scripts, your CI and your agents, in one command.

## Interface

Global flags:

- `-v, --version`: print the version (`0.0.0` in the code; versions live in Git tags).
- `-h, --help`: print the help, ending with the line "taste is unofficial, not affiliated with Taste Labs, built on the Taste Engine API."
- `--json`: machine output.
- `--debug`: on failure, add the error's class and stack frames on stderr.

Planned global flags: `--no-motion`, `-y, --yes`.

### Output contract

- `--json` writes exactly one JSON document on stdout, errors included: `{"ok":true,"data":…}` or `{"ok":false,"error":{"code","message","hint","retryable"}}`, for every path including help, version, usage errors and Ctrl-C. Progress never reaches stdout.
- Without `--json`, results go to stdout and errors, notes, progress and prompts to stderr. A pipe gets no ANSI.
- Exit codes: 0 ok, 1 failure, 2 usage, 130 interrupted.
- Errors come only from a catalogue (`src/output/errors.ts`): code, message, hint, retryable. Untrusted server text is stripped of control characters before display.
- `retryable: true` means running the same command again is safe and costs nothing extra. It is `false` whenever the hint is `taste wait <id>` (a started job runs on; running the command again would start and pay for another) or the paid in-flight hint (the request may already have been charged).
- Warnings a person must see (a saved sign in ignored, a keychain that may still hold one) go to stderr in both modes, prefixed `warning:`; under `--json` stdout still carries only the one document.
- Ctrl-C aborts what is in flight and the command ends through the usual output. A second Ctrl-C, or a command that hasn't stopped two seconds later, ends the process at once, with the same exit code and document.
- After Ctrl-C the hint says to run the command again, or, when a job was started, `taste wait <id>` to pick it up, or, while a paid request is being sent, to check `taste history` first. The hard stop (a second Ctrl-C, or the two seconds running out) uses the same hint from what the command said is in flight, and without `--json` clears any progress line before its message. It never adds a second document: once the command has written its own, it exits without another, and a Ctrl-C after the command finished exits with the command's own code.
- A request that gets no answer within its deadline fails with `TIMEOUT` ("The Taste Engine didn't answer in time."), a connection that fails with `NETWORK` ("Couldn't reach the Taste Engine.").

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

Credits are real money. These rules hold for every command that spends them (today `extract` and `kit`):

- The command's `--help` says it spends credits. A command typed directly does not ask for confirmation: typing it is the decision. (The planned menu will confirm before spending.)
- Every flag, the address and the file are checked before the one request that spends credits, so a mistake costs nothing.
- A paid request is never retried automatically, not after a network failure, a timeout or a 5xx.
- A paid request that fails in flight (`NETWORK`, `TIMEOUT`, or Ctrl-C while it is being sent) may still have reached Taste and been charged. Its error is not retryable and the hint says to check `taste history` before running it again, never to try again. `taste history` with no options lists extractions and brand kits newest first, running ones included, so a job that did start is the first row, with the id to `taste wait` on.
- Once a job has started, it runs on Taste's side whatever happens to taste: Ctrl-C, `--timeout`, a network failure or a Taste error while waiting all end with the job's id and the hint `taste wait <id>`, which picks it up for free (`error.details.id` under `--json`).
- Failed jobs are refunded by Taste.

## Commands

### `taste`

Planned.

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
- `--format <format>`: `summary` (the default) or `json`, the whole result as Taste sent it, indented, for a file or another tool.
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

#### Saving the files (`--out`)

`extract`, `kit` and `wait` (for an extraction or a brand kit) take `--out <dir>`: once the job is done, its files are read from the download manifest (`GET /design/submissions/{id}/download`, free) and saved under `dir`, at the relative paths the manifest names: `guidelines.json`, `design_system.md`, the captured HTML, CSS and screenshot, and the brand's assets. Inline files are written as they are; the rest are downloaded, four at a time, from public `https` addresses only, with no Taste credential and every redirect checked the same way. An entry carrying both is written from its inline content. The `--json` document and the summary are the same as without `--out`; a line on stderr says how many files were saved and where.

- The folder is checked before the paid request: it may be missing (it is created) or empty; one with files in it fails with `OUTPUT_EXISTS` unless `--overwrite` is given, which replaces files of the same name and leaves the others. A path that is a file, or a folder taste can't read, fails with `OUTPUT_UNUSABLE`.
- Every path and address in the manifest is the server's, so all of them are checked before anything is written. A path that is absolute (`/etc/x`, `C:\x`, `\\server\x`), names a drive or a stream (`:`), has a `..` segment anywhere (even one that would come back down), a segment ending in a dot or a space, or a control character, fails with `BUNDLE_PATH_UNSAFE`. Two entries landing on the same file (compared without case), a file that is also another entry's folder, an entry with nothing to save, or an address that isn't public `https` fail with `BUNDLE_INVALID`. Either way nothing is written.
- Nothing is written through a symlink: every folder from `dir` down to a file's is checked with `lstat` (an existing symlink there fails with `BUNDLE_PATH_UNSAFE`, nothing written), each file is created with `wx`, which refuses anything already in its place, and `--overwrite` removes a file before creating it rather than writing through it. `dir` itself may be a symlink: it is the person's choice.
- A download or a write that fails partway ends with `BUNDLE_INCOMPLETE`: how many files were saved, which one failed, and the hint `taste wait <id> --out` with the same folder and `--overwrite`, which saves them again for free (`error.details.id`; not retryable, since running `extract` again would pay again). A file whose write failed is removed, never left half written. Ctrl-C stops before the next file and ends with `taste wait <id>`.

Acceptance (proven by `src/download/bundle.test.ts`, `src/commands/extract.test.ts`, `src/commands/kit.test.ts` and `src/commands/wait.test.ts`):

- The recorded manifest's files are written at its paths with its inline content, and only its URL entries are downloaded.
- `../x`, `/etc/x`, `a/../../x`, `C:\x`, `\\server\x` and the other hostile paths fail with `BUNDLE_PATH_UNSAFE` and leave the temporary folder empty; a symlink planted in `dir`, to a folder or a file outside it, fails the same way and nothing outside is touched.
- An entry whose URL points to a private host (`169.254.169.254`) or is `http` fails with `BUNDLE_INVALID` before any download or write.
- A download failing on the second of three files reports 1 of 3 saved; a write failing halfway leaves no partial file.
- A folder with files fails with `OUTPUT_EXISTS` before any request; `--overwrite` replaces files of the same name.
- No more than four downloads run at once.

### `taste kit <file.pdf>`

Extracts a brand kit from a brand guidelines PDF. **Spends credits.** The file is checked before the upload: it must exist and be a file (`FILE_NOT_FOUND`), be at most 50 MB (`FILE_TOO_LARGE`, refused without reading it) and start with `%PDF-` and not be empty (`INVALID_FILE`). Then one `POST /design/submissions/brand-kit` (never served from a cache), and the same waiting, progress, `--format`, `--no-wait`, `--timeout`, `--out`, output and `--json` shapes as `taste extract`.

Acceptance (proven by `src/commands/kit.test.ts`):

- The committed sample PDF uploads and its summary shows the brand, its colours and its type.
- A `.txt` file, an empty file, a missing path, a folder and a file over 50 MB fail before any upload.
- `--out` saves the brand kit's files; a folder with files in it fails before the upload.

### `taste search "<query>"`

Planned.

### `taste similar <id|url>`

Planned.

### `taste check <candidate-url> --against <reference-url>`

Planned.

### `taste enhance "<prompt>" --brand <id|url>`

Planned.

### `taste history [extractions|checks|searches]`

Lists one page of your extractions and brand kits (the default), brand adherence checks or searches, newest first, as Taste keeps them. Free: it only reads.

- `--status <status>`: only this status. Extractions: `accepted`, `queued`, `crawling`, `extracting`, `completed`, `failed`. Checks: `accepted`, `extracting`, `judging`, `completed`, `failed`. Searches: `completed`, `failed`, `in_progress`. Any other fails with `USAGE_INVALID_VALUE` before a request.
- `--search <text>`: only entries whose address (extractions, checks) or query (searches) contains this.
- `--limit <n>` (1 to 100, default 20) and `--offset <n>` (default 0): the page.

Human output on stdout: a table with a dimmed header, one row per entry: the id, when it started (UTC, to the minute), the status and the address, or for a check its score and candidate address, or for a search its query. The list doesn't carry a check's score, so each completed check's verdict is read for it, four at a time; one that can't be read leaves its cell empty. In a terminal the last column is cut with `…` to the width; a pipe gets it whole. When there are more, a dimmed line says how many are shown and the `--offset` for the next page. An empty list says `No extractions found.` (or checks, or searches).

`--json`: `{"ok":true,"data":<the list exactly as the API returned it>}` (`GET /design/submissions`, `GET /judge/brand-adherence` or `GET /search/submissions`), and no verdict reads.

Acceptance (proven by `src/commands/history.test.ts`):

- `taste history` lists the recorded extractions with their ids, dates, statuses and addresses in one request; a job just started is the first row.
- `--json` data equals the API's list for checks and searches, with no other request.
- Checks show their recorded scores (0.90, 0.15); searches show their query.
- `--status`, `--search`, `--limit` and `--offset` reach the API as `status`, `q`, `limit` and `offset`; an unknown status, a limit out of range and an unknown list exit 2 with no request.
- A page short of the total names the next `--offset`; control characters from Taste are stripped; a terminal's width cuts the last column, a pipe doesn't.

### `taste wait <id>`

Picks up a job started earlier, with `--no-wait` or one interrupted or out of time, and ends it as the command that started it would. Free: it only reads. The id may be an extraction or brand kit (`GET /design/submissions/{id}`) or a brand adherence check (on a 404 there, `GET /judge/brand-adherence/{id}`); an id that is neither fails with `NOT_FOUND`. Takes `--format`, `--timeout` and `--out` as `taste extract` does; `--out` with a check's id fails with `USAGE_OUT_UNSUPPORTED` (exit 2) before waiting on it. With `--out`, it is the free way to save a finished extraction's files again.

An extraction or brand kit ends as `taste extract` does. An adherence check ends with `✓ Checked <candidate host> in 4m 01s` on stderr and, on stdout, the score, the candidate and reference addresses, the recommendations and the id, or with `--format json` the verdict as Taste sent it, indented; `--json` data is the verdict exactly as `GET /judge/brand-adherence/{id}/result` returned it.

Acceptance (proven by `src/commands/wait.test.ts`):

- A recorded extraction's id shows its summary; `--json` data equals the recorded result.
- A recorded adherence job's id is routed to its verdict (`GET` the submission, 404, then the job and its result), and `--format json` prints it; a running one is followed to its verdict.
- An unknown id is `NOT_FOUND`; Ctrl-C ends with the same id to wait on.
- `--out` with the recorded extraction's id saves the recorded manifest's files and sends no `POST`; with a check's id it exits 2 after one request.

### `taste share <id>`

Makes a finished result public, so anyone with its address can read it without signing in, or, with `--private`, private again. Free. The id is routed as `taste wait` routes it: `PATCH /design/submissions/{id}/visibility`, and on a 404 there `PATCH /judge/brand-adherence/{id}/visibility`; an id that is neither fails with `NOT_FOUND`. Taste serves a public result from its own result endpoint without authentication (the API reference, "Update visibility"), so that is the address given: `<TASTE_API_URL>/design/submissions/{id}/result` or `<TASTE_API_URL>/judge/brand-adherence/{id}/result`. The API itself returns no address.

`--json`: `{"ok":true,"data":{"id":string,"public":boolean,"url":string|null}}`; `url` is `null` once private. Human: `✓ Public. Anyone with this address can read the result, without signing in:` and the address on the next line, or `✓ Private. Only your account can read <id>.`

Acceptance (proven by `src/commands/share.test.ts`):

- A recorded extraction's id becomes public with one `PATCH` and the result address on `TASTE_API_URL`; `--private` makes it private again with `url` `null`.
- A check's id is routed to the check after the submission's 404; an unknown id is `NOT_FOUND`.

## Not in scope

- Telemetry, an update notifier or analytics of any kind.
- Multiple accounts or profiles, and a config file: flags and environment variables only.
- Wrapping Taste's MCP server: the CLI talks REST.
- Local rendering, screenshots or browser automation: the Taste Engine does that server side.
