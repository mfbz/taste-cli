// Ctrl-C for the whole process. The first one aborts what is in flight, and the command ends through
// the usual output. A second one, or a command that hasn't stopped within the grace period, ends the
// process at once. Under --json stdout carries exactly one document, so the hard stop writes the
// INTERRUPTED document only when the command hasn't written one, and once the command has finished
// it exits with the command's own code. The hard stop's hint comes from what the command said is in
// flight (track): a job's id says taste wait, a paid request says check taste history.
import { CliError, toErrorReport } from "./output/errors.ts";
import type { Writer } from "./output/output.ts";

type Params = Readonly<Record<string, string>>;
type InterruptDeps = {
  json: boolean;
  // stdout, for the hard stop's document.
  write: Writer;
  // stderr, for the hard stop's message without --json.
  writeErr: Writer;
  // stderr is a terminal, so a progress line may be on it to clear.
  clearLine: boolean;
  exit: (code: number) => never;
  // Runs fn after the grace period, without keeping the process alive.
  later: (fn: () => void, ms: number) => void;
};
type Interrupt = {
  signal: AbortSignal;
  // Wraps the stdout writer, so the hard stop knows whether a document went out.
  watch(write: Writer): Writer;
  track(params: Params): void;
  onSigint(): void;
  finish(code: number): void;
};

// Grace for a command to stop on its own after Ctrl-C (close the sign in's port, say what to do).
const STOP_GRACE_MS = 2_000;
const CLEAR_LINE = "\r\u001b[2K";

function createInterrupt(deps: InterruptDeps): Interrupt {
  const controller = new AbortController();
  let wrote = false;
  let finished: number | undefined;
  let inFlight: Params = {};

  function hardStop(): never {
    if (finished !== undefined) deps.exit(finished);
    const { code, message, hint, retryable, details } = toErrorReport(
      new CliError("INTERRUPTED", inFlight)
    );
    if (deps.json) {
      const error = {
        code,
        message,
        hint,
        retryable,
        ...(details ? { details } : {}),
      };
      if (!wrote) deps.write(`${JSON.stringify({ ok: false, error })}\n`);
    } else {
      if (deps.clearLine) deps.writeErr(CLEAR_LINE);
      deps.writeErr(`✗ error: ${message}\n  ${hint}\n`);
    }
    return deps.exit(130);
  }

  return {
    signal: controller.signal,
    watch: (write) => (text) => {
      wrote = true;
      write(text);
    },
    track(params) {
      inFlight = params;
    },
    onSigint() {
      if (controller.signal.aborted || finished !== undefined) hardStop();
      controller.abort();
      deps.later(() => {
        if (finished === undefined) hardStop();
      }, STOP_GRACE_MS);
    },
    finish(code) {
      finished = code;
    },
  };
}

export { createInterrupt };
export type { Interrupt };
