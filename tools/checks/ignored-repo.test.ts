import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { ROOT } from "./repo.ts";

// Raw recordings, private data, plans and scratch never enter Git history: each of these paths is
// ignored, and nothing under them is tracked.
const PRIVATE: readonly string[] = [
  "tmp-fixtures/extract-full.json",
  "docs/superpowers/plans/plan.md",
  ".superpowers/sdd/report.md",
  "credentials.json",
  "nested/folder/credentials.json",
  "client.json",
  "nested/folder/client.json",
  ".env",
  ".env.local",
  "nested/folder/.env",
];
const PRIVATE_TRACKED =
  /(?:^|\/)(?:tmp-fixtures\/|docs\/superpowers\/|\.superpowers\/|credentials\.json$|client\.json$|\.env(?:\.(?!example$)[^/]*)?$)/;

function isIgnored(path: string): boolean {
  try {
    // --no-index: the rules alone decide, whatever happens to be tracked.
    execFileSync("git", ["check-ignore", "-q", "--no-index", path], {
      cwd: ROOT,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

describe("private paths", () => {
  it.each(PRIVATE)("%s is ignored by Git", (path) => {
    expect(isIgnored(path)).toBe(true);
  });

  it("an example env file is not ignored", () => {
    expect(isIgnored(".env.example")).toBe(false);
  });

  it("the pattern for tracked files catches every private path", () => {
    for (const path of PRIVATE)
      expect(PRIVATE_TRACKED.test(path), path).toBe(true);
    expect(PRIVATE_TRACKED.test(".env.example")).toBe(false);
    expect(PRIVATE_TRACKED.test("src/api/fixtures/me.json")).toBe(false);
  });

  it("no tracked file lives under a private path", () => {
    const tracked = execFileSync("git", ["ls-files", "-z"], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    })
      .split("\0")
      .filter(Boolean);
    expect(tracked.filter((path) => PRIVATE_TRACKED.test(path))).toEqual([]);
  });
});
