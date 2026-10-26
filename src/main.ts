#!/usr/bin/env node
import { run } from "./cli.ts";
import { processIo } from "./io.ts";
import { CliError, toErrorReport } from "./output/errors.ts";
import type { ColorLevel, TerminalInfo } from "./output/terminal.ts";
import { detectTerminal } from "./output/terminal.ts";

// A reader that stops early (`taste --help | head -1`) is a normal pipeline, not a crash.
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") process.exit(process.exitCode ?? 0);
    throw error;
  });
}

// Grace for a command to stop on its own after Ctrl-C (close the sign in's port, say what to do).
const STOP_GRACE_MS = 2_000;
const interrupt = new AbortController();
let finished = false;

// The hard stop: one document under --json, then the conventional code for an interrupt.
function exitInterrupted(): never {
  if (process.argv.slice(2).includes("--json")) {
    const { code, message, hint, retryable } = toErrorReport(
      new CliError("INTERRUPTED")
    );
    const error = { code, message, hint, retryable };
    process.stdout.write(`${JSON.stringify({ ok: false, error })}\n`);
  }
  process.exit(130);
}

// Ctrl-C aborts what is in flight, and the command ends with INTERRUPTED through the usual output. A
// second Ctrl-C, or a command that doesn't stop in time, ends the process at once. Prompts handle
// Ctrl-C themselves.
process.on("SIGINT", () => {
  if (interrupt.signal.aborted) exitInterrupted();
  interrupt.abort();
  setTimeout(() => {
    if (!finished) exitInterrupted();
  }, STOP_GRACE_MS).unref();
});

// Results go to stdout and failures to stderr, so colour needs both to be a terminal.
const [out, err] = [process.stdout, process.stderr].map((stream) =>
  detectTerminal(stream, process.env, { motion: true })
) as [TerminalInfo, TerminalInfo];

process.exitCode = await run(
  process.argv.slice(2),
  processIo(
    {
      terminal: {
        ...out,
        colorLevel: Math.min(out.colorLevel, err.colorLevel) as ColorLevel,
        motion: out.motion && err.motion,
      },
      stdout: (text) => process.stdout.write(text),
      stderr: (text) => process.stderr.write(text),
    },
    interrupt.signal
  )
);
finished = true;
