import { describe, expect, it } from "vitest";

import { CliError, toErrorReport } from "../output/errors.ts";
import { jobCheck, waitForJob } from "./poll.ts";
import type { Check, WaitOptions } from "./poll.ts";

// A clock that only moves when the poller sleeps, so every interval is visible.
function wait(
  check: () => Promise<Check<string>>,
  options: Partial<WaitOptions<string>> = {}
) {
  let now = 0;
  const slept: number[] = [];
  const steps: string[] = [];
  const done = waitForJob<string>({
    check,
    onStep: (step) => steps.push(step),
    now: () => now,
    sleep: (ms) => {
      slept.push(ms);
      now += ms;
      return Promise.resolve();
    },
    timeoutMs: 60_000,
    signal: new AbortController().signal,
    id: "sub-1",
    ...options,
  });
  return { done, slept, steps };
}

function statuses(...list: string[]) {
  let index = 0;
  return () => {
    const status = list[Math.min(index, list.length - 1)] ?? "completed";
    index += 1;
    return Promise.resolve(jobCheck({ status }, "result"));
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
  it("polls through every status, a new one included, reporting each once, until completed", async () => {
    const run = wait(statuses("queued", "queued", "verifying", "completed"));
    expect(await run.done).toBe("result");
    expect(run.steps).toEqual(["queued", "verifying", "completed"]);
    expect(run.slept).toEqual([1500, 1500, 1500]);
  });

  it("slows down to 3 s after 30 s and to 5 s after 2 minutes, then times out with the id", async () => {
    const run = wait(statuses("crawling"), { timeoutMs: 150_000 });
    const error = await caught(run.done);
    expect(error.code).toBe("WAIT_TIMEOUT");
    expect(toErrorReport(error).details).toEqual({ id: "sub-1" });
    expect(run.slept.indexOf(3000)).toBe(20);
    expect(run.slept.indexOf(5000)).toBe(50);
  });

  it("fails with JOB_FAILED and the job's own reason", async () => {
    const error = await caught(
      wait(() =>
        Promise.resolve(jobCheck({ status: "failed", error: "Site blocked" }))
      ).done
    );
    expect(toErrorReport(error)).toMatchObject({
      code: "JOB_FAILED",
      message: "The job failed: Site blocked",
      details: { id: "sub-1" },
    });
  });

  it("stops with INTERRUPTED and the id at once, even while sleep hangs", async () => {
    const controller = new AbortController();
    const run = wait(() => Promise.resolve({ done: false }), {
      sleep: () => new Promise<void>(() => {}),
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 0);
    const error = await caught(run.done);
    expect(error.code).toBe("INTERRUPTED");
    expect(toErrorReport(error).details).toEqual({ id: "sub-1" });
  });
});
