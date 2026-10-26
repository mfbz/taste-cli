import { describe, expect, it } from "vitest";

import { CliError, toErrorReport } from "../output/errors.ts";
import { waitForJob } from "./poll.ts";

type Check = { done: boolean; failed?: string; step?: string; value?: string };

// A clock that only moves when the poller sleeps, so every interval is visible.
function clock() {
  let now = 0;
  const slept: number[] = [];
  return {
    now: () => now,
    slept,
    sleep: (ms: number) => {
      slept.push(ms);
      now += ms;
      return Promise.resolve();
    },
  };
}

function scripted(...checks: Check[]) {
  let index = 0;
  return () => {
    const next = checks[Math.min(index, checks.length - 1)];
    index += 1;
    if (!next) throw new Error("empty script");
    return Promise.resolve(next);
  };
}

async function caught(promise: Promise<unknown>): Promise<CliError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CliError) return error;
    throw error;
  }
  throw new Error("expected a rejection");
}

describe("waitForJob", () => {
  it("returns the value once the job is done", async () => {
    const time = clock();
    const value = await waitForJob({
      check: scripted({ done: false }, { done: true, value: "result" }),
      onStep: () => {},
      ...time,
      timeoutMs: 60_000,
      signal: new AbortController().signal,
    });
    expect(value).toBe("result");
    expect(time.slept).toEqual([1500]);
  });

  it("reports each step once, when it changes", async () => {
    const time = clock();
    const steps: [string, number][] = [];
    await waitForJob({
      check: scripted(
        { done: false, step: "crawling" },
        { done: false, step: "crawling" },
        { done: false, step: "extracting" },
        { done: false, step: "extracting" },
        { done: true, step: "completed", value: "ok" }
      ),
      onStep: (step, elapsed) => steps.push([step, elapsed]),
      ...time,
      timeoutMs: 60_000,
      signal: new AbortController().signal,
    });
    expect(steps).toEqual([
      ["crawling", 0],
      ["extracting", 3000],
      ["completed", 6000],
    ]);
  });

  it("slows down to 3 s after 30 s and to 5 s after 2 minutes", async () => {
    const time = clock();
    await caught(
      waitForJob({
        check: scripted({ done: false }),
        onStep: () => {},
        ...time,
        timeoutMs: 150_000,
        signal: new AbortController().signal,
      })
    );
    expect(time.slept.slice(0, 20)).toEqual(Array<number>(20).fill(1500));
    expect(time.slept[20]).toBe(3000);
    expect(time.slept).toContain(5000);
    expect(time.slept.indexOf(5000)).toBe(20 + 30);
  });

  it("gives up with WAIT_TIMEOUT carrying the job id", async () => {
    const time = clock();
    const error = await caught(
      waitForJob({
        check: scripted({ done: false }),
        onStep: () => {},
        ...time,
        timeoutMs: 10_000,
        signal: new AbortController().signal,
        id: "sub-1",
      })
    );
    expect(error.code).toBe("WAIT_TIMEOUT");
    expect(time.now()).toBe(10_000);
    expect(toErrorReport(error).details).toEqual({ id: "sub-1" });
  });

  it("stops with INTERRUPTED when aborted", async () => {
    const time = clock();
    const controller = new AbortController();
    let checks = 0;
    const error = await caught(
      waitForJob({
        check: () => {
          checks += 1;
          if (checks === 2) controller.abort();
          return Promise.resolve({ done: false });
        },
        onStep: () => {},
        ...time,
        timeoutMs: 60_000,
        signal: controller.signal,
        id: "sub-1",
      })
    );
    expect(error.code).toBe("INTERRUPTED");
    expect(checks).toBe(2);
    expect(toErrorReport(error).details).toEqual({ id: "sub-1" });
  });

  it("stops with INTERRUPTED during a sleep that never ends", async () => {
    const controller = new AbortController();
    const pending = waitForJob({
      check: () => Promise.resolve({ done: false }),
      onStep: () => {},
      sleep: () => new Promise<void>(() => {}),
      now: () => 0,
      timeoutMs: 60_000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 0);
    expect((await caught(pending)).code).toBe("INTERRUPTED");
  });

  it("stops with INTERRUPTED when aborted before the first check", async () => {
    const controller = new AbortController();
    controller.abort();
    let checks = 0;
    const error = await caught(
      waitForJob({
        check: () => {
          checks += 1;
          return Promise.resolve({ done: false });
        },
        onStep: () => {},
        ...clock(),
        timeoutMs: 60_000,
        signal: controller.signal,
      })
    );
    expect(error.code).toBe("INTERRUPTED");
    expect(checks).toBe(0);
  });

  it("fails with JOB_FAILED and the job's own reason", async () => {
    const error = await caught(
      waitForJob({
        check: scripted({ done: false, failed: "Site blocked the crawler" }),
        onStep: () => {},
        ...clock(),
        timeoutMs: 60_000,
        signal: new AbortController().signal,
      })
    );
    expect(error.code).toBe("JOB_FAILED");
    expect(toErrorReport(error).message).toBe(
      "The job failed: Site blocked the crawler"
    );
  });
});
