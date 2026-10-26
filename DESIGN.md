# DESIGN.md: how taste-cli looks and behaves in a terminal

This file is binding for anything a person sees. The opening and most result layouts are not designed yet; each lands here with the change that builds it, and a test keeps the code and this file in step.

## Output modes

- Results go to stdout; errors, notes, progress and prompts go to stderr.
- `--json`: exactly one JSON document on stdout and nothing else, for scripts and agents.
- A pipe, `NO_COLOR` or `TERM=dumb` gets plain text: no colour, no motion.

## Palette

Placeholders: the colours observed on tastelabs.com, finalized with the brand pass. `src/output/theme.ts` holds them and a test keeps this table in step.

| Name       | Hex       | Used for                  |
| ---------- | --------- | ------------------------- |
| `signal`   | `#FF3D00` | accent and errors         |
| `acid`     | `#F2F04A` | warnings                  |
| `electric` | `#1E7BFF` | reserved                  |
| `success`  | `#3DDC84` | success                   |
| `paper`    | `#F3F3EF` | the sign in page's text   |
| `field`    | `#1B1B1B` | the sign in page's ground |

In a terminal the user's own foreground and background are kept. Motion is off in CI, with `NO_COLOR`, `TERM=dumb` and `TASTE_NO_MOTION`.

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

## Errors

```text
✗ error: There is no option --nope here.
  See taste --help, or --help after the command.
```

One line saying what happened, one indented line saying what to do next. Every message comes from the catalogue in `src/output/errors.ts`.

## Voice

Short, plain and calm. No em dashes and no exclamation marks. Say what happened and what to do next; never blame the user.
