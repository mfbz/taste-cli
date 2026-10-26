import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TasteApiError } from "../api/client.ts";
import type { SubmissionManifest } from "../api/schemas.ts";
import { runCli } from "../fake-io.ts";
import { CliError } from "../output/errors.ts";
import { jobSeams, recorded } from "../job-seams.ts";

const taste = recorded("extract-full");

// The fake hands out sub-1 for the first job; seed it with the recorded tastelabs.com result.
function seams(...args: Parameters<typeof jobSeams>) {
  const [state = {}, overrides = {}] = args;
  return jobSeams({ results: { "sub-1": taste }, ...state }, overrides);
}

function manifest(...files: SubmissionManifest["files"]) {
  return { manifests: { "sub-1": { submission_id: "sub-1", files } } };
}

describe("taste extract", () => {
  it("waits for the job and shows the brand, one plain note per step on a pipe", async () => {
    const { api, io } = seams();
    const { code, out, err } = await runCli(["extract", "tastelabs.com"], io);
    expect(code).toBe(0);
    expect(out).toContain("Taste");
    for (const hex of ["#333333", "#0000EE"]) expect(out).toContain(hex);
    expect(out + err).not.toMatch(/\u001b\[|\r/);
    expect(
      err.split("\n").filter((l) => l.startsWith("Crawling"))
    ).toHaveLength(1);
    expect(err).toContain("✓ Extracted Taste (cached)");
    expect(api.calls[0]).toBe("POST /design/submissions");
  });

  it("redraws one progress line in place in a terminal", async () => {
    const terminal = {
      tty: true,
      width: 80,
      colorLevel: 3,
      motion: true,
    } as const;
    const { io } = seams({}, { terminal });
    const { err } = await runCli(["extract", "tastelabs.com"], io);
    expect(err).toContain("\r\u001b[2K");
    expect(err).toContain("⠋");
  });

  it("gives --json the result exactly as Taste sent it, as one document", async () => {
    const { io } = seams();
    const { code, out, err, doc } = await runCli(
      ["extract", "tastelabs.com", "--json"],
      io
    );
    expect(code).toBe(0);
    expect(out.trim().split("\n")).toHaveLength(1);
    expect(doc()).toEqual({ ok: true, data: taste });
    expect(err).toBe("");
  });

  it("returns the id at once with --no-wait", async () => {
    const { api, io } = seams();
    const { out, err } = await runCli(
      ["extract", "stripe.com", "--no-wait"],
      io
    );
    expect(out).toBe("sub-1\n");
    expect(err).toContain("taste wait sub-1");
    expect(api.calls).toEqual(["POST /design/submissions"]);
  });

  it.each([
    [["--map", "--sections", "colors"], "SELECTIVE_MAP_UNSUPPORTED"],
    [["--deep", "--sections", "colors"], "USAGE_CONFLICTING_OPTIONS"],
    [["--sections", "colours"], "USAGE_INVALID_SECTIONS"],
    [["--max-urls", "5"], "USAGE_NEEDS_OPTION"],
    [["--map", "--max-urls", "500"], "USAGE_INVALID_VALUE"],
    [["--overwrite"], "USAGE_NEEDS_OPTION"],
  ])("refuses %j with %s before any request", async (flags, expected) => {
    const { api, io } = seams();
    const { code, doc } = await runCli(
      ["extract", "stripe.com", ...flags, "--json"],
      io
    );
    expect(code).toBe(2);
    expect(doc().error.code).toBe(expected);
    expect(api.calls).toEqual([]);
  });

  it.each(["localhost:3000", "http://192.168.1.4", "file:///etc/passwd"])(
    "refuses the private address %s before any credit is spent",
    async (url) => {
      const { api, io } = seams();
      const { code, doc } = await runCli(["extract", url, "--json"], io);
      expect(code).toBe(2);
      expect(doc().error.code).toBe("PRIVATE_URL");
      expect(api.calls).toEqual([]);
    }
  );

  it("ends Ctrl-C during the wait with 130 and the job to pick up", async () => {
    const interrupt = new AbortController();
    const { io } = seams(
      {},
      {
        signal: interrupt.signal,
        sleep: () => {
          interrupt.abort();
          return Promise.resolve();
        },
      }
    );
    const { code, doc } = await runCli(["extract", "stripe.com", "--json"], io);
    expect(code).toBe(130);
    expect(doc().error).toMatchObject({
      code: "INTERRUPTED",
      hint: expect.stringContaining("taste wait sub-1") as string,
      details: { id: "sub-1" },
    });
  });

  it("tells the hard stop a paid request is in flight, then the job's id", async () => {
    const seen: Readonly<Record<string, string>>[] = [];
    const { io } = seams({}, { inFlight: (params) => seen.push(params) });
    await runCli(["extract", "stripe.com", "--json"], io);
    expect(seen.slice(0, 2)).toEqual([{ paid: "job" }, { id: "sub-1" }]);
  });

  it("ends a timeout or a network failure while waiting with taste wait <id>", async () => {
    const timeout = await runCli(
      ["extract", "stripe.com", "--timeout", "1", "--json"],
      seams().io
    );
    const network = await runCli(
      ["extract", "stripe.com", "--json"],
      seams({ errors: { getSubmission: new CliError("NETWORK") } }).io
    );
    for (const run of [timeout, network]) {
      expect(run.code).toBe(1);
      expect(run.doc().error.hint).toContain("taste wait sub-1");
    }
  });

  it("reports a failed job with its own reason", async () => {
    const { api, io } = seams();
    const failing = {
      ...api,
      getSubmission: async (id: string) => ({
        ...(await api.getSubmission(id)),
        status: "failed",
        error: "The site could not be reached.",
      }),
    };
    const { code, doc } = await runCli(["extract", "stripe.com", "--json"], {
      ...io,
      api: failing,
    });
    expect(code).toBe(1);
    expect(doc().error.message).toContain("The site could not be reached.");
  });

  it("stops at a 402 without waiting", async () => {
    const { api, io } = seams({ balance: 0 });
    const { doc } = await runCli(["extract", "stripe.com", "--json"], io);
    expect(doc().error.code).toBe("INSUFFICIENT_CREDITS");
    expect(api.calls).toEqual(["POST /design/submissions"]);
  });

  it("says in --help that it spends credits", async () => {
    const { out } = await runCli(["extract", "--help"]);
    expect(out).toMatch(/spends credits/i);
  });
});

describe("taste extract --out", () => {
  let base: string;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), "taste-extract-"));
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("saves the files and keeps the --json document the result", async () => {
    const out = join(base, "stripe");
    const { code, doc } = await runCli(
      ["extract", "stripe.com", "--out", out, "--json"],
      seams().io
    );
    expect(code).toBe(0);
    expect(doc().data).toEqual(taste);
    expect(await readFile(join(out, "guidelines.json"), "utf8")).toBe("{}");
  });

  it("refuses a folder with files, or one others can write to, before spending anything", async () => {
    await writeFile(join(base, "old.txt"), "");
    const full = seams();
    const filled = await runCli(
      ["extract", "stripe.com", "--out", base, "--json"],
      full.io
    );
    expect(filled.doc().error.code).toBe("OUTPUT_EXISTS");
    expect(full.api.calls).toEqual([]);
    if (process.platform === "win32") return;
    await rm(join(base, "old.txt"));
    await chmod(base, 0o777);
    const shared = seams();
    const unsafe = await runCli(
      ["extract", "stripe.com", "--out", base, "--json"],
      shared.io
    );
    expect(unsafe.doc().error.code).toBe("BUNDLE_PATH_UNSAFE");
    expect(shared.api.calls).toEqual([]);
  });

  it("replaces files of the same name with --overwrite", async () => {
    await writeFile(join(base, "guidelines.json"), "old");
    const { code } = await runCli(
      ["extract", "stripe.com", "--out", base, "--overwrite"],
      seams().io
    );
    expect(code).toBe(0);
    expect(await readFile(join(base, "guidelines.json"), "utf8")).toBe("{}");
  });

  it("keeps the job's id and points at taste wait whatever stops the save", async () => {
    const cases = [
      [manifest({ path: "../escape", content: "x" }), "BUNDLE_PATH_UNSAFE"],
      [manifest({ path: "a", url: "https://10.0.0.1/a" }), "BUNDLE_INVALID"],
      [{ errors: { getManifest: new TasteApiError(404, {}) } }, "SAVE_FAILED"],
      [
        { errors: { getManifest: new TasteApiError(401, {}) } },
        "INVALID_API_KEY",
      ],
    ] as const;
    for (const [state, code] of cases) {
      const { doc } = await runCli(
        ["extract", "stripe.com", "--out", join(base, code), "--json"],
        seams(state).io
      );
      expect(doc().error, code).toMatchObject({
        code,
        retryable: false,
        details: { id: "sub-1" },
      });
      if (code !== "INVALID_API_KEY")
        expect(doc().error.hint).toContain("taste wait sub-1");
    }
  });

  it("skips an unsigned asset that is gone, warns, and lists it under --json", async () => {
    const files = manifest(
      { path: "guidelines.json", content: "{}" },
      { path: "logo.avif", url: "https://brand.example.com/logo.avif" }
    );
    const human = await runCli(
      ["extract", "stripe.com", "--out", join(base, "human")],
      seams(files).io
    );
    expect(human.code).toBe(0);
    expect(human.err).toContain(
      "warning: Skipped a file whose download is gone or too large: logo.avif (404)"
    );
    const json = await runCli(
      ["extract", "stripe.com", "--out", join(base, "json"), "--json"],
      seams(files).io
    );
    expect(json.doc().data).toEqual({
      ...taste,
      skipped: [{ path: "logo.avif", status: 404 }],
    });
  });

  it("stops at a refused signed link, naming the path but never the link", async () => {
    const files = manifest(
      { path: "a.txt", content: "a" },
      {
        path: "crawl/full.jpg",
        url: "https://cdn.example.com/f.jpg?token=signed",
      }
    );
    const { code, doc } = await runCli(
      ["extract", "stripe.com", "--out", join(base, "signed"), "--json"],
      seams(files).io
    );
    expect(code).toBe(1);
    expect(doc().error).toMatchObject({
      code: "BUNDLE_INCOMPLETE",
      message:
        "Saved 1 of 2 files and skipped 0, then crawl/full.jpg couldn't be saved.",
      details: { id: "sub-1" },
    });
    expect(JSON.stringify(doc())).not.toContain("token=signed");
  });
});
