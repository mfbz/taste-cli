# taste-cli

An unofficial command line for the [Taste Engine](https://docs.tastelabs.com), Taste Labs' design API.

> taste-cli is unofficial, not affiliated with Taste Labs, built on the Taste Engine API.

## Status

Early development. Today `taste` signs in, extracts a brand from a website or a brand guidelines PDF, saves its files, picks up a job started earlier, searches brands, finds similar ones, enhances prompts, lists your history and shares a result. The commands being built, and how each one will behave, are specified in [TASTE-CLI.md](TASTE-CLI.md).

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

## Search brands

`search` and `similar` spend credits from your Taste account (a deep search costs more); a failed request is refunded. Both answer at once, with no job to wait for, and show numbered cards: the brand and how well it matched, its address, why it matched (or how it looks), its primary colours and its tags.

```sh
taste search "dark brutalist developer tools"                 # 6 brands, fast
taste search "calm fintech pricing" --deep --top 10           # slower, closer, with a reason per brand
taste search "playful onboarding" --industry saas --page-type landing_page
taste similar stripe.com                                      # brands that look like your stripe.com extraction
taste similar <id> --top 5
```

- `search "<query>"`: the look you want, 2 to 400 characters. `--deep` for a slower, closer search; `--top <n>` for 1 to 30 brands (Taste's default is 6); `--industry` and `--page-type` to keep only brands of that kind (`taste search --help` lists the values).
- `similar <id|url>`: brands from Taste's corpus that look like one of your full extractions. Give its id, or the site's address: taste finds your newest finished full extraction of it, for free, and never starts one. With none, or only one made with `--sections`, it stops before spending and names the `taste extract` to run. `--top <n>` for 1 to 30 brands (Taste's default is 18).

With `--json`, `data` is Taste's answer as it came: `{"search_id","depth","results":[…]}` for a search, `{"results":[…]}` for similar, each result a card with `url`, `brand_name`, `match`, `reason`, `tags`, `palette` and more ([TASTE-CLI.md](TASTE-CLI.md), "taste search").

```sh
taste search "dark brutalist developer tools" --json | jq -r '.data.results[].url'
```

## Enhance a prompt

`enhance` rewrites a prompt in a brand's terms, from one of your full extractions. It spends credits.

```sh
taste enhance "Design a pricing page" --brand stripe.com
taste enhance "Design a pricing page" --brand stripe.com | pbcopy    # straight to the clipboard
taste enhance "An onboarding flow" --brand <id> > prompt.txt
```

`--brand` takes an extraction's id or a site's address, found as `similar` finds it. The enhanced prompt alone goes to stdout, so it pipes cleanly; which brand it used goes to stderr. With `--json`, `data` is Taste's answer: `{"enhanced_prompt","brand_name","source_url","model_used"}`.

A paid request is sent once. If it fails on the way it may still have been charged: for `search` and `similar`, check `taste history searches` before running it again.

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
