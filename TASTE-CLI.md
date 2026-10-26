# taste-cli

The living spec: what `taste` is and how every command behaves. A change to what the CLI does updates its section here in the same pull request, with acceptance checks tied to tests.

taste-cli is unofficial, not affiliated with Taste Labs, built on the Taste Engine API.

## Status

Built: `taste --version`, `taste --help`, the global flags `--json` and `--debug`, the usage-error path, and signing in: `taste login`, `taste logout` and `taste whoami`. Every other command below is planned: its section is filled in by the pull request that builds it.

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
- Warnings a person must see (a saved sign in ignored, a keychain that may still hold one) go to stderr in both modes, prefixed `warning:`; under `--json` stdout still carries only the one document.
- Ctrl-C aborts what is in flight and the command ends through the usual output. A second Ctrl-C, or a command that hasn't stopped two seconds later, ends the process at once, with the same exit code and document.
- After Ctrl-C the hint says to run the command again, or, when a job was started, `taste wait <id>` to pick it up.

Acceptance (proven by `src/cli.test.ts` and `src/main.test.ts`):

- `taste --version` prints `0.0.0` and exits 0; under `--json` it is `{"ok":true,"data":{"version":"0.0.0"}}`.
- `taste --help`, and `taste` with no command, print the help with the unofficial line and exit 0; under `--json` the help is `data.help`.
- An unknown option exits 2 and names the option but never its value; under `--json` it is one document with `error.code` `USAGE_UNKNOWN_OPTION`. An unknown command exits 2 with `USAGE_UNKNOWN_COMMAND`.
- A reader that closes the pipe early is not an error.
- A Taste key (`taste_` followed by long random text) or a token (a JWT) anywhere in argv, as a whole argument or a whole option value, is refused with `KEY_IN_ARGV` (exit 2) before any command runs, and is never echoed. File names and words that only start with `taste_`, such as `taste_logo_final.pdf` or `taste_engine_reviews`, go through (`src/cli.test.ts`).
- `--debug` adds only the error's class name and stack frames; an error's message and its cause never reach output, in either mode (`src/cli.test.ts`).
- Ctrl-C ends a running command with exit 130 and, under `--json`, one `INTERRUPTED` document (`src/main.test.ts`); without a job the hint is "Run the command again." (`src/output/output.test.ts`).
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

Credits are real money. Commands that spend them say so in `--help` and in the menu; a paid request is never retried automatically. Planned in detail with the first paid command.

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

Planned.

### `taste kit <file.pdf>`

Planned.

### `taste search "<query>"`

Planned.

### `taste similar <id|url>`

Planned.

### `taste check <candidate-url> --against <reference-url>`

Planned.

### `taste enhance "<prompt>" --brand <id|url>`

Planned.

### `taste history [extractions|checks|searches]`

Planned.

### `taste wait <id>`

Planned.

### `taste share <id>`

Planned.

## Not in scope

- Telemetry, an update notifier or analytics of any kind.
- Multiple accounts or profiles, and a config file: flags and environment variables only.
- Wrapping Taste's MCP server: the CLI talks REST.
- Local rendering, screenshots or browser automation: the Taste Engine does that server side.
