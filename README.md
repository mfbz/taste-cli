# taste-cli

An unofficial command line for the [Taste Engine](https://docs.tastelabs.com), Taste Labs' design API.

> taste-cli is unofficial, not affiliated with Taste Labs, built on the Taste Engine API.

## Status

Early development. Today `taste` prints its version and its help; nothing calls the Taste Engine yet, so nothing spends credits. The commands being built, and how each one will behave, are specified in [TASTE-CLI.md](TASTE-CLI.md).

## Install

Node.js 24 or later. taste-cli isn't on npm; run it from source:

```sh
git clone https://github.com/mfbz/taste-cli.git
cd taste-cli
npm ci
npm run build
npm link        # puts `taste` on your PATH
```

## Usage

```sh
taste --help      # what taste can do
taste --version   # the version
```

Every command takes `--json` for machine output (exactly one JSON document on stdout, errors included) and `--debug` to add an error's class and stack frames on stderr. Exit codes: 0 ok, 1 failure, 2 usage error, 130 interrupted.

## Development

```sh
npm run check          # format:check, lint, typecheck, test
npm run cli -- --help  # build, then run the CLI from source
```

How changes are made, tested and reviewed: [CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md).

## Credits

Built on the [Taste Engine API](https://docs.tastelabs.com). Taste, Taste Labs and the Taste Engine are Taste Labs' names; see [NOTICE.md](NOTICE.md).

## License

[MIT](LICENSE).
