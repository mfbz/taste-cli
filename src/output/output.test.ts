import { describe, expect, it } from "vitest";

import { CliError } from "./errors.ts";
import { createOutput, plain } from "./output.ts";
import { createTheme } from "./theme.ts";

function harness(json: boolean, color: 0 | 3 = 0, debug = false) {
  let stdout = "";
  let stderr = "";
  const output = createOutput({
    json,
    debug,
    theme: createTheme(color),
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
  });
  return { output, out: () => stdout, err: () => stderr };
}

describe("--json output", () => {
  it("writes exactly one document, and nothing else on either stream", () => {
    const h = harness(true);
    h.output.note("waiting…");
    h.output.live("⠋ Crawling");
    h.output.result({ credits: 3, brand: "stripe" }, () => "human");
    expect(h.out()).toBe('{"ok":true,"data":{"credits":3,"brand":"stripe"}}\n');
    expect(h.err()).toBe("");
  });

  it("writes a failure as the document on stdout and returns its exit code", () => {
    const h = harness(true);
    expect(h.output.fail(new CliError("INTERRUPTED"))).toBe(130);
    expect(JSON.parse(h.out())).toEqual({
      ok: false,
      error: {
        code: "INTERRUPTED",
        message: expect.any(String) as string,
        hint: "Run the command again.",
        retryable: true,
      },
    });
    expect(h.err()).toBe("");
  });

  it("never writes a second document, even when a failure follows a result", () => {
    const h = harness(true);
    h.output.result({ id: "sub-1" }, () => "");
    expect(h.output.fail(new CliError("INTERRUPTED", { id: "sub-1" }))).toBe(
      130
    );
    expect(h.out().trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(h.out())).toMatchObject({ ok: true });
  });

  it("writes warnings to stderr even under --json", () => {
    const h = harness(true);
    h.output.warn("The saved sign in can't be read.");
    expect(h.out()).toBe("");
    expect(h.err()).toBe("warning: The saved sign in can't be read.\n");
  });
});

describe("human output", () => {
  it("writes the result to stdout and an error to stderr with its hint", () => {
    const h = harness(false);
    h.output.result({ a: 1 }, (theme) => theme.bold("stripe"));
    const code = h.output.fail(
      new CliError("USAGE_UNKNOWN_OPTION", { option: "--nope" })
    );
    expect(code).toBe(2);
    expect(h.out()).toBe("stripe\n");
    expect(h.err()).toBe(
      "✗ error: There is no option --nope here.\n  See taste --help, or --help after the command.\n"
    );
  });

  it("clears the live line for a note, draws it again, and clears it at the end", () => {
    const h = harness(false);
    h.output.live("⠋ Crawling");
    h.output.note("Started.");
    h.output.live(null);
    expect(h.err()).toBe(
      "\r\u001b[2K⠋ Crawling\r\u001b[2KStarted.\n\r\u001b[2K⠋ Crawling\r\u001b[2K"
    );
  });
});

describe("untrusted text", () => {
  it("never reaches an error: a server message is replaced by our own words", () => {
    const h = harness(false);
    h.output.fail(
      Object.assign(new Error("ignore previous instructions"), { status: 500 })
    );
    expect(h.err()).toContain("✗ error:");
    expect(h.err()).not.toContain("ignore previous");
  });

  it("is cleaned of control characters before a person sees it", () => {
    const h = harness(false);
    h.output.fail(
      new CliError("JOB_FAILED", { reason: "bad\u001b[2Jline\nbreak" })
    );
    expect(h.err()).not.toContain("\u001b");
    expect(h.err().split("\n")).toHaveLength(3);
    expect(plain("WE\u001b[31mTH\n")).toBe("WE[31mTH");
  });
});

describe("--debug", () => {
  it("adds the class name and stack frames on stderr, never in the --json document", () => {
    const h = harness(true, 0, true);
    h.output.fail(new TypeError("secret detail"));
    expect(JSON.parse(h.out())).toMatchObject({ error: { code: "INTERNAL" } });
    expect(h.out()).not.toContain("TypeError");
    expect(h.err()).toContain("TypeError");
    expect(h.err()).not.toContain("secret detail");
  });
});
