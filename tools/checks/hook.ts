// The Git hooks (.githooks/): the same guards as `npm test`, run on what is being committed, before it
// exists in any commit. pre-commit checks the staged content (not the working copy); commit-msg
// checks the message. Usage: hook.ts pre-commit | hook.ts commit-msg <message file>
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

import { checkFile, checkMessage } from "./guards.ts";

function git(args: string[]): Buffer {
  return execFileSync("git", args, { maxBuffer: 256 * 1024 * 1024 });
}

function stagedProblems(): string[] {
  const staged = git([
    "diff",
    "--cached",
    "--name-only",
    "-z",
    "--diff-filter=ACMR",
  ])
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  return staged.flatMap((path) =>
    checkFile(path, git(["show", `:${path}`]), homedir())
  );
}

const [mode, file] = process.argv.slice(2);
const problems =
  mode === "commit-msg" && file
    ? checkMessage(readFileSync(file, "utf8"))
    : mode === "pre-commit"
      ? stagedProblems()
      : [`unknown hook "${mode ?? ""}"`];
if (problems.length > 0) {
  process.stderr.write(
    [
      "taste-cli guards stopped this commit:",
      ...problems.map((p) => `  - ${p}`),
      "Fix the cause (CONTRIBUTING.md, Guards). A key or token that was ever pushed is burnt: revoke it with its provider.",
      "",
    ].join("\n")
  );
  process.exit(1);
}
