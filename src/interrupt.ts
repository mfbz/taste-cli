// Ctrl-C for the whole process. The first one aborts what is in flight, and the command ends through
// the usual output. A second one, or a command that hasn't stopped within the grace period, ends the
// process at once. Under --json stdout carries exactly one document, so the hard stop writes the
// INTERRUPTED document only when the command hasn't written one, and once the command has finished
// it exits with the command's own code.
import { CliError, toErrorReport } from "./output/errors.ts";
import type { Writer } from "./output/output.ts";

type InterruptDeps = {
  json: boolean;
  // stdout, for the hard stop's document.
  write: Writer;
  exit: (code: number) => never;
  // Runs fn after the grace period, without keeping the process alive.
  later: (fn: () => void, ms: number) => void;
};
type Interrupt = {
  signal: AbortSignal;
  // Wraps the stdout writer, so the hard stop knows whether a document went out.
  watch(write: Writer): Writer;
  onSigint(): void;
  finish(code: number): void;
};

// Grace for a command to stop on its own after Ctrl-C (close the sign in's port, say what to do).
const STOP_GRACE_MS = 2_000;

function createInterrupt(deps: InterruptDeps): Interrupt {
  const controller = new AbortController();
  let wrote = false;
  let finished: number | undefined;

  function hardStop(): never {
    if (finished !== undefined) deps.exit(finished);
    if (deps.json && !wrote) {
      const { code, message, hint, retryable } = toErrorReport(
        new CliError("INTERRUPTED")
      );
      const error = { code, message, hint, retryable };
      deps.write(`${JSON.stringify({ ok: false, error })}\n`);
    }
    return deps.exit(130);
  }

  return {
    signal: controller.signal,
    watch: (write) => (text) => {
      wrote = true;
      write(text);
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
