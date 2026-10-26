# DESIGN.md: how taste-cli looks and behaves in a terminal

This file is binding for anything a person sees. The opening and the result layouts are not designed yet; each lands here with the change that builds it, and a test keeps the code and this file in step.

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

## Errors

```text
✗ error: There is no option --nope here.
  See taste --help, or --help after the command.
```

One line saying what happened, one indented line saying what to do next. Every message comes from the catalogue in `src/output/errors.ts`.

## Voice

Short, plain and calm. No em dashes and no exclamation marks. Say what happened and what to do next; never blame the user.
