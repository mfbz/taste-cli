# taste-cli

The living spec: what `taste` is and how every command behaves. A change to what the CLI does updates its section here in the same pull request, with acceptance checks tied to tests.

taste-cli is unofficial, not affiliated with Taste Labs, built on the Taste Engine API.

## Status

Built: `taste --version`, `taste --help`, the global flags `--json` and `--debug`, and the usage-error path. Every command below is planned: its section is filled in by the pull request that builds it.

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

Acceptance (proven by `src/cli.test.ts` and `src/main.test.ts`):

- `taste --version` prints `0.0.0` and exits 0; under `--json` it is `{"ok":true,"data":{"version":"0.0.0"}}`.
- `taste --help`, and `taste` with no command, print the help with the unofficial line and exit 0; under `--json` the help is `data.help`.
- An unknown option exits 2 and names the option but never its value; under `--json` it is one document with `error.code` `USAGE_UNKNOWN_OPTION`. An unknown command exits 2 with `USAGE_UNKNOWN_COMMAND`.
- A reader that closes the pipe early is not an error.

## Credits

Credits are real money. Commands that spend them say so in `--help` and in the menu; a paid request is never retried automatically. Planned in detail with the first paid command.

## Commands

### `taste`

Planned.

### `taste login`

Planned.

### `taste logout`

Planned.

### `taste whoami`

Planned.

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
