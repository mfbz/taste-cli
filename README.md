# taste-cli

An unofficial command line for the [Taste Engine](https://docs.tastelabs.com), Taste Labs' design API.

> taste-cli is unofficial, not affiliated with Taste Labs, built on the Taste Engine API.

## Status

Early development. Today `taste` signs in, extracts a brand from a website or a brand guidelines PDF, saves its files, picks up a job started earlier, lists your history and shares a result. The commands being built, and how each one will behave, are specified in [TASTE-CLI.md](TASTE-CLI.md).

## Install

Node.js 24 or later. taste-cli isn't on npm; run it from source:

```sh
git clone https://github.com/mfbz/taste-cli.git
cd taste-cli
npm ci
npm run build
npm link        # puts `taste` on your PATH
```

## Login

```sh
taste login                              # sign in with your browser
taste login --api-key                    # or type an API key at a hidden prompt
taste login --with-api-key < key.txt     # or pipe one in, for scripts and CI
taste whoami                             # which account taste is using
taste logout                             # forget the saved sign in
```

A key is checked with Taste before it is saved, and taste never takes one as a command line argument. The sign in is kept in your system keychain (service `taste-cli`), or, where there is none, in a file only you can read in `~/.config/taste-cli` (`%APPDATA%\taste-cli` on Windows). Set `TASTE_API_KEY` to use a key without saving it; it wins over any saved sign in. `TASTE_API_URL` points taste at another Taste Engine address, such as a local mock. Details: [TASTE-CLI.md](TASTE-CLI.md), "Configuration".

## Extract a brand

`extract` and `kit` spend credits from your Taste account; `wait` is free.

```sh
taste extract stripe.com                         # wait with live progress, then a summary
taste extract stripe.com --sections colors,typography
taste extract stripe.com --format json > stripe.json
taste kit guidelines.pdf                         # a brand kit from a guidelines PDF
taste extract stripe.com --no-wait               # print the job's id and return
taste wait <id>                                  # pick a job up again, for free
taste extract stripe.com --out stripe            # also save its files into ./stripe
taste wait <id> --out stripe --overwrite         # save them again, for free
```

Every flag and the address are checked before anything is spent, and a paid request is never retried by itself. Ctrl-C stops waiting, not the job: the error names the id, and `taste wait <id>` picks it up. `--out` writes only inside the folder you name, which should be one only you can write to, and refuses one that already has files unless you add `--overwrite`. Details: [TASTE-CLI.md](TASTE-CLI.md), "Credits" and "Saving the files".

## History and sharing

Both are free.

```sh
taste history                          # your extractions and brand kits, newest first
taste history checks --status failed   # or checks, or searches, filtered
taste history --limit 50 --offset 50   # the next page
taste share <id>                       # make a result public and print its address
taste share <id> --private             # private again
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
