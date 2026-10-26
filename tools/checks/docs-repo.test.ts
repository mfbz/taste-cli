import { lstatSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { run } from "../../src/cli.ts";
import { isBinary } from "./guards.ts";
import { committableFiles, readRepoFile, repoPath } from "./repo.ts";

const UNOFFICIAL = "unofficial";
const NOT_AFFILIATED = "not affiliated with Taste Labs";
// Assembled at run time, so this file doesn't match itself. The repo is a standalone tool: nothing in
// it says why it was built.
const OFF_LIMITS = new RegExp(
  [String.raw`\bhir(?:e|ing)\b`, ["job", "application"].join(" ")].join("|"),
  "i"
);

async function helpText(): Promise<string> {
  let out = "";
  await run(["--help"], { stdout: (t) => (out += t), stderr: () => {} });
  return out;
}

describe("public docs", () => {
  it.each(["README.md", "NOTICE.md", "TASTE-CLI.md"])(
    "%s says this is unofficial and not affiliated with Taste Labs",
    (file) => {
      const text = readRepoFile(file);
      expect(text).toContain(UNOFFICIAL);
      expect(text).toContain(NOT_AFFILIATED);
    }
  );

  it("the --help footer says so too", async () => {
    const help = await helpText();
    expect(help).toContain(UNOFFICIAL);
    expect(help).toContain(NOT_AFFILIATED);
  });

  it.each(["TASTE-CLI.md", "AGENTS.md"])(
    "%s states the one --json output contract",
    (file) => {
      expect(readRepoFile(file)).toMatch(
        /exactly one JSON document on stdout, errors included/
      );
    }
  );

  it("AGENTS.md carries the credit rule", () => {
    expect(readRepoFile("AGENTS.md")).toContain(
      "every paid call is approved by the maintainer first and logged in the PR"
    );
  });

  it("no committable file says why the tool exists", () => {
    const found = committableFiles().filter((path) => {
      if (!lstatSync(repoPath(path)).isFile()) return false;
      const bytes = readFileSync(repoPath(path));
      return !isBinary(bytes) && OFF_LIMITS.test(bytes.toString("utf8"));
    });
    expect(found).toEqual([]);
  });
});
