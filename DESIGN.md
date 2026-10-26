# DESIGN.md: how taste-cli looks and behaves in a terminal

This file is binding for anything a person sees. Each layout lands here with the change that builds it, and a test keeps the palette in the code and this file in step.

## Output modes

- Results go to stdout; errors, notes, progress and prompts go to stderr.
- `--json`: exactly one JSON document on stdout and nothing else, for scripts and agents.
- A pipe, `NO_COLOR` or `TERM=dumb` gets plain text: no colour, no motion.

## Palette

The look of tastelabs.com: monochrome, quiet and high contrast. Type is `paper`, which in a terminal is the terminal's own foreground so a light theme stays readable, anything secondary is `grey`, and colour lives only in content (a brand's own swatches), never in chrome. The one exception is `signal`, on errors, because a failure must stand out. `src/output/theme.ts` holds them and a test keeps this table in step.

| Name     | Hex       | Used for                                                                             |
| -------- | --------- | ------------------------------------------------------------------------------------ |
| `paper`  | `#F3F3EF` | emphasis in bold (names, scores, the spinner), `✓`, `warning:`, the score bar's fill |
| `grey`   | `#8B8B8B` | labels, taglines, hints, notes, the opening's tagline and rule                       |
| `faint`  | `#5A5A5A` | the score bar's track, the opening's version                                         |
| `signal` | `#FF3D00` | errors with `✗`, and a score below `--min`: the only colour in chrome                |
| `field`  | `#1E1E1E` | the sign in page's ground, never painted in a terminal                               |

`paper` is never painted in a terminal: emphasis is bold in the terminal's own foreground. With 256 colours `grey` is 245, `faint` 240 and `signal` 202; with 16, `grey` and `faint` bright black (90) and `signal` red (31). It reads the same on a dark or a light theme; `NO_COLOR` gives plain text. Motion is off in CI, with `NO_COLOR`, `TERM=dumb` and `TASTE_NO_MOTION`.

Labels (`palette`, `type`, `score`, `recommendations`, a table's header) are short, lowercase and `grey`, in the spirit of Taste's small mono labels.

## The opening and the menu

Bare `taste` in an interactive terminal opens with one line and a rule under it:

```text
◇ taste  the Taste Engine, in your terminal  0.0.0
──────────────────────────────────────────────────────────
```

`◇ taste` in bold `paper`, the tagline in `grey`, the version in `faint`, then a `grey` rule 58 columns wide, or 4 columns less than the terminal when that is narrower, with a blank line above and below. `taste` types itself, one letter every 50 ms behind a `grey` `_` cursor, then the tagline and the rule appear: about a quarter of a second. The cursor is hidden while it plays and always shown again. Any key, or Ctrl-C, jumps to the last frame. Without motion only the last frame is drawn; without colour it is plain. It is drawn on stderr, and never outside an interactive terminal.

Then one `grey` line says who taste is signed in as (`Signed in as <email>.`, `Signed in with an API key.`, `Using an API key from TASTE_API_KEY.` or `Not signed in.`), and a menu (`@clack/prompts`) lists the actions, each one that spends credits marked `(uses credits)`. The menu keeps clack's own colours (a cyan rail, a green `●` on the active item): clack 1.x draws them with fixed `node:util` styles and offers no setting to change them.

## The sign in page

The page the browser shows when `taste login` finishes: `field` ground, `paper` type in a monospace stack, the TASTE wordmark inline above one line of copy ("You're signed in. You can close this tab and go back to the terminal."). It is self-contained: no fonts, images or scripts are fetched, and a strict content security policy holds it to that. A failed sign in shows the catalogue message and "Go back to the terminal to try again.", never words from the request. The wordmark is Taste Labs' trademark (`assets/brand/NOTICE.md`).

## Sign in results

```text
✓ Signed in as person@example.com.
✓ Signed out.
Signed in as person@example.com (browser session).
```

A `✓` starts a line that reports a change; `whoami` only reports, so it has none. The email is the server's text, cleaned of control characters before it is shown.

## Job progress

While `extract`, `kit` or `wait` waits on a job, progress goes to stderr. In a terminal that allows motion, one line redraws in place every 80 ms: a bold `paper` spinner, the step in words and the time so far in `grey`.

```text
⠋ Crawling · 12s
```

The line is cut with `…` to one column less than the terminal's width, so it never wraps (a wrapped line would add a row every frame). A warning or note written meanwhile clears the line first and draws it again after. Without motion (a pipe, CI, `TASTE_NO_MOTION`) each step is one plain line instead (`Crawling · 12s`); under `--json`, nothing. The line is cleared before anything else is written, and the wait ends with a `✓`:

```text
✓ Extracted Stripe in 48s
✓ Extracted Stripe (cached)
```

## Brand summary

What `extract`, `kit` and `wait` print on stdout for a finished extraction. The brand name in bold, the tagline in `grey`, then `grey` labels in a 7-column gutter. Each colour is a swatch (`██` in the brand's own colour, truecolor or the nearest of 256), its hex and its name in `grey`; with 16 colours or none, the hex and name alone, since a near miss would mislead. Lines are cut with `…` to the terminal's width; a terminal narrower than 40 columns, or one that reports no width, gets 40-column lines that it may wrap. Fields the result doesn't have are left out, never filled in.

```text
Stripe
style  Flat Design, Corporate
tone   Confident, Technical, Precise

palette
  ██ #RRGGBB  Blurple
  ██ #RRGGBB  Deep Navy

type   sohne-var, SourceCodePro

source https://stripe.com/
id     <id>

All of it: taste wait <id> --format json
```

An adherence verdict (from `check` and `wait`) is the score in bold with a 20-cell bar, filled in `paper` over a `faint` track, the candidate and reference addresses, then the numbered recommendations. With `--min`, a score at or above it gets a `paper` `✓` and a `grey` `min 0.80`; one below it gets `✗ min 0.80` in `signal`.

```text
score     0.62  ████████████░░░░░░░░  ✗ min 0.80
candidate https://stripe.com/
reference https://tastelabs.com/
```

With `--out`, one more line on stderr once the files are saved, before the summary:

```text
✓ Saved 23 files to stripe
```

When an asset is gone for good (refused at an unsigned address, or too large), the line counts it, and one warning names it by path and status:

```text
✓ Saved 79 files to taste, skipped 1
warning: Skipped a file whose download is gone or too large: site-assets/media/image/hero.avif (403)
```

## History

`taste history` prints a table on stdout: a `grey` header, columns padded to their widest cell and two spaces apart. In a terminal the last column (the address or query) is cut with `…` to one column less than the width, keeping at least 16 columns; a pipe gets it whole. Dates are UTC, to the minute.

```text
id                                    when (UTC)        status     address
<id>                                  2026-10-26 10:03  completed  https://stripe.com/

1 of 4. More with --offset 1.
```

Checks add a `score` column (two decimals, empty when there is none yet) before the candidate address. The last line, in `grey`, appears only when there are more. An empty list is one line: `No extractions found.`

## Share

```text
✓ Public. Anyone with this address can read the result, without signing in:
  https://api.tastelabs.com/design/submissions/<id>/result
✓ Private. Only your account can read <id>.
```

## Brand cards

`search` and `similar` print numbered cards on stdout, a blank line between them. The number, then the brand's name in bold (its address's host when it has none) and its match tier and badge in `grey`; below, indented to the name: the address, why it matched (or its identity paragraph when the search gave no reason) in `grey`, the primary colours as swatches and hexes on one line (hexes alone with 16 colours or none, and no line when the card has no palette), and the tags in `grey`. In a terminal every line is cut with `…` to the width, at least 40 columns, with the `…` outside the bold; a pipe gets every line whole. A `grey` footer says how to extract one.

```text
1  driver  strong
   https://driver.ai/product
   White-on-deep-black documentation style with hairline-ruled strict grids…
   ██ #RRGGBB  ██ #RRGGBB  ██ #RRGGBB
   Angular/Sharp, Authoritative, B2B Decision Maker, Brutalism, Developer/…

Extract one in full with taste extract <url> (spends credits).
```

No results is one line: `No brands found.`

## Enhance

`enhance` prints the enhanced prompt alone on stdout, as Taste wrote it, so it pipes into a file or the clipboard untouched. The one line for a person goes to stderr:

```text
✓ Enhanced for Stripe.
```

## Errors

```text
✗ error: There is no option --nope here.
  See taste --help, or --help after the command.
```

One line saying what happened, its `✗ error:` in `signal`, then one indented `grey` line saying what to do next. A warning starts with `warning:` in `paper`. Every message comes from the catalogue in `src/output/errors.ts`.

## Voice

Short, plain and calm. No em dashes and no exclamation marks. Say what happened and what to do next; never blame the user.
