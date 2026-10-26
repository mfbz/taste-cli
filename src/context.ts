// What a command works with, built from Io for one run: the output, the settings, the credential
// store and the auth provider (each opened once, on first use), and a Taste API client. A command
// never reaches past this to the process.
import { createTasteApi } from "./api/client.ts";
import type { AuthProvider, TasteApi } from "./api/client.ts";
import { loginWithBrowser, refreshSession } from "./auth/oauth.ts";
import type { Session } from "./auth/oauth.ts";
import { createAuthProvider } from "./auth/provider.ts";
import type { Provider } from "./auth/provider.ts";
import type { SecretStore } from "./auth/store.ts";
import { DEFAULT_API_URL, readEnv } from "./config/env.ts";
import type { Env } from "./config/env.ts";
import type { Io, Prompter } from "./io.ts";
import { CliError } from "./output/errors.ts";
import type { Output, Writer } from "./output/output.ts";
import type { TerminalInfo } from "./output/terminal.ts";

type Context = {
  output: Output;
  env: Env;
  // The Taste Engine's address: TASTE_API_URL, or Taste's own.
  apiUrl: string;
  interactive: boolean;
  // Absent: plain text, no motion, 80 columns.
  terminal: TerminalInfo | undefined;
  // Progress may redraw itself: a terminal that allows motion, and TASTE_NO_MOTION unset.
  motion: boolean;
  now: () => number;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  // Aborted by Ctrl-C; a fresh, never aborted one when the wiring has none.
  signal: AbortSignal;
  readFile: (path: string, maxBytes: number) => Promise<Uint8Array>;
  // Tells the hard stop what a Ctrl-C would leave behind: a paid request in flight, or a job's id.
  inFlight: (params: Readonly<Record<string, string>>) => void;
  store(): Promise<SecretStore>;
  auth: Provider;
  // The signed in client by default; login passes a key it is about to check.
  api(auth?: AuthProvider): TasteApi;
  loginWithBrowser(): Promise<Session>;
  stdinText(): Promise<string>;
  askSecret(message: string): Promise<string | null>;
  prompter(): Prompter;
  // Resolves on the next key; never, where there is no keyboard to read.
  keypress(signal: AbortSignal): Promise<void>;
  // stderr as it is, for the opening's frames and cursor.
  screen: Writer;
};

// Shown by every sign in command while the environment holds a key.
const ENV_KEY_NOTE =
  "TASTE_API_KEY is set: taste uses it instead of any saved sign in.";

// A seam the wiring left out is a bug in taste, never the person's.
function need<T>(value: T | undefined): T {
  if (value === undefined) throw new CliError("INTERNAL");
  return value;
}

function createContext(io: Io, output: Output): Context {
  const env = readEnv(io.env ?? {});
  const apiUrl = env.apiUrl ?? DEFAULT_API_URL;
  const now = io.now ?? Date.now;
  const signal = io.signal;
  const sleep = (ms: number, s?: AbortSignal) =>
    need(io.sleep)(ms, s ?? signal);
  let opening: Promise<SecretStore> | undefined;
  const store = () => (opening ??= need(io.store)((line) => output.warn(line)));
  const refreshDeps = () => ({
    fetch: need(io.fetch),
    dir: need(io.configDir),
    now,
    signal,
    sleep: (ms: number) => sleep(ms),
  });

  const auth = createAuthProvider({
    env,
    store,
    refresh: async (session) =>
      refreshSession({ ...refreshDeps(), store: await store() }, session),
    now,
    signal,
  });

  return {
    output,
    env,
    apiUrl,
    interactive: io.interactive ?? false,
    terminal: io.terminal,
    motion: (io.terminal?.motion ?? false) && !env.noMotion,
    now,
    sleep,
    signal: signal ?? new AbortController().signal,
    readFile: (path, maxBytes) => need(io.readFile)(path, maxBytes),
    inFlight: (params) => io.inFlight?.(params),
    store,
    auth,
    api: (provider) =>
      (provider === undefined ? io.api : undefined) ??
      createTasteApi({
        fetch: need(io.fetch),
        baseUrl: apiUrl,
        auth: provider ?? auth,
        sleep,
        signal,
      }),
    async loginWithBrowser() {
      return loginWithBrowser({
        fetch: need(io.fetch),
        openBrowser: need(io.openBrowser),
        note: (line) => output.note(line),
        store: await store(),
        dir: need(io.configDir),
        now,
        signal: signal ?? new AbortController().signal,
        apiUrl,
      });
    },
    stdinText: () => need(io.stdinText)(),
    askSecret: (message) => need(io.askSecret)(message),
    prompter: () => need(io.prompter),
    keypress: (s) => io.keypress?.(s) ?? new Promise(() => {}),
    screen: io.stderr,
  };
}

export { createContext, ENV_KEY_NOTE };
export type { Context };
