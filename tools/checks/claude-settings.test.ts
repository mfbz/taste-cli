import { describe, expect, it } from "vitest";

import settings from "../../.claude/settings.json" with { type: "json" };

// Claude Code matches a Bash rule against the whole command, `*` standing for any text.
function matches(rule: string, command: string): boolean {
  const inner = /^Bash\((.*)\)$/.exec(rule)?.[1];
  if (inner === undefined) return false;
  const pattern = inner
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${pattern}$`, "s").test(command);
}

function denied(command: string): boolean {
  return settings.permissions.deny.some((rule) => matches(rule, command));
}

describe("Claude Code deny rules", () => {
  it.each([
    "git commit --no-verify -m x",
    "git commit -n -m x",
    "git commit -anm x",
    "git push --no-verify",
    "git -c core.hooksPath=/dev/null commit -m x",
    "git config core.hooksPath .",
    "git push origin main",
    "git push -u origin main",
    "git push origin HEAD:main",
    "git push --force",
    "git push -f origin feat/x",
    "git push origin +feat/x",
  ])("stop `%s`", (command) => {
    expect(denied(command)).toBe(true);
  });

  it.each([
    'git commit -m "docs: never use --no-verify or change core.hooksPath"',
    'git commit -m "fix: handle the -n flag"',
    "git push -u origin feat/extract",
    "git config --get core.hooksPath",
  ])("let ordinary work through: `%s`", (command) => {
    expect(denied(command)).toBe(false);
  });

  it("stops an agent from merging: the maintainer squash-merges every pull request", () => {
    expect(denied("gh pr merge 3 --squash --admin")).toBe(true);
  });

  it("keeps .env.example readable while .env files and stored credentials are not", () => {
    const reads = settings.permissions.deny.filter((r) =>
      r.startsWith("Read(")
    );
    expect(reads).not.toContain("Read(./.env.*)");
    for (const rule of [
      "Read(./.env)",
      "Read(./.env.local)",
      "Read(./.env.test)",
      "Read(./.env.development)",
      "Read(./.env.production)",
      "Read(./**/credentials.json)",
      "Read(~/.config/taste-cli/**)",
    ])
      expect(reads).toContain(rule);
  });
});
