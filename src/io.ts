// Everything taste touches outside itself, as one object: run(argv, io) gets it, so tests drive every
// command in-process with fakes. processIo() is the real wiring, used only by main.ts. The keychain's
// native module and the prompt library load only when a command first needs them, so `taste
// --version` starts without either.
import { homedir } from "node:os";
import { addAbortSignal } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";

import { openBrowser } from "./auth/browser.ts";
import { openStore } from "./auth/store.ts";
import type { SecretStore } from "./auth/store.ts";
import { configDir } from "./config/paths.ts";
import { CliError } from "./output/errors.ts";
import type { Writer } from "./output/output.ts";
import type { TerminalInfo } from "./output/terminal.ts";

type Io = {
  stdout: Writer;
  stderr: Writer;
  // Absent means plain text and no motion, which is what tests and pipes get.
  terminal?: TerminalInfo;
  // The environment taste reads its settings from. Absent: none, so tests never see the real one.
  env?: Readonly<Record<string, string | undefined>>;
  // stdin and stderr are both a terminal, so a person can answer a prompt and follow a sign in.
  interactive?: boolean;
  fetch?: typeof globalThis.fetch;
  openBrowser?: (url: string) => Promise<void>;
  // Opens the credential store; warn shows its one-line warnings.
  store?: (warn: (line: string) => void) => Promise<SecretStore>;
  configDir?: string;
  now?: () => number;
  // Rejects or returns early once signal aborts.
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  // All of stdin, to the end.
  stdinText?: () => Promise<string>;
  // A hidden prompt on stderr; null when the person cancels it.
  askSecret?: (message: string) => Promise<string | null>;
  // Aborted by Ctrl-C.
  signal?: AbortSignal;
};

// A key is a few hundred bytes at most; anything far bigger isn't one, and isn't read whole.
const MAX_STDIN_BYTES = 64 * 1024;

async function readStdin(signal: AbortSignal): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    // Ctrl-C ends a read that would otherwise wait for an end of input that never comes.
    for await (const chunk of addAbortSignal(
      signal,
      process.stdin
    ) as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > MAX_STDIN_BYTES) throw new CliError("INVALID_KEY_INPUT");
      chunks.push(chunk);
    }
  } catch (error) {
    if (signal.aborted) throw new CliError("INTERRUPTED", {}, { cause: error });
    throw error;
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function askSecret(
  message: string,
  signal: AbortSignal
): Promise<string | null> {
  const { isCancel, password } = await import("@clack/prompts");
  const answer = await password({
    message,
    output: process.stderr,
    signal,
  });
  return isCancel(answer) ? null : answer;
}

function processIo(
  base: Pick<Io, "stdout" | "stderr" | "terminal">,
  signal: AbortSignal
): Io {
  const dir = configDir(process.env, homedir(), process.platform);
  return {
    ...base,
    env: process.env,
    interactive: process.stdin.isTTY === true && process.stderr.isTTY === true,
    fetch: globalThis.fetch,
    openBrowser: (url) => openBrowser(url),
    store: (warn) => openStore({ dir, warn }),
    configDir: dir,
    now: Date.now,
    sleep: (ms, sleepSignal) =>
      delay(ms, undefined, sleepSignal ? { signal: sleepSignal } : {}),
    stdinText: () => readStdin(signal),
    askSecret: (message) => askSecret(message, signal),
    signal,
  };
}

export { processIo };
export type { Io };
