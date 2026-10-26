<!-- Title: a conventional commit (`feat(extract): …`, `fix(wait): …`). The pull request is squash-merged, so the title and this description become its one commit on main, and the title becomes its release note. CI checks both. -->

## Why

The problem this solves, and for whom. If it changes what the CLI does, name the `TASTE-CLI.md` section it updates. Link the issue if there is one. Closes #

## What changed

-

## Evidence

How you know it works: the tests or commands you ran and their result, a recording or a measurement. Name any manual check.

Credit log (only if this change made a paid call to the Taste Engine; each one approved by the maintainer first):

| Call | Why | Credits before → after |
| ---- | --- | ---------------------- |

Independent review (fresh context, AGENTS.md): the tool, what it found, what was fixed, and what was rejected and why.

## Checklist

- [ ] `npm run check` passes
- [ ] `TASTE-CLI.md` and the README match the change; every acceptance check there is proven by a test
- [ ] No API key, token or personal data can reach any output, log, fixture or error

## Follow-ups

-
