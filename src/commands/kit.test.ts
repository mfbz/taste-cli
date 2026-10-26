import {
  mkdtempSync,
  readdirSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runCli } from "../fake-io.ts";
import { readLocalFile } from "../io.ts";
import { jobSeams, recorded } from "../job-seams.ts";

const SAMPLE = fileURLToPath(
  new URL("../../fixtures-input/sample-guidelines.pdf", import.meta.url)
);
const acme = recorded("kit");

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "taste-kit-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function seams() {
  return jobSeams(
    { results: { "sub-1": acme } },
    { readFile: (path, max) => readLocalFile(path, max) }
  );
}

describe("taste kit", () => {
  it("uploads a PDF, waits for the brand kit and shows it", async () => {
    const { api, io } = seams();
    const { code, out, err } = await runCli(["kit", SAMPLE], io);
    expect(code).toBe(0);
    expect(out).toContain("ACME");
    expect(out).toContain("#D7263D");
    expect(err).toContain("✓ Extracted ACME in");
    expect(api.calls[0]).toBe("POST /design/submissions/brand-kit");
  });

  it("saves the brand kit's files with --out, and refuses a full folder before uploading", async () => {
    const out = join(dir, "acme");
    const { api, io } = seams();
    const { code } = await runCli(["kit", SAMPLE, "--out", out], io);
    expect(code).toBe(0);
    expect(readdirSync(out)).toEqual(["guidelines.json"]);
    const again = seams();
    const refused = await runCli(
      ["kit", SAMPLE, "--out", out, "--json"],
      again.io
    );
    expect(refused.doc().error.code).toBe("OUTPUT_EXISTS");
    expect(again.api.calls).toEqual([]);
    expect(api.calls).toContain("GET /design/submissions/sub-1/download");
  });

  it("gives --json the result as Taste sent it", async () => {
    const { doc } = await runCli(["kit", SAMPLE, "--json"], seams().io);
    expect(doc()).toEqual({ ok: true, data: acme });
  });

  it("refuses a .txt, an empty file, a missing path, a folder and a file over 50 MB before uploading", async () => {
    writeFileSync(join(dir, "notes.txt"), "Just some notes.");
    writeFileSync(join(dir, "empty.pdf"), "");
    writeFileSync(join(dir, "huge.pdf"), "%PDF-1.7\n");
    truncateSync(join(dir, "huge.pdf"), 50 * 1024 * 1024 + 1);
    const { api, io } = seams();
    for (const [name, code] of [
      ["notes.txt", "INVALID_FILE"],
      ["empty.pdf", "INVALID_FILE"],
      ["missing.pdf", "FILE_NOT_FOUND"],
      ["", "FILE_NOT_FOUND"],
      ["huge.pdf", "FILE_TOO_LARGE"],
    ] as const) {
      const run = await runCli(["kit", join(dir, name), "--json"], io);
      expect(run.code, name).toBe(1);
      expect(run.doc().error.code, name).toBe(code);
    }
    expect(api.calls).toEqual([]);
  });

  it("says in --help that it spends credits", async () => {
    const { out } = await runCli(["kit", "--help"]);
    expect(out).toMatch(/spends credits/i);
  });
});
