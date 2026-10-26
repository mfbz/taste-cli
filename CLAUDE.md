@AGENTS.md

## Claude Code only

- Skills live in `.agents/skills/` and appear here through the `.claude/skills` symlink.
- A PostToolUse hook runs Prettier on every file you edit (`.claude/hooks/format-edited-file.mjs`).
- Designs and plans go in `docs/superpowers/` (gitignored scratch); the PR description is the record.
- `.claude/settings.json` denies bypassing the guards, pushing to `main`, force-pushing, merging pull requests, and reading `.env` files or stored taste-cli credentials. Put personal overrides in `.claude/settings.local.json` (gitignored), never in the shared file.
- Prefer Read/Edit/Grep over shell `cat`/`sed`/`grep`.
