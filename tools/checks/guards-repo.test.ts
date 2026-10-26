import { lstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  BIG_ON_PURPOSE,
  MAX_FILE_BYTES,
  findAttribution,
  findHomePath,
  findSecrets,
  isBinary,
} from "./guards.ts";
import { committableFiles, repoPath } from "./repo.ts";

function textFiles(): Array<[string, string]> {
  return committableFiles()
    .filter((path) => lstatSync(repoPath(path)).isFile())
    .map((path): [string, Buffer] => [path, readFileSync(repoPath(path))])
    .filter(([, bytes]) => !isBinary(bytes))
    .map(([path, bytes]) => [path, bytes.toString("utf8")]);
}

// The same guards as the Git hooks, on every file Git would commit: a skipped hook is still caught.
describe("guards on everything that would be committed", () => {
  const files = textFiles();
  const home = homedir();

  it("holds no keys, seed phrases or tokens (keys live in encrypted wallets outside the repo)", () => {
    const found = files.flatMap(([path, text]) =>
      findSecrets(text).map((f) => `${path}: ${f.rule} (${f.match})`)
    );
    expect(found).toEqual([]);
  });

  it("never contains this computer's home folder (a public repo shouldn't carry anyone's username)", () => {
    const found = files
      .filter(([, text]) => findHomePath(text, home).length > 0)
      .map(([path]) => path);
    expect(found).toEqual([]);
  });

  it("never credits an AI tool as an author (AGENTS.md, Git)", () => {
    const found = files.flatMap(([path, text]) =>
      findAttribution(text).map((f) => `${path}: ${f.match}`)
    );
    expect(found).toEqual([]);
  });

  it(`has no file over ${MAX_FILE_BYTES / 1024 / 1024} MB (build output and recordings stay out of Git)`, () => {
    const big = committableFiles()
      .filter((path) => !BIG_ON_PURPOSE.has(path))
      .filter((path) => {
        const stat = lstatSync(repoPath(path));
        return stat.isFile() && stat.size > MAX_FILE_BYTES;
      });
    expect(big).toEqual([]);
  });
});
