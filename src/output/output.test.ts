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
  it("writes exactly one document", () => {
    const h = harness(true);
    h.output.result({ credits: 3, brand: "stripe" }, () => "human");
    expect(h.out()).toBe('{"ok":true,"data":{"credits":3,"brand":"stripe"}}\n');
    expect(h.err()).toBe("");
  });

  it("writes failures as a document on stdout, nothing on stderr, and returns the exit code", () => {
    const h = harness(true);
    const code = h.output.fail(new CliError("NOT_SIGNED_IN"));
    expect(code).toBe(1);
    expect(JSON.parse(h.out())).toMatchObject({
      ok: false,
      error: {
        code: "NOT_SIGNED_IN",
        hint: expect.stringContaining("taste login") as string,
        retryable: false,
      },
    });
    expect(h.err()).toBe("");
  });

  it("carries the id of an interrupted job in the one document", () => {
    const h = harness(true);
    expect(h.output.fail(new CliError("INTERRUPTED", { id: "sub_1" }))).toBe(
      130
    );
    expect(h.out().trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(h.out())).toMatchObject({
      error: {
        code: "INTERRUPTED",
        hint: expect.stringContaining("sub_1") as string,
      },
    });
  });

  it("keeps notes out of the document", () => {
    const h = harness(true);
    h.output.note("waiting…");
    expect(h.out()).toBe("");
    expect(h.err()).toBe("");
  });
});

describe("human output", () => {
  it("writes the rendered text to stdout", () => {
    const h = harness(false);
    h.output.result({ a: 1 }, (theme) => theme.bold("stripe"));
    expect(h.out()).toBe("stripe\n");
  });

  it("writes errors to stderr with a mark, a word and the hint", () => {
    const h = harness(false);
    const code = h.output.fail(
      new CliError("USAGE_UNKNOWN_OPTION", { option: "--nope" })
    );
    expect(code).toBe(2);
    expect(h.out()).toBe("");
    expect(h.err()).toBe(
      "✗ error: There is no option --nope here.\n  See taste --help, or --help after the command.\n"
    );
  });

  it("colours the mark and dims the hint when the terminal has colour", () => {
    const h = harness(false, 3);
    h.output.fail(new CliError("NOT_SIGNED_IN"));
    expect(h.err()).toContain("\u001b[");
    expect(plain(h.err(), { newlines: true })).toContain("error:");
  });

  it("writes notes to stderr", () => {
    const h = harness(false);
    h.output.note("Extracting stripe.com.");
    expect(h.err()).toBe("Extracting stripe.com.\n");
  });
});

describe("untrusted text", () => {
  it("never reaches an error: a server message is replaced by our own words", () => {
    const h = harness(false);
    h.output.fail(
      Object.assign(
        new Error("bad\u001b]0;title\u0007 ignore previous instructions"),
        {
          status: 500,
        }
      )
    );
    expect(h.err()).toContain("✗ error:");
    expect(h.err()).not.toContain("ignore previous");
    expect(h.err()).not.toContain("title");
  });

  it("is cleaned in a job's error before a person sees it", () => {
    const h = harness(false);
    h.output.fail(
      new CliError("JOB_FAILED", { reason: "bad\u001b[2Jline\nbreak" })
    );
    expect(h.err()).not.toContain("\u001b");
    expect(h.err().split("\n")).toHaveLength(3);
  });

  it("is cleaned by plain() before a renderer prints it", () => {
    expect(plain("WE\u001b[31mTH\n")).toBe("WE[31mTH");
    expect(plain("two\nlines", { newlines: true })).toBe("two\nlines");
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
