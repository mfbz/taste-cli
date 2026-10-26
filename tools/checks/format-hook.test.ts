import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { repoPath } from "./repo.ts";

const HOOK = repoPath(".claude", "hooks", "format-edited-file.mjs");
const UNFORMATTED = '{"a":1,\n"b":2}';
const FORMATTED = '{ "a": 1, "b": 2 }\n';

const cleanups: string[] = [];

function runHook(filePath: string, projectDir: string): number | null {
  return spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_input: { file_path: filePath } }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
  }).status;
}

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "taste-hook-"));
  cleanups.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of cleanups.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

// The hook's input comes from the agent's tool call, so it is treated as untrusted.
describe("the format-edited-file hook", () => {
  it("formats a file inside the project, even with shell characters in its name", () => {
    const project = tempDir();
    const file = join(project, "a&b;$(x).json");
    writeFileSync(file, UNFORMATTED);
    expect(runHook(file, project)).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(FORMATTED);
  });

  it("leaves files outside the project untouched", () => {
    const project = tempDir();
    const outside = join(tempDir(), "outside.json");
    writeFileSync(outside, UNFORMATTED);
    expect(runHook(outside, project)).toBe(0);
    expect(readFileSync(outside, "utf8")).toBe(UNFORMATTED);
  });

  it("treats a relative path that looks like an option as a file, not a flag", () => {
    const project = tempDir();
    const file = join(project, "--config=evil.json");
    writeFileSync(file, UNFORMATTED);
    expect(runHook("--config=evil.json", project)).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(FORMATTED);
  });
});
