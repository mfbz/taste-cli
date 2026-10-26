import { describe, expect, it } from "vitest";

import {
  CATALOGUE,
  CliError,
  isUpstreamError,
  toErrorReport,
} from "./errors.ts";
import type { ErrorCode } from "./errors.ts";

const upstream = (fields: Record<string, unknown>) =>
  Object.assign(new Error("upstream words that must never show"), fields);

describe("the catalogue", () => {
  it("gives every code a message and a hint in our voice", () => {
    for (const [code, entry] of Object.entries(CATALOGUE)) {
      for (const text of [entry.message, entry.hint]) {
        expect(text, code).not.toBe("");
        expect(text, code).not.toMatch(/[—!]/);
      }
    }
  });

  it("uses the documented exit code and retryability", () => {
    const expected: Record<string, [number, boolean]> = {
      USAGE_INVALID_VALUE: [2, false],
      KEY_IN_ARGV: [2, false],
      INVALID_URL: [2, false],
      PRIVATE_URL: [2, false],
      NOT_SIGNED_IN: [1, false],
      INSUFFICIENT_CREDITS: [1, false],
      SEARCH_BUSY: [1, true],
      UPSTREAM: [1, true],
      NETWORK: [1, true],
      WAIT_TIMEOUT: [1, true],
      INTERRUPTED: [130, true],
      INTERNAL: [1, false],
    };
    for (const [code, [exit, retryable]] of Object.entries(expected)) {
      const entry = CATALOGUE[code as ErrorCode];
      expect([entry.exit, entry.retryable], code).toEqual([exit, retryable]);
    }
  });

  it("points a signed-out person at taste login", () => {
    expect(toErrorReport(new CliError("NOT_SIGNED_IN")).hint).toContain(
      "taste login"
    );
  });
});

describe("CliError", () => {
  it("keeps its parameters out of its own message", () => {
    const error = new CliError("USAGE_UNKNOWN_OPTION", { option: "--nope" });
    expect(error.message).not.toContain("--nope");
  });

  it("fills parameters into the report", () => {
    const report = toErrorReport(
      new CliError("USAGE_UNKNOWN_COMMAND", { command: "nope" })
    );
    expect(report.message).toBe("There is no command nope.");
    expect(report.exitCode).toBe(2);
  });

  it("tells how to resume after an interrupt, with the id", () => {
    const report = toErrorReport(new CliError("INTERRUPTED", { id: "sub_1" }));
    expect(report.exitCode).toBe(130);
    expect(report.hint).toContain("taste wait sub_1");
  });

  it("tells how to resume after a timeout, with the id", () => {
    const report = toErrorReport(new CliError("WAIT_TIMEOUT", { id: "sub_2" }));
    expect(report.hint).toContain("taste wait sub_2");
  });

  it("replaces a parameter that is not safe to show", () => {
    const keys = [
      ["tas", "te_", "Ab3_d-".repeat(5)].join(""),
      ["sk", "-ant-api03-abc"].join(""),
      ["ey", "J", "a".repeat(20)].join(""),
      "line\nbreak",
    ];
    for (const id of keys) {
      const report = toErrorReport(new CliError("INTERRUPTED", { id }));
      expect(report.hint).not.toContain(id);
      expect(report.hint).toContain("taste wait …");
    }
  });

  it("only echoes a command or option that looks like one", () => {
    const key = ["sk", "-ant-api03-abc"].join("");
    expect(
      toErrorReport(new CliError("USAGE_UNKNOWN_COMMAND", { command: key }))
        .message
    ).toBe("There is no command ….");
  });

  it("shows a job's error as text, shortened and never key-shaped", () => {
    const shown = toErrorReport(
      new CliError("JOB_FAILED", {
        reason: "The page did not load (HTTP 500).",
      })
    ).message;
    expect(shown).toContain("The page did not load (HTTP 500).");
    const long = toErrorReport(
      new CliError("JOB_FAILED", { reason: "x ".repeat(200) })
    ).message;
    expect(long.length).toBeLessThan(250);
    const key = ["tas", "te_", "Ab3_d-".repeat(5)].join("");
    expect(
      toErrorReport(new CliError("JOB_FAILED", { reason: key })).message
    ).not.toContain(key);
  });

  it("accepts numbers as parameters", () => {
    const report = toErrorReport(
      new CliError("INSUFFICIENT_CREDITS", { balance: 0, required: 1 })
    );
    expect(report.message).toContain("0");
    expect(report.message).toContain("1");
  });
});

describe("an error from the Taste Engine", () => {
  it("is recognised by its shape", () => {
    expect(isUpstreamError(upstream({ status: 402 }))).toBe(true);
    expect(isUpstreamError(new Error("x"))).toBe(false);
    expect(isUpstreamError(new CliError("INTERNAL"))).toBe(false);
    expect(isUpstreamError({ status: 402 })).toBe(false);
    expect(isUpstreamError(upstream({ status: "402" }))).toBe(false);
  });

  it("names the balance and the price on a 402", () => {
    const report = toErrorReport(
      upstream({
        status: 402,
        code: "INSUFFICIENT_CREDITS",
        balance: 0,
        required: 1,
      })
    );
    expect(report.code).toBe("INSUFFICIENT_CREDITS");
    expect(report.message).toBe(
      "Not enough credits: you have 0 and this needs 1."
    );
    expect(report.retryable).toBe(false);
  });

  it("says unknown when a 402 carries no figures", () => {
    const report = toErrorReport(upstream({ status: 402 }));
    expect(report.code).toBe("INSUFFICIENT_CREDITS");
    expect(report.message).not.toContain("undefined");
  });

  it("maps each status to its code", () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ status: 401 }, "INVALID_API_KEY"],
      [{ status: 403 }, "FORBIDDEN"],
      [{ status: 404 }, "NOT_FOUND"],
      [{ status: 413 }, "FILE_TOO_LARGE"],
      [
        { status: 422, code: "FULL_EXTRACTION_REQUIRED" },
        "FULL_EXTRACTION_REQUIRED",
      ],
      [{ status: 422, code: "INVALID_FILE_TYPE" }, "INVALID_FILE"],
      [{ status: 422, code: "EMPTY_FILE" }, "INVALID_FILE"],
      [{ status: 422, code: "SOMETHING_NEW" }, "INTERNAL"],
      [{ status: 424 }, "ADHERENCE_FAILED"],
      [{ status: 429 }, "UPSTREAM"],
      [{ status: 502 }, "UPSTREAM"],
      [{ status: 500 }, "UPSTREAM"],
      [{ status: 503 }, "SEARCH_BUSY"],
      [{ status: 418 }, "INTERNAL"],
    ];
    for (const [fields, code] of cases)
      expect(toErrorReport(upstream(fields)).code, JSON.stringify(fields)).toBe(
        code
      );
  });

  it("never shows the server's own words", () => {
    const report = toErrorReport(upstream({ status: 500 }));
    expect(`${report.message} ${report.hint}`).not.toContain("upstream words");
  });

  it("carries no debug details for our own errors, only for the rest", () => {
    expect(toErrorReport(new CliError("INTERNAL")).debug).toBeUndefined();
    expect(toErrorReport(new TypeError("x")).debug?.className).toBe(
      "TypeError"
    );
  });
});

describe("anything else", () => {
  it("is INTERNAL and never shows its message", () => {
    const report = toErrorReport(new Error("secret detail"));
    expect(report.code).toBe("INTERNAL");
    expect(JSON.stringify(report)).not.toContain("secret detail");
  });
});
