#!/usr/bin/env node
import { run } from "./cli.ts";
import { processIo } from "./io.ts";
import { createInterrupt } from "./interrupt.ts";
import type { ColorLevel, TerminalInfo } from "./output/terminal.ts";
import { detectTerminal } from "./output/terminal.ts";

// A reader that stops early (`taste --help | head -1`) is a normal pipeline, not a crash.
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") process.exit(process.exitCode ?? 0);
    throw error;
  });
}

// Ctrl-C aborts the command's signal (a wait, a request, a prompt); see interrupt.ts for the hard stop.
const interrupt = createInterrupt({
  json: process.argv.slice(2).includes("--json"),
  write: (text) => process.stdout.write(text),
  writeErr: (text) => process.stderr.write(text),
  clearLine: process.stderr.isTTY === true,
  exit: (code) => process.exit(code),
  later: (fn, ms) => setTimeout(fn, ms).unref(),
});
process.on("SIGINT", () => interrupt.onSigint());

// Results go to stdout and failures to stderr, so colour needs both to be a terminal.
const [out, err] = [process.stdout, process.stderr].map((stream) =>
  detectTerminal(stream, process.env, { motion: true })
) as [TerminalInfo, TerminalInfo];

const io = processIo(
  {
    terminal: {
      ...out,
      colorLevel: Math.min(out.colorLevel, err.colorLevel) as ColorLevel,
      motion: out.motion && err.motion,
    },
    stdout: interrupt.watch((text) => process.stdout.write(text)),
    stderr: (text) => process.stderr.write(text),
  },
  interrupt.signal
);
const exitCode = await run(process.argv.slice(2), {
  ...io,
  inFlight: (params) => interrupt.track(params),
});
interrupt.finish(exitCode);
process.exitCode = exitCode;
