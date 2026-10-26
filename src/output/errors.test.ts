import { describe, expect, it } from "vitest";

import { INDUSTRY, PAGE_TYPE, SECTION_NAME } from "../api/schemas.ts";
import {
  CATALOGUE,
  CliError,
  isUpstreamError,
  toErrorReport,
  whileWaiting,
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
      INVALID_ENV: [2, false],
      NOT_SIGNED_IN: [1, false],
      CREDENTIALS_STORE_FAILED: [1, false],
      INSUFFICIENT_CREDITS: [1, false],
      SEARCH_BUSY: [1, true],
      UPSTREAM: [1, true],
      NETWORK: [1, true],
      TIMEOUT: [1, true],
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

  it("says a paid request that failed in flight may have run, and is not to be retried blindly", () => {
    for (const code of ["NETWORK", "TIMEOUT", "INTERRUPTED"] as const) {
      const report = toErrorReport(new CliError(code, { paid: "job" }));
      expect(report.hint, code).toContain("taste history");
      expect(report.retryable, code).toBe(false);
    }
    expect(toErrorReport(new CliError("NETWORK")).hint).not.toContain(
      "taste history"
    );
  });

  it("gives a failure while waiting on a started job its id, and the way back with taste wait", () => {
    const upstream500 = Object.assign(new Error("boom"), { status: 500 });
    for (const error of [new CliError("NETWORK"), upstream500]) {
      const report = toErrorReport(whileWaiting(error, "sub-1"));
      expect(report.hint).toContain("taste wait sub-1");
      expect(report.details).toEqual({ id: "sub-1" });
    }
    const notFound = new CliError("NOT_FOUND");
    expect(whileWaiting(notFound, "sub-1")).toBe(notFound);
  });

  it("is never retryable once the hint is taste wait or the paid one", () => {
    for (const code of [
      "NETWORK",
      "TIMEOUT",
      "UPSTREAM",
      "RATE_LIMITED",
      "INTERRUPTED",
      "WAIT_TIMEOUT",
    ] as const) {
      const resume = toErrorReport(new CliError(code, { id: "sub-1" }));
      expect(resume.hint, code).toContain("taste wait sub-1");
      expect(resume.retryable, code).toBe(false);
    }
    for (const code of ["NETWORK", "TIMEOUT", "INTERRUPTED"] as const)
      expect(
        toErrorReport(new CliError(code, { paid: "job" })).retryable,
        code
      ).toBe(false);
    expect(toErrorReport(new CliError("NETWORK")).retryable).toBe(true);
  });

  it("lists every section name the API knows in the sections hint", () => {
    const hint = toErrorReport(new CliError("USAGE_INVALID_SECTIONS")).hint;
    for (const name of SECTION_NAME.options) expect(hint).toContain(name);
  });

  it("lists every page type the API knows, and a few industries, in their hints", () => {
    const pageTypes = toErrorReport(
      new CliError("USAGE_INVALID_PAGE_TYPE")
    ).hint;
    for (const name of PAGE_TYPE.options) expect(pageTypes).toContain(name);
    const industries = toErrorReport(
      new CliError("USAGE_INVALID_INDUSTRY")
    ).hint;
    const listed = /^Such as (.+?)\. /.exec(industries)?.[1] ?? "";
    const named = listed.split(/, | or /);
    expect(named.length).toBeGreaterThanOrEqual(4);
    for (const name of named)
      expect(INDUSTRY.safeParse(name).success, name).toBe(true);
    expect(industries).toContain("taste search --help");
  });

  it("names the address to extract when a brand given by address has no usable extraction", () => {
    const missing = toErrorReport(
      new CliError("NOT_FOUND", { url: "https://stripe.com/" })
    );
    expect(missing.code).toBe("NOT_FOUND");
    expect(missing.hint).toContain("taste extract https://stripe.com/");
    expect(missing.retryable).toBe(false);
    const selective = toErrorReport(
      new CliError("FULL_EXTRACTION_REQUIRED", { url: "https://linear.app/" })
    );
    expect(selective.hint).toContain("taste extract https://linear.app/");
    expect(selective.hint).toContain("--sections");
    // An address too long, with a query or credentials, still gives a usable one.
    const long = `https://example.com/${"a".repeat(30)}/${"b".repeat(30)}/${"c".repeat(30)}`;
    expect(
      toErrorReport(new CliError("NOT_FOUND", { url: long })).hint
    ).toContain("taste extract https://example.com/aaa");
    const odd = toErrorReport(
      new CliError("NOT_FOUND", {
        url: "https://me:secret@example.com/a?token=x#y",
      })
    );
    expect(odd.hint).toBe(
      "Run taste extract https://example.com/a first. It spends credits."
    );
    const cut = toErrorReport(
      new CliError("NOT_FOUND", {
        url: `https://example.com/${"d".repeat(300)}`,
      })
    ).hint;
    expect(cut.length).toBeLessThan(200);
    // Without an address, the id's own words.
    expect(toErrorReport(new CliError("NOT_FOUND")).hint).toContain(
      "taste history"
    );
  });

  it("names the real --sections and --map flags when they can't be combined", () => {
    const hint = toErrorReport(new CliError("SELECTIVE_MAP_UNSUPPORTED")).hint;
    expect(hint).toContain("--sections");
    expect(hint).toContain("--map");
  });

  it("tells how to resume after a timeout, with the id", () => {
    const report = toErrorReport(new CliError("WAIT_TIMEOUT", { id: "sub_2" }));
    expect(report.hint).toContain("taste wait sub_2");
  });

  it("names the file and status of a failed download", () => {
    const report = toErrorReport(
      new CliError("DOWNLOAD_FAILED", { file: "logo.png", status: 403 })
    );
    expect(report.message).toBe("Couldn't download logo.png (403).");
    expect(report.retryable).toBe(true);
  });

  it("replaces a parameter that is not safe to show", () => {
    const keys = [
      ["tas", "te_", "Ab3_d-".repeat(5)].join(""),
      ["sk", "-ant-api03-abc"].join(""),
      ["ey", "J", "a".repeat(20)].join(""),
      "line\nbreak",
    ];
    for (const id of keys) {
      const report = toErrorReport(new CliError("WAIT_TIMEOUT", { id }));
      expect(report.hint).not.toContain(id);
      expect(report.hint).toContain("taste wait …");
      // An id that can't be shown isn't a job to pick up, so the interrupt says to run it again.
      expect(toErrorReport(new CliError("INTERRUPTED", { id })).hint).toBe(
        "Run the command again."
      );
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

const UUID = "0f5b2c9a-6a1e-4b0e-9f0e-1c2d3e4f5a6b";

describe("a job id", () => {
  it("shows a UUID in the hint and in details for INTERRUPTED and WAIT_TIMEOUT", () => {
    for (const code of ["INTERRUPTED", "WAIT_TIMEOUT"] as const) {
      const report = toErrorReport(new CliError(code, { id: UUID }));
      expect(report.hint).toContain(`taste wait ${UUID}`);
      expect(report.details).toEqual({ id: UUID });
    }
  });

  it("puts a failed job's id in details", () => {
    const report = toErrorReport(
      new CliError("JOB_FAILED", { id: UUID, reason: "blocked" })
    );
    expect(report.details).toEqual({ id: UUID });
    expect(report.message).toBe("The job failed: blocked");
  });

  it("leaves details out when there is no usable id or the code has none", () => {
    expect(toErrorReport(new CliError("INTERRUPTED")).details).toBeUndefined();
    expect(
      toErrorReport(new CliError("NOT_FOUND", { id: UUID })).details
    ).toBeUndefined();
  });

  it("never shows a key-shaped id", () => {
    const id = ["tas", "te_", "Ab3_d-".repeat(5)].join("");
    const report = toErrorReport(new CliError("INTERRUPTED", { id }));
    expect(report.details).toBeUndefined();
    expect(JSON.stringify(report)).not.toContain(id);
  });
});

describe("a failed job's reason", () => {
  const reason = (text: string) =>
    toErrorReport(new CliError("JOB_FAILED", { reason: text })).message;

  it("keeps hyphenated words and UUIDs", () => {
    expect(reason("disk-full")).toContain("disk-full");
    expect(reason(`job ${UUID} lost`)).toContain(UUID);
  });

  it("redacts only the key-shaped token", () => {
    const keys = [
      ["tas", "te_", "Ab3_d-".repeat(5)].join(""),
      ["sk", "-ant-api03-abcdef"].join(""),
      [
        "ey",
        "J",
        "a".repeat(20),
        ".",
        "b".repeat(20),
        ".",
        "c".repeat(20),
      ].join(""),
    ];
    for (const key of keys) {
      const shown = reason(`bad ${key} here`);
      expect(shown).not.toContain(key);
      expect(shown).toContain("bad … here");
    }
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
      [{ status: 422, code: "SOMETHING_NEW" }, "REQUEST_REJECTED"],
      [{ status: 424 }, "ADHERENCE_FAILED"],
      [{ status: 409 }, "UPSTREAM"],
      [{ status: 429 }, "RATE_LIMITED"],
      [
        { status: 422, code: "SELECTIVE_MAP_UNSUPPORTED" },
        "SELECTIVE_MAP_UNSUPPORTED",
      ],
      [{ status: 400 }, "REQUEST_REJECTED"],
      [{ status: 502 }, "UPSTREAM"],
      [{ status: 500 }, "UPSTREAM"],
      [{ status: 503 }, "SEARCH_BUSY"],
      [{ status: 418 }, "REQUEST_REJECTED"],
      [{ status: 302 }, "INTERNAL"],
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

describe("a file path from a download manifest", () => {
  const message = (file: string) =>
    toErrorReport(new CliError("DOWNLOAD_TOO_LARGE", { file })).message;

  it("is shown, even when it is long and hyphenated", () => {
    const path =
      "site-assets/media/image/showcase-image-of-syntax-engine-features.avif";
    expect(message(path)).toContain(path);
  });

  it("is cleaned of control characters and cut to a sane length", () => {
    expect(message("a\u001b[2Jb.css")).toContain("a[2Jb.css");
    const long = `${"a/".repeat(100)}x.css`;
    const shown = message(long);
    expect(shown).toContain("…");
    expect(shown.length).toBeLessThan(200);
  });

  it("never carries a URL, a query or a key-shaped token", () => {
    const key = ["taste", "live", "x".repeat(32)].join("_");
    expect(message("https://cdn.example.com/a.png")).not.toContain("cdn");
    expect(message("a.png?token=signed")).not.toContain("signed");
    expect(message(`assets/${key}.png`)).not.toContain(key);
  });
});
