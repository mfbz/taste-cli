import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { repoPath } from "./repo.ts";

// Secret-shaped samples are assembled at run time, so this file never contains one.
const TOKEN = ["gh", "p_", "k".repeat(36)].join("");
const TRAILER = ["Co-Authored", "-By: Claude <model@example.com>"].join("");

const cleanups: string[] = [];

// A throwaway repository using this repo's hooks, as `npm install` sets them up. Its folder name has
// a space, so the hooks' path quoting is exercised on every run.
function repo() {
  const base = mkdtempSync(join(tmpdir(), "taste-hooks-"));
  cleanups.push(base);
  const dir = join(base, "with space");
  mkdirSync(dir);
  const git = (...args: string[]) =>
    spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.com");
  git("config", "commit.gpgsign", "false");
  git("config", "core.hooksPath", repoPath(".githooks"));
  const commit = (files: Record<string, string>, message = "chore: test") => {
    for (const [name, text] of Object.entries(files))
      writeFileSync(join(dir, name), text);
    git("add", "-A");
    return git("commit", "-q", "-m", message);
  };
  const commits = () => Number(git("rev-list", "--count", "--all").stdout || 0);
  return { dir, git, commit, commits };
}

afterEach(() => {
  for (const dir of cleanups.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("the git hooks", { timeout: 30_000 }, () => {
  it("let a clean commit through", () => {
    const r = repo();
    expect(r.commit({ "a.md": "hello" }).status).toBe(0);
    expect(r.commits()).toBe(1);
  });

  it("stop a commit with a token in it, before it exists, without repeating the token", () => {
    const r = repo();
    const result = r.commit({ "config.ts": `export const key = "${TOKEN}";` });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("GitHub token");
    expect(result.stderr).not.toContain(TOKEN);
    expect(r.commits()).toBe(0);
  });

  it("check what is staged, not the working copy", () => {
    const r = repo();
    writeFileSync(join(r.dir, "x.ts"), TOKEN);
    r.git("add", "x.ts");
    writeFileSync(join(r.dir, "x.ts"), "clean now, but not staged");
    expect(r.git("commit", "-q", "-m", "chore: x").status).not.toBe(0);
  });

  it("stop a message that credits an AI tool as an author", () => {
    const r = repo();
    const result = r.commit({ "a.md": "hi" }, `feat: a\n\n${TRAILER}`);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("credited as an author");
    expect(r.commits()).toBe(0);
  });

  it("stop a file over 1 MB", () => {
    const r = repo();
    expect(r.commit({ "big.txt": "x".repeat(1_100_000) }).status).not.toBe(0);
  });
});
