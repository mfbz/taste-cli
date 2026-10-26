import { describe, expect, it } from "vitest";

import pkg from "../package.json" with { type: "json" };
import { run } from "./cli.ts";
import type { Io } from "./cli.ts";

type Doc = {
  ok: boolean;
  data: Record<string, unknown>;
  error: { code: string; message: string; hint: string; retryable: boolean };
};

async function capture(argv: string[]) {
  let out = "";
  let err = "";
  const io: Io = {
    stdout: (text) => (out += text),
    stderr: (text) => (err += text),
  };
  const code = await run(argv, io);
  return { code, out, err, doc: () => JSON.parse(out) as Doc };
}

describe("taste", () => {
  it("prints the version", async () => {
    for (const flag of ["--version", "-v"]) {
      const { code, out } = await capture([flag]);
      expect(code).toBe(0);
      expect(out).toBe(`${pkg.version}\n`);
    }
    expect(pkg.version).toBe("0.0.0");
  });

  it("prints help that says it is unofficial", async () => {
    const { code, out } = await capture(["--help"]);
    expect(code).toBe(0);
    expect(out).toContain("Usage: taste");
    expect(out).toContain("unofficial");
    expect(out).toContain("not affiliated with Taste Labs");
    for (const flag of ["--json", "--debug", "--version", "--help"])
      expect(out).toContain(flag);
  });

  it("prints help when run without a command", async () => {
    const { code, out } = await capture([]);
    expect(code).toBe(0);
    expect(out).toContain("Usage: taste");
  });

  it("rejects an unknown option with exit 2 on stderr, naming the option but never its value", async () => {
    const { code, out, err } = await capture(["--nope=s3cr3tvalue"]);
    expect(code).toBe(2);
    expect(out).toBe("");
    expect(err).toContain("--nope");
    expect(err).not.toContain("s3cr3tvalue");
  });

  it("rejects an unknown command with exit 2", async () => {
    const { code, err } = await capture(["nope"]);
    expect(code).toBe(2);
    expect(err).toContain("nope");
  });

  it("answers a usage error with one JSON document under --json", async () => {
    const { code, out, err, doc } = await capture(["--json", "--nope"]);
    expect(code).toBe(2);
    expect(err).toBe("");
    expect(out.trim().split("\n")).toHaveLength(1);
    expect(doc()).toMatchObject({
      ok: false,
      error: { code: "USAGE_UNKNOWN_OPTION", retryable: false },
    });
  });

  it("answers --version and --help with one JSON document under --json", async () => {
    expect((await capture(["--json", "--version"])).doc()).toEqual({
      ok: true,
      data: { version: pkg.version },
    });
    for (const argv of [["--json", "--help"], ["--json"]]) {
      const { code, doc } = await capture(argv);
      expect(code).toBe(0);
      expect(String(doc().data.help)).toContain("unofficial");
    }
  });
});
