import { describe, expect, it } from "vitest";

import { createInterrupt } from "./interrupt.ts";

class Exit extends Error {
  readonly code: number;

  constructor(code: number) {
    super(`exit ${code}`);
    this.code = code;
  }
}

function harness(json: boolean, clearLine = false) {
  let written = "";
  let errors = "";
  const timers: (() => void)[] = [];
  const interrupt = createInterrupt({
    json,
    write: (text) => (written += text),
    writeErr: (text) => (errors += text),
    clearLine,
    exit: (code) => {
      throw new Exit(code);
    },
    later: (fn) => timers.push(fn),
  });
  const stdout = interrupt.watch((text) => (written += text));
  const exitCode = (fn: () => void) => {
    try {
      fn();
    } catch (error) {
      if (error instanceof Exit) return error.code;
      throw error;
    }
    return undefined;
  };
  return {
    interrupt,
    stdout,
    timers,
    exitCode,
    out: () => written,
    err: () => errors,
  };
}

describe("Ctrl-C", () => {
  it("aborts what is in flight first, and lets the command end on its own", () => {
    const h = harness(true);
    expect(h.exitCode(() => h.interrupt.onSigint())).toBeUndefined();
    expect(h.interrupt.signal.aborted).toBe(true);
    h.interrupt.finish(130);
    expect(h.exitCode(() => h.timers.forEach((fn) => fn()))).toBeUndefined();
    expect(h.out()).toBe("");
  });

  it("ends at once on a second Ctrl-C, with one INTERRUPTED document", () => {
    const h = harness(true);
    h.interrupt.onSigint();
    expect(h.exitCode(() => h.interrupt.onSigint())).toBe(130);
    expect(h.out().trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(h.out())).toMatchObject({
      ok: false,
      error: { code: "INTERRUPTED" },
    });
  });

  it("ends a command that hasn't stopped by the grace timer", () => {
    const h = harness(true);
    h.interrupt.onSigint();
    expect(h.exitCode(() => h.timers.forEach((fn) => fn()))).toBe(130);
    expect(JSON.parse(h.out())).toMatchObject({ ok: false });
  });

  it("never writes a second document once the command wrote its own", () => {
    const h = harness(true);
    h.stdout('{"ok":true,"data":{}}\n');
    h.interrupt.onSigint();
    expect(h.exitCode(() => h.interrupt.onSigint())).toBe(130);
    expect(h.out()).toBe('{"ok":true,"data":{}}\n');
  });

  it("exits with the command's own code when Ctrl-C comes after it finished", () => {
    const h = harness(true);
    h.stdout('{"ok":true,"data":{}}\n');
    h.interrupt.finish(0);
    expect(h.exitCode(() => h.interrupt.onSigint())).toBe(0);
    expect(h.out()).toBe('{"ok":true,"data":{}}\n');
  });

  it("writes no document without --json, and clears the progress line before its message", () => {
    const h = harness(false, true);
    h.interrupt.track({ id: "sub-1" });
    h.interrupt.onSigint();
    expect(h.exitCode(() => h.interrupt.onSigint())).toBe(130);
    expect(h.out()).toBe("");
    expect(h.err()).toBe(
      "\r\u001b[2K✗ error: Interrupted.\n  The job carries on. Run taste wait sub-1 to pick it up.\n"
    );
  });

  it("names the job to wait on when one was started", () => {
    const h = harness(true);
    h.interrupt.track({ id: "sub-1" });
    h.interrupt.onSigint();
    h.exitCode(() => h.interrupt.onSigint());
    expect(JSON.parse(h.out())).toMatchObject({
      error: {
        hint: expect.stringContaining("taste wait sub-1") as string,
        retryable: false,
        details: { id: "sub-1" },
      },
    });
  });

  it("never invites a rerun while a paid request is in flight", () => {
    const h = harness(true);
    h.interrupt.track({ paid: "job" });
    h.interrupt.onSigint();
    h.exitCode(() => h.timers.forEach((fn) => fn()));
    const { error } = JSON.parse(h.out()) as {
      error: { hint: string; retryable: boolean };
    };
    expect(error.hint).toContain("taste history");
    expect(error.hint).not.toMatch(/^Run the command again/);
    expect(error.retryable).toBe(false);
  });
});
