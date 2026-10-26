import { describe, expect, it } from "vitest";

import { TasteApiError } from "../api/client.ts";
import type { SubmissionCreate } from "../api/schemas.ts";
import { runCli } from "../fake-io.ts";
import { CliError } from "../output/errors.ts";
import { jobSeams, recorded } from "./job-seams.ts";

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
