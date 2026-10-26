# DESIGN.md: how taste-cli looks and behaves in a terminal

This file is binding for anything a person sees. Each layout lands here with the change that builds it, and a test keeps the palette in the code and this file in step.

## Output modes

- Results go to stdout; errors, notes, progress and prompts go to stderr.
- `--json`: exactly one JSON document on stdout and nothing else, for scripts and agents.
- A pipe, `NO_COLOR` or `TERM=dumb` gets plain text: no colour, no motion.

## Palette

The colours of tastelabs.com. `signal` is the one accent; nothing else competes with it. `src/output/theme.ts` holds them and a test keeps this table in step.

| Name       | Hex       | Used for                                                         |
| ---------- | --------- | ---------------------------------------------------------------- |
| `signal`   | `#FF3D00` | the accent: the opening's wordmark, the spinner, errors with `✗` |
| `acid`     | `#F2F04A` | warnings                                                         |
| `electric` | `#1E7BFF` | reserved                                                         |
| `success`  | `#3DDC84` | success, with `✓`                                                |
| `paper`    | `#F3F3EF` | the sign in page's text                                          |
| `field`    | `#1B1B1B` | the sign in page's ground                                        |

`paper` and `field` are never painted in a terminal: the user's own foreground and background are kept, so light themes stay readable. Motion is off in CI, with `NO_COLOR`, `TERM=dumb` and `TASTE_NO_MOTION`.

## The opening and the menu

Bare `taste` in an interactive terminal opens with the TASTE wordmark in our own block lettering (five rows, 58 columns; not Taste Labs' logo), in `signal`, and one dimmed line under it:

```text
██████████  ▄████████▄  ▄████████▄  ██████████  ██████████
   ████     ████  ████  ████    ▀▀     ████     ████
   ████     ██████████  ▀████████▄     ████     ████████
   ████     ████  ████  ▄▄    ████     ████     ████
   ████     ████  ████  ▀████████▀     ████     ██████████

unofficial CLI for the Taste Engine · 0.0.0
```

It resolves in about half a second (12 frames, 45 ms apart): each cell of the wordmark fades in through `░ ▒ ▓` in the order of a 4×4 Bayer matrix as a threshold rises. The cursor is hidden while it plays and always shown again. Any key, or Ctrl-C, jumps to the last frame. Without motion only the last frame is drawn; without colour it is plain; in a terminal narrower than 64 columns it is one line: `TASTE · unofficial CLI for the Taste Engine`. It is drawn on stderr, and never outside an interactive terminal.

Then one dimmed line says who taste is signed in as (`Signed in as <email>.`, `Signed in with an API key.`, `Using an API key from TASTE_API_KEY.` or `Not signed in.`), and a menu (`@clack/prompts`, in its own colours) lists the actions, each one that spends credits marked `(uses credits)`.

## The sign in page

The page the browser shows when `taste login` finishes: `field` ground, `paper` type in a monospace stack, the TASTE wordmark inline above one line of copy ("You're signed in. You can close this tab and go back to the terminal."). It is self-contained: no fonts, images or scripts are fetched, and a strict content security policy holds it to that. A failed sign in shows the catalogue message and "Go back to the terminal to try again.", never words from the request. The wordmark is Taste Labs' trademark (`assets/brand/NOTICE.md`).

## Sign in results

```text
✓ Signed in as person@example.com.
✓ Signed out.
Signed in as person@example.com (browser session).
```

A `success` check mark starts a line that reports a change; `whoami` only reports, so it has none. The email is the server's text, cleaned of control characters before it is shown.

## Job progress

While `extract`, `kit` or `wait` waits on a job, progress goes to stderr. In a terminal that allows motion, one line redraws in place every 80 ms: a `signal` spinner, the step in words and the time so far, dimmed.

```text
⠋ Crawling · 12s
```

The line is cut with `…` to one column less than the terminal's width, so it never wraps (a wrapped line would add a row every frame). A warning or note written meanwhile clears the line first and draws it again after. Without motion (a pipe, CI, `TASTE_NO_MOTION`) each step is one plain line instead (`Crawling · 12s`); under `--json`, nothing. The line is cleared before anything else is written, and the wait ends with a `success` check mark:

```text
✓ Extracted Stripe in 48s
✓ Extracted Stripe (cached)
```

## Brand summary

What `extract`, `kit` and `wait` print on stdout for a finished extraction. The brand name in bold, the tagline dimmed, then dimmed labels in a 7-column gutter. Each colour is a swatch (`██` in the brand's own colour, truecolor or the nearest of 256), its hex and its name dimmed; with 16 colours or none, the hex and name alone, since a near miss would mislead. Lines are cut with `…` to the terminal's width; a terminal narrower than 40 columns, or one that reports no width, gets 40-column lines that it may wrap. Fields the result doesn't have are left out, never filled in.

```text
Stripe
Style  Flat Design, Corporate
Tone   Confident, Technical, Precise

Palette
  ██ #RRGGBB  Blurple
  ██ #RRGGBB  Deep Navy

Type   sohne-var, SourceCodePro

Source https://stripe.com/
Id     <id>

All of it: taste wait <id> --format json
```

An adherence verdict (from `wait`) is the score in bold, the candidate and reference addresses, then the recommendations as a dashed list.

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

`taste history` prints a table on stdout: a dimmed header, columns padded to their widest cell and two spaces apart. In a terminal the last column (the address or query) is cut with `…` to one column less than the width, keeping at least 16 columns; a pipe gets it whole. Dates are UTC, to the minute.

```text
ID                                    WHEN (UTC)        STATUS     ADDRESS
<id>                                  2026-10-26 10:03  completed  https://stripe.com/

1 of 4. More with --offset 1.
```

Checks add a `SCORE` column (two decimals, empty when there is none yet) before the candidate address. The last line, dimmed, appears only when there are more. An empty list is one line: `No extractions found.`

## Share

```text
✓ Public. Anyone with this address can read the result, without signing in:
  https://api.tastelabs.com/design/submissions/<id>/result
✓ Private. Only your account can read <id>.
```

## Brand cards

`search` and `similar` print numbered cards on stdout, a blank line between them. The number, then the brand's name in bold (its address's host when it has none) and its match tier and badge dimmed; below, indented to the name: the address, why it matched (or its identity paragraph when the search gave no reason) dimmed, the primary colours as swatches and hexes on one line (hexes alone with 16 colours or none, and no line when the card has no palette), and the tags dimmed. In a terminal every line is cut with `…` to the width, at least 40 columns, with the `…` outside the bold; a pipe gets every line whole. A dimmed footer says how to extract one.

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

One line saying what happened, one indented line saying what to do next. Every message comes from the catalogue in `src/output/errors.ts`.

## Voice

Short, plain and calm. No em dashes and no exclamation marks. Say what happened and what to do next; never blame the user.
