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
    const { io } = seams();
    const { doc } = await runCli(["kit", SAMPLE, "--json"], io);
    expect(doc()).toEqual({ ok: true, data: acme });
  });

  it("returns the id at once with --no-wait", async () => {
    const { api, io } = seams();
    const { out, err } = await runCli(["kit", SAMPLE, "--no-wait"], io);
    expect(out).toBe("sub-1\n");
    expect(err).toContain("taste wait sub-1");
    expect(api.calls).toEqual(["POST /design/submissions/brand-kit"]);
  });

  it.each([
    ["notes.txt", "Just some notes.", "INVALID_FILE"],
    ["empty.pdf", "", "INVALID_FILE"],
  ])("refuses %s with %s before uploading", async (name, body, expected) => {
    const path = join(dir, name);
    writeFileSync(path, body);
    const { api, io } = seams();
    const { code, doc } = await runCli(["kit", path, "--json"], io);
    expect(code).toBe(1);
    expect(doc().error.code).toBe(expected);
    expect(api.calls).toEqual([]);
  });

  it("refuses a file that isn't there, or a folder, before uploading", async () => {
    const { api, io } = seams();
    for (const path of [join(dir, "missing.pdf"), dir]) {
      const { code, doc } = await runCli(["kit", path, "--json"], io);
      expect(code).toBe(1);
      expect(doc().error.code).toBe("FILE_NOT_FOUND");
    }
    expect(api.calls).toEqual([]);
  });

  it("refuses a file over 50 MB without reading it", async () => {
    const path = join(dir, "huge.pdf");
    writeFileSync(path, "%PDF-1.7\n");
    truncateSync(path, 50 * 1024 * 1024 + 1);
    const { api, io } = seams();
    const { code, doc } = await runCli(["kit", path, "--json"], io);
    expect(code).toBe(1);
    expect(doc().error.code).toBe("FILE_TOO_LARGE");
    expect(api.calls).toEqual([]);
  });

  it("says in --help that it spends credits", async () => {
    const { out } = await runCli(["kit", "--help"]);
    expect(out).toMatch(/spends credits/i);
  });
});
