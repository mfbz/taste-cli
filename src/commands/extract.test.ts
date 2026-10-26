import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TasteApiError } from "../api/client.ts";
import type { SubmissionCreate } from "../api/schemas.ts";
import { runCli } from "../fake-io.ts";
import { CliError } from "../output/errors.ts";
import { jobSeams, recorded } from "../job-seams.ts";

const ANSI = /\u001b\[/;
const taste = recorded("extract-full");
const PRIMARY = ["#333333", "#0000EE"];

// The fake hands out sub-1 for the first job; seed it with the recorded tastelabs.com result.
function seams(...args: Parameters<typeof jobSeams>) {
  const [state = {}, overrides = {}] = args;
  return jobSeams({ results: { "sub-1": taste }, ...state }, overrides);
}

function capturing(api: ReturnType<typeof seams>["api"]) {
  const sent: [SubmissionCreate, unknown][] = [];
  const wrapped = {
    ...api,
    createSubmission: (body: SubmissionCreate, query?: object) => {
      sent.push([body, query]);
      return api.createSubmission(body, query);
    },
  };
  return { wrapped, sent };
}

describe("taste extract", () => {
  it("starts a job, waits for it and shows the brand with every primary colour", async () => {
    const { api, io } = seams();
    const { code, out } = await runCli(
      ["extract", "https://tastelabs.com"],
      io
    );
    expect(code).toBe(0);
    expect(out).toContain("Taste");
    for (const hex of PRIMARY) expect(out).toContain(hex);
    expect(api.calls[0]).toBe("POST /design/submissions");
    expect(api.calls.at(-1)).toBe("GET /design/submissions/sub-1/result");
  });

  it("writes no ANSI when nothing is a terminal, and one note per step on stderr", async () => {
    const { io } = seams();
    const { out, err } = await runCli(["extract", "tastelabs.com"], io);
    expect(out + err).not.toMatch(ANSI);
    expect(err).not.toContain("\r");
    for (const step of ["Queued", "Crawling", "Extracting"])
      expect(err.split("\n").filter((l) => l.startsWith(step))).toHaveLength(1);
    expect(err).toContain("✓ Extracted Taste (cached)");
  });

  it("redraws one progress line in place in a terminal, then clears it", async () => {
    const { io } = seams(
      {},
      { terminal: { tty: true, width: 80, colorLevel: 3, motion: true } }
    );
    const { code, out, err } = await runCli(["extract", "tastelabs.com"], io);
    expect(code).toBe(0);
    expect(err).toContain("\r\u001b[2K");
    expect(err).toContain("⠋");
    expect(err).toContain("Crawling");
    expect(err).toMatch(/Extracted Taste/);
    expect(out).toContain("\u001b[38;2;0;0;238m██");
  });

  it("still shows every line when a terminal reports no width", async () => {
    const { io } = seams(
      {},
      { terminal: { tty: true, width: 0, colorLevel: 0, motion: false } }
    );
    const { out } = await runCli(["extract", "tastelabs.com"], io);
    expect(out).toContain("Ink Black");
    expect(out).toContain("https://www.tastelabs.com/");
  });

  it("gives --json the result exactly as Taste sent it, with nothing on stderr", async () => {
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

  it("prints the whole result as JSON with --format json", async () => {
    const { io } = seams();
    const { out } = await runCli(
      ["extract", "tastelabs.com", "--format", "json"],
      io
    );
    expect(JSON.parse(out)).toEqual(taste);
  });

  it("returns the id at once with --no-wait, and says how to pick it up", async () => {
    const { api, io } = seams();
    const human = await runCli(["extract", "stripe.com", "--no-wait"], io);
    expect(human.code).toBe(0);
    expect(human.out).toBe("sub-1\n");
    expect(human.err).toContain("taste wait sub-1");
    expect(api.calls).toEqual(["POST /design/submissions"]);
    const json = await runCli(
      ["extract", "stripe.com", "--no-wait", "--json"],
      io
    );
    expect(json.doc()).toEqual({
      ok: true,
      data: { id: "sub-2", status: "accepted" },
    });
  });

  it("sends a bare domain as https, and the options as the API names them", async () => {
    const { api, io } = seams();
    const { wrapped, sent } = capturing(api);
    await runCli(
      ["extract", "stripe.com", "--sections", "colors,typography", "--force"],
      { ...io, api: wrapped }
    );
    await runCli(
      [
        "extract",
        "stripe.com",
        "--map",
        "--max-urls",
        "5",
        "--deep",
        "--no-wait",
      ],
      { ...io, api: wrapped }
    );
    expect(sent).toEqual([
      [
        {
          url: "https://stripe.com/",
          force: true,
          sections: ["colors", "typography"],
        },
        {},
      ],
      [
        { url: "https://stripe.com/", enable_deep_analysis: true },
        { map: true, maxUrls: 5 },
      ],
    ]);
  });

  it.each([
    [["--map", "--sections", "colors"], "SELECTIVE_MAP_UNSUPPORTED"],
    [["--deep", "--sections", "colors"], "USAGE_CONFLICTING_OPTIONS"],
    [["--sections", "colours"], "USAGE_INVALID_SECTIONS"],
    [["--sections", ","], "USAGE_INVALID_SECTIONS"],
    [["--max-urls", "5"], "USAGE_NEEDS_OPTION"],
    [["--map", "--max-urls", "500"], "USAGE_INVALID_VALUE"],
    [["--format", "yaml"], "USAGE_INVALID_VALUE"],
    [["--timeout", "0"], "USAGE_INVALID_VALUE"],
  ])("refuses %j with %s before any call", async (flags, expected) => {
    const { api, io } = seams();
    const { code, doc } = await runCli(
      ["extract", "stripe.com", ...flags, "--json"],
      io
    );
    expect(code).toBe(2);
    expect(doc().error.code).toBe(expected);
    expect(api.calls).toEqual([]);
  });

  it("lists the valid section names when one is wrong", async () => {
    const { io } = seams();
    const { err } = await runCli(
      ["extract", "stripe.com", "--sections", "x"],
      io
    );
    expect(err).toContain("data_display");
    expect(err).not.toContain("--sections x");
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

  it("ends Ctrl-C during the wait with 130, one document and the way back with taste wait", async () => {
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
    const json = await runCli(["extract", "stripe.com", "--json"], io);
    expect(json.code).toBe(130);
    expect(json.out.trim().split("\n")).toHaveLength(1);
    expect(json.doc().error).toMatchObject({
      code: "INTERRUPTED",
      hint: expect.stringContaining("taste wait sub-1") as string,
      details: { id: "sub-1" },
    });
  });

  it("tells the hard stop a paid request is in flight, then the job's id", async () => {
    const seen: Readonly<Record<string, string>>[] = [];
    const { io } = seams({}, { inFlight: (params) => seen.push(params) });
    await runCli(["extract", "stripe.com", "--json"], io);
    expect(seen.slice(0, 2)).toEqual([{ paid: "yes" }, { id: "sub-1" }]);
  });

  it("clears the progress line before the interrupt is reported", async () => {
    const interrupt = new AbortController();
    const { io } = seams(
      {},
      {
        signal: interrupt.signal,
        terminal: { tty: true, width: 80, colorLevel: 0, motion: true },
        sleep: () => {
          interrupt.abort();
          return Promise.resolve();
        },
      }
    );
    const { code, err } = await runCli(["extract", "stripe.com"], io);
    expect(code).toBe(130);
    expect(err).toMatch(/\r\u001b\[2K✗ error: Interrupted\./);
    expect(err).toContain("taste wait sub-1");
  });

  it("says how to pick the job up when the wait runs out of time", async () => {
    const { io } = seams();
    const { code, doc } = await runCli(
      ["extract", "stripe.com", "--timeout", "1", "--json"],
      io
    );
    expect(code).toBe(1);
    expect(doc().error.code).toBe("WAIT_TIMEOUT");
    expect(doc().error.hint).toContain("taste wait sub-1");
  });

  it("says how to pick the job up when the network fails while waiting", async () => {
    const { io } = seams({
      errors: { getSubmission: new CliError("NETWORK") },
    });
    const { code, doc } = await runCli(["extract", "stripe.com", "--json"], io);
    expect(code).toBe(1);
    expect(doc().error.code).toBe("NETWORK");
    expect(doc().error.hint).toContain("taste wait sub-1");
    expect(doc().error.hint).not.toMatch(/try again/i);
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
    expect(doc().error.code).toBe("JOB_FAILED");
    expect(doc().error.message).toContain("The site could not be reached.");
  });

  it("reports too few credits without waiting", async () => {
    const { api, io } = seams({ balance: 0 });
    const { code, doc } = await runCli(["extract", "stripe.com", "--json"], io);
    expect(code).toBe(1);
    expect(doc().error.code).toBe("INSUFFICIENT_CREDITS");
    expect(api.calls).toEqual(["POST /design/submissions"]);
  });

  it("keeps the API's refusal of --sections with --map as a usage error", async () => {
    const { io } = seams({
      errors: {
        createSubmission: new TasteApiError(422, {
          code: "SELECTIVE_MAP_UNSUPPORTED",
        }),
      },
    });
    const { code, doc } = await runCli(["extract", "stripe.com", "--json"], io);
    expect(code).toBe(2);
    expect(doc().error.code).toBe("SELECTIVE_MAP_UNSUPPORTED");
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

  it("saves the finished extraction's files into the folder", async () => {
    const out = join(base, "stripe");
    const { api, io } = seams();
    const { code, err } = await runCli(
      ["extract", "stripe.com", "--out", out],
      io
    );
    expect(code).toBe(0);
    expect(await readFile(join(out, "guidelines.json"), "utf8")).toBe("{}");
    expect(api.calls).toContain("GET /design/submissions/sub-1/download");
    expect(err).toContain("✓ Saved 1 file to");
  });

  it("keeps the --json document the result, with the files saved", async () => {
    const out = join(base, "stripe");
    const { io } = seams();
    const { code, doc, err } = await runCli(
      ["extract", "stripe.com", "--out", out, "--json"],
      io
    );
    expect(code).toBe(0);
    expect(err).toBe("");
    expect(doc().data).toEqual(taste);
    expect(await readdir(out)).toEqual(["guidelines.json"]);
  });

  it("refuses a folder with files in it before spending anything", async () => {
    await writeFile(join(base, "old.txt"), "");
    const { api, io } = seams();
    const { code, doc } = await runCli(
      ["extract", "stripe.com", "--out", base, "--json"],
      io
    );
    expect(code).toBe(1);
    expect(doc().error.code).toBe("OUTPUT_EXISTS");
    expect(doc().error.hint).toContain("--overwrite");
    expect(api.calls).toEqual([]);
  });

  it("replaces files of the same name with --overwrite", async () => {
    await writeFile(join(base, "guidelines.json"), "old");
    const { io } = seams();
    const { code } = await runCli(
      ["extract", "stripe.com", "--out", base, "--overwrite"],
      io
    );
    expect(code).toBe(0);
    expect(await readFile(join(base, "guidelines.json"), "utf8")).toBe("{}");
  });

  it("refuses --out with --no-wait, and --overwrite without --out, before any request", async () => {
    const { api, io } = seams();
    const noWait = await runCli(
      ["extract", "stripe.com", "--out", base, "--no-wait", "--json"],
      io
    );
    expect(noWait.code).toBe(2);
    expect(noWait.doc().error.code).toBe("USAGE_CONFLICTING_OPTIONS");
    const alone = await runCli(
      ["extract", "stripe.com", "--overwrite", "--json"],
      io
    );
    expect(alone.code).toBe(2);
    expect(alone.doc().error.code).toBe("USAGE_NEEDS_OPTION");
    expect(api.calls).toEqual([]);
  });

  it("points a failed save at taste wait, never at extracting again", async () => {
    const { api, io } = seams({
      manifests: {
        "sub-1": {
          submission_id: "sub-1",
          files: [{ path: "a.css", url: "https://cdn.example.com/a.css" }],
        },
      },
    });
    api.download = () => Promise.reject(new CliError("NETWORK"));
    const { code, doc } = await runCli(
      ["extract", "stripe.com", "--out", join(base, "x"), "--json"],
      io
    );
    expect(code).toBe(1);
    expect(doc().error).toMatchObject({
      code: "BUNDLE_INCOMPLETE",
      retryable: false,
      details: { id: "sub-1" },
    });
    expect(doc().error.hint).toContain("taste wait sub-1 --out");
  });

  it("keeps the job's id when the manifest can't be saved at all", async () => {
    const { io } = seams({
      manifests: {
        "sub-1": {
          submission_id: "another-id",
          files: [{ path: "../escape", content: "x" }],
        },
      },
    });
    const { code, doc } = await runCli(
      ["extract", "stripe.com", "--out", join(base, "x"), "--json"],
      io
    );
    expect(code).toBe(1);
    expect(doc().error).toMatchObject({
      code: "BUNDLE_PATH_UNSAFE",
      retryable: false,
      details: { id: "sub-1" },
    });
    expect(doc().error.hint).toContain("taste wait sub-1 --out");
    const invalid = seams({
      manifests: {
        "sub-1": {
          submission_id: "sub-1",
          files: [{ path: "a.css", url: "https://10.0.0.1/a.css" }],
        },
      },
    });
    const second = await runCli(
      ["extract", "stripe.com", "--out", join(base, "y"), "--json"],
      invalid.io
    );
    expect(second.doc().error).toMatchObject({
      code: "BUNDLE_INVALID",
      details: { id: "sub-1" },
    });
  });

  it("keeps the job's id when the folder fills up while the job runs", async () => {
    const out = join(base, "racy");
    const { api, io } = seams();
    const racing = {
      ...api,
      getManifest: async (id: string) => {
        await mkdir(out, { recursive: true });
        await writeFile(join(out, "late.txt"), "");
        return api.getManifest(id);
      },
    };
    const { code, doc } = await runCli(
      ["extract", "stripe.com", "--out", out, "--json"],
      { ...io, api: racing }
    );
    expect(code).toBe(1);
    expect(doc().error).toMatchObject({
      code: "OUTPUT_EXISTS",
      retryable: false,
      details: { id: "sub-1" },
    });
    expect(doc().error.hint).toContain("taste wait sub-1 --out");
  });

  it("keeps the job's id when the manifest can't be read", async () => {
    const { io } = seams({
      errors: { getManifest: new TasteApiError(404, { code: "NOT_FOUND" }) },
    });
    const { doc } = await runCli(
      ["extract", "stripe.com", "--out", join(base, "z"), "--json"],
      io
    );
    expect(doc().error).toMatchObject({
      code: "SAVE_FAILED",
      retryable: false,
      details: { id: "sub-1" },
    });
  });

  it("skips an asset that is gone, warns, and lists it under --json", async () => {
    const path =
      "site-assets/media/image/showcase-image-of-syntax-engine-features.avif";
    const files = {
      "sub-1": {
        submission_id: "sub-1",
        files: [
          { path: "guidelines.json", content: "{}" },
          { path, url: "https://brand.example.com/x.avif" },
        ],
      },
    };
    const human = seams({ manifests: files });
    const out = join(base, "human");
    const run = await runCli(["extract", "stripe.com", "--out", out], human.io);
    expect(run.code).toBe(0);
    expect(run.err).toContain(
      `warning: Skipped a file whose download is gone or too large: ${path} (404)`
    );
    expect(run.err).toContain("Saved 1 file to");
    expect(run.err).toContain("skipped 1");
    expect(await readdir(out)).toEqual(["guidelines.json"]);

    const json = seams({ manifests: files });
    const doc = await runCli(
      ["extract", "stripe.com", "--out", join(base, "json"), "--json"],
      json.io
    );
    expect(doc.code).toBe(0);
    expect(doc.doc().data).toEqual({
      ...taste,
      skipped: [{ path, status: 404 }],
    });
  });

  it("names the file, not the link, when a download that may pass fails", async () => {
    const path =
      "site-assets/media/image/showcase-image-of-syntax-engine-features.avif";
    const { api, io } = seams({
      manifests: {
        "sub-1": {
          submission_id: "sub-1",
          files: [
            { path: "a.txt", content: "a" },
            { path, url: "https://cdn.example.com/x.avif?token=signed" },
          ],
        },
      },
    });
    api.download = () =>
      Promise.reject(
        new CliError("DOWNLOAD_FAILED", { file: "x.avif", status: 503 })
      );
    const { code, doc } = await runCli(
      ["extract", "stripe.com", "--out", join(base, "x"), "--json"],
      io
    );
    expect(code).toBe(1);
    expect(doc().error).toMatchObject({
      code: "BUNDLE_INCOMPLETE",
      message: `Saved 1 of 2 files and skipped 0, then ${path} couldn't be saved.`,
      details: { id: "sub-1" },
    });
    expect(JSON.stringify(doc())).not.toContain("token=signed");
  });

  it("never skips a refused signed link, which a fresh run may fix", async () => {
    const { io } = seams({
      manifests: {
        "sub-1": {
          submission_id: "sub-1",
          files: [
            { path: "a.txt", content: "a" },
            {
              path: "crawl/full.jpg",
              url: "https://cdn.example.com/full.jpg?token=signed",
            },
          ],
        },
      },
    });
    const { code, doc } = await runCli(
      ["extract", "stripe.com", "--out", join(base, "signed"), "--json"],
      io
    );
    expect(code).toBe(1);
    expect(doc().error).toMatchObject({
      code: "BUNDLE_INCOMPLETE",
      retryable: false,
      details: { id: "sub-1" },
    });
    expect(doc().error.message).toContain("crawl/full.jpg");
    expect(doc().error.hint).toContain("taste wait sub-1 --out");
    expect(JSON.stringify(doc())).not.toContain("token=signed");
  });

  it("refuses a folder others can write to before spending anything", async () => {
    if (process.platform === "win32") return;
    await chmod(base, 0o777);
    const { api, io } = seams();
    const { code, doc } = await runCli(
      ["extract", "stripe.com", "--out", base, "--json"],
      io
    );
    expect(code).toBe(1);
    expect(doc().error.code).toBe("BUNDLE_PATH_UNSAFE");
    expect(api.calls).toEqual([]);
  });

  it("keeps a sign in or credit problem under its own code, with the job's id", async () => {
    for (const [error, code] of [
      [new TasteApiError(401, {}), "INVALID_API_KEY"],
      [
        new TasteApiError(402, { balance: 0, required: 1 }),
        "INSUFFICIENT_CREDITS",
      ],
      [new CliError("NOT_SIGNED_IN"), "NOT_SIGNED_IN"],
    ] as const) {
      const { io } = seams({ errors: { getManifest: error } });
      const { doc } = await runCli(
        ["extract", "stripe.com", "--out", join(base, code), "--json"],
        io
      );
      expect(doc().error, code).toMatchObject({
        code,
        retryable: false,
        details: { id: "sub-1" },
      });
    }
  });

  it("cleans a skipped path in the warning as it would in an error", async () => {
    const key = ["taste", "live", "x".repeat(32)].join("_");
    const { io } = seams({
      manifests: {
        "sub-1": {
          submission_id: "sub-1",
          files: [
            { path: "a.txt", content: "a" },
            {
              path: `assets/${key}.png`,
              url: "https://brand.example.com/k.png",
            },
            {
              path: `assets/${"long-name-".repeat(20)}.png`,
              url: "https://brand.example.com/l.png",
            },
          ],
        },
      },
    });
    const { code, err } = await runCli(
      ["extract", "stripe.com", "--out", join(base, "clean")],
      io
    );
    expect(code).toBe(0);
    expect(err).not.toContain(key);
    expect(err).toContain("assets/… (404)");
    expect(err).not.toContain("long-name-".repeat(20));
  });
});
