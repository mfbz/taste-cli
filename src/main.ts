#!/usr/bin/env node
import { run } from "./cli.ts";
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

// Ctrl-C: stop with the conventional code for an interrupt. Prompts handle Ctrl-C themselves.
process.once("SIGINT", () => {
  // --json promises one document, an interrupt included.
  if (process.argv.slice(2).includes("--json")) {
    const { code, message, hint, retryable } = toErrorReport(
      new CliError("INTERRUPTED")
    );
    const error = { code, message, hint, retryable };
    process.stdout.write(`${JSON.stringify({ ok: false, error })}\n`);
  }
  process.exit(130);
});

// Results go to stdout and failures to stderr, so colour needs both to be a terminal.
const [out, err] = [process.stdout, process.stderr].map((stream) =>
  detectTerminal(stream, process.env, { motion: true })
) as [TerminalInfo, TerminalInfo];

process.exitCode = await run(process.argv.slice(2), {
  terminal: {
    ...out,
    colorLevel: Math.min(out.colorLevel, err.colorLevel) as ColorLevel,
    motion: out.motion && err.motion,
  },
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
});
