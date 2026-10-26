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

  it("ends at once on a second Ctrl-C or the grace timer, with one INTERRUPTED document", () => {
    for (const stop of ["second", "timer"]) {
      const h = harness(true);
      h.interrupt.onSigint();
      const code = h.exitCode(() =>
        stop === "second"
          ? h.interrupt.onSigint()
          : h.timers.forEach((fn) => fn())
      );
      expect(code, stop).toBe(130);
      expect(h.out().trim().split("\n")).toHaveLength(1);
      expect(JSON.parse(h.out())).toMatchObject({
        ok: false,
        error: { code: "INTERRUPTED", hint: "Run the command again." },
      });
    }
  });

  it("never writes a second document once the command wrote its own, and keeps a finished command's code", () => {
    const h = harness(true);
    h.stdout('{"ok":true,"data":{}}\n');
    h.interrupt.onSigint();
    expect(h.exitCode(() => h.interrupt.onSigint())).toBe(130);
    const done = harness(true);
    done.stdout('{"ok":true,"data":{}}\n');
    done.interrupt.finish(0);
    expect(done.exitCode(() => done.interrupt.onSigint())).toBe(0);
    for (const run of [h, done])
      expect(run.out()).toBe('{"ok":true,"data":{}}\n');
  });

  it("names the job to wait on, or where to look while a paid request is in flight, never retryable", () => {
    for (const [tracked, hint] of [
      [{ id: "sub-1" }, "taste wait sub-1"],
      [{ paid: "job" }, "taste history"],
    ] as const) {
      const h = harness(true);
      h.interrupt.track(tracked);
      h.interrupt.onSigint();
      h.exitCode(() => h.interrupt.onSigint());
      const { error } = JSON.parse(h.out()) as {
        error: { hint: string; retryable: boolean };
      };
      expect(error.hint).toContain(hint);
      expect(error.retryable).toBe(false);
    }
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
});
