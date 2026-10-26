// Waits for a Taste job by asking `check` until it is done, failed, out of time or interrupted. Polls
// fast at first, when most jobs finish, then backs off so a long job doesn't hammer the API.
import { CliError } from "../output/errors.ts";

type Check<T> = {
  done: boolean;
  // The job's own reason; shown shortened and with key-shaped text redacted (output/errors.ts).
  failed?: string;
  step?: string;
  value?: T;
};
type WaitOptions<T> = {
  check: () => Promise<Check<T>>;
  onStep: (step: string, elapsedMs: number) => void;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  timeoutMs: number;
  signal: AbortSignal;
  // The job's id, so a timeout or Ctrl-C can say how to pick it up with taste wait.
  id?: string;
};

const FAST_MS = 1500;
const MEDIUM_MS = 3000;
const SLOW_MS = 5000;
const MEDIUM_AFTER_MS = 30_000;
const SLOW_AFTER_MS = 120_000;

function intervalMs(elapsedMs: number): number {
  if (elapsedMs < MEDIUM_AFTER_MS) return FAST_MS;
  if (elapsedMs < SLOW_AFTER_MS) return MEDIUM_MS;
  return SLOW_MS;
}

// Resolves with the promise, or rejects with INTERRUPTED as soon as the signal aborts, so Ctrl-C never
// waits for a slow request or a long sleep to end.
function unlessAborted<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  params: Record<string, string>
): Promise<T> {
  const interrupted = () => new CliError("INTERRUPTED", params);
  if (signal.aborted) return Promise.reject(interrupted());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(interrupted());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

async function waitForJob<T>(options: WaitOptions<T>): Promise<T> {
  const { check, onStep, sleep, now, timeoutMs, signal } = options;
  const params: Record<string, string> =
    options.id === undefined ? {} : { id: options.id };
  const started = now();
  let lastStep: string | undefined;
  for (;;) {
    if (signal.aborted) throw new CliError("INTERRUPTED", params);
    const state = await unlessAborted(check(), signal, params);
    const elapsed = now() - started;
    if (state.step !== undefined && state.step !== lastStep) {
      lastStep = state.step;
      onStep(state.step, elapsed);
    }
    if (state.failed !== undefined)
      throw new CliError("JOB_FAILED", { reason: state.failed });
    if (state.done) return state.value as T;
    if (elapsed >= timeoutMs) throw new CliError("WAIT_TIMEOUT", params);
    await unlessAborted(
      sleep(Math.min(intervalMs(elapsed), timeoutMs - elapsed)),
      signal,
      params
    );
  }
}

export { waitForJob };
export type { Check, WaitOptions };
