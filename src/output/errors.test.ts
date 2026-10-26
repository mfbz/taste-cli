import { describe, expect, it } from "vitest";

import { SECTION_NAME } from "../api/schemas.ts";
import { CATALOGUE, CliError, toErrorReport, whileWaiting } from "./errors.ts";
import type { ErrorCode } from "./errors.ts";

const UUID = "0f5b2c9a-6a1e-4b0e-9f0e-1c2d3e4f5a6b";
// Built from parts at run time: the guards keep key-shaped literals out of the repo.
const SECRETS = [
  ["tas", "te_", "Ab3_d-".repeat(5)].join(""),
  ["sk", "-ant-api03-abcdef"].join(""),
  ["ey", "J", "a".repeat(20), ".", "b".repeat(20), ".", "c".repeat(20)].join(
    ""
  ),
];

const upstream = (fields: Record<string, unknown>) =>
  Object.assign(new Error("upstream words that must never show"), fields);

describe("the catalogue", () => {
  it("gives every code a message and a hint in our voice", () => {
    for (const [code, entry] of Object.entries(CATALOGUE))
      for (const text of [entry.message, entry.hint]) {
        expect(text, code).not.toBe("");
        expect(text, code).not.toMatch(/[—!]/);
      }
  });

  it("exits 2 on usage, 130 on Ctrl-C and 1 otherwise", () => {
    const expected: [ErrorCode, number][] = [
      ["USAGE_INVALID_VALUE", 2],
      ["KEY_IN_ARGV", 2],
      ["PRIVATE_URL", 2],
      ["INTERRUPTED", 130],
      ["NETWORK", 1],
      ["INTERNAL", 1],
    ];
    for (const [code, exit] of expected)
      expect(toErrorReport(new CliError(code)).exitCode, code).toBe(exit);
  });

  it("lists every section name the API knows in the sections hint", () => {
    const hint = toErrorReport(new CliError("USAGE_INVALID_SECTIONS")).hint;
    for (const name of SECTION_NAME.options) expect(hint).toContain(name);
  });
});

describe("retryable", () => {
  it("is false once the hint is taste wait <id> or the paid in-flight one", () => {
    for (const code of ["NETWORK", "TIMEOUT", "INTERRUPTED"] as const) {
      const resume = toErrorReport(new CliError(code, { id: UUID }));
      expect(resume.hint, code).toContain(`taste wait ${UUID}`);
      expect(resume.details, code).toEqual({ id: UUID });
      expect(resume.retryable, code).toBe(false);
      const paid = toErrorReport(new CliError(code, { paid: "job" }));
      expect(paid.hint, code).toContain("taste history");
      expect(paid.retryable, code).toBe(false);
    }
    expect(toErrorReport(new CliError("NETWORK")).retryable).toBe(true);
  });

  it("gives a failure while waiting on a started job its id, but leaves a missing one alone", () => {
    const report = toErrorReport(whileWaiting(upstream({ status: 500 }), "j"));
    expect(report.hint).toContain("taste wait j");
    expect(report.details).toEqual({ id: "j" });
    const notFound = new CliError("NOT_FOUND");
    expect(whileWaiting(notFound, "j")).toBe(notFound);
  });
});

describe("what an error shows", () => {
  it("never shows a key or token in an id, a job's reason, a path or a command", () => {
    for (const secret of SECRETS) {
      const reports = [
        toErrorReport(new CliError("INTERRUPTED", { id: secret })),
        toErrorReport(new CliError("JOB_FAILED", { reason: `bad ${secret}` })),
        toErrorReport(new CliError("DOWNLOAD_TOO_LARGE", { file: secret })),
        toErrorReport(
          new CliError("USAGE_UNKNOWN_COMMAND", { command: secret })
        ),
      ];
      for (const report of reports)
        expect(JSON.stringify(report)).not.toContain(secret);
      // An id that can't be shown isn't a job to pick up.
      expect(reports[0]?.hint).toBe("Run the command again.");
      expect(reports[1]?.message).toBe("The job failed: bad …");
    }
  });

  it("cleans a path of control characters and cuts it, keeping hyphens", () => {
    const message = (file: string) =>
      toErrorReport(new CliError("DOWNLOAD_TOO_LARGE", { file })).message;
    expect(message("media/syntax-engine.avif")).toContain(
      "media/syntax-engine.avif"
    );
    expect(message("a\u001b[2Jb.css")).toContain("a[2Jb.css");
    expect(message(`${"a/".repeat(100)}x.css`).length).toBeLessThan(200);
  });

  it("drops credentials and the query from an address in a hint", () => {
    const report = toErrorReport(
      new CliError("NOT_FOUND", {
        url: "https://me:secret@example.com/a?token=x#y",
      })
    );
    expect(report.hint).toBe(
      "Run taste extract https://example.com/a first. It spends credits."
    );
  });

  it("never shows the server's or an unknown error's own words", () => {
    for (const error of [
      upstream({ status: 500 }),
      new Error("upstream words that must never show"),
    ])
      expect(JSON.stringify(toErrorReport(error))).not.toContain(
        "upstream words"
      );
    expect(toErrorReport(new Error("x")).code).toBe("INTERNAL");
  });
});

describe("an error from the Taste Engine", () => {
  it("names the balance and the price on a 402", () => {
    const report = toErrorReport(
      upstream({ status: 402, balance: 0, required: 1 })
    );
    expect(report.message).toBe(
      "Not enough credits: you have 0 and this needs 1."
    );
    expect(report.retryable).toBe(false);
  });

  it("maps a 422 by Taste's own code", () => {
    const cases: [string, string][] = [
      ["FULL_EXTRACTION_REQUIRED", "FULL_EXTRACTION_REQUIRED"],
      ["INVALID_FILE_TYPE", "INVALID_FILE"],
      ["SOMETHING_NEW", "REQUEST_REJECTED"],
    ];
    for (const [code, ours] of cases)
      expect(toErrorReport(upstream({ status: 422, code })).code, code).toBe(
        ours
      );
  });
});
