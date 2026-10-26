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
import type { Io } from "./io.ts";
import { CliError } from "./output/errors.ts";
import type { Output } from "./output/output.ts";

type Context = {
  output: Output;
  env: Env;
  interactive: boolean;
  store(): Promise<SecretStore>;
  auth: Provider;
  // The signed in client by default; login passes a key it is about to check.
  api(auth?: AuthProvider): TasteApi;
  loginWithBrowser(): Promise<Session>;
  stdinText(): Promise<string>;
  askSecret(message: string): Promise<string | null>;
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
  const store = () => (opening ??= need(io.store)((line) => output.note(line)));
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
    interactive: io.interactive ?? false,
    store,
    auth,
    api: (provider = auth) =>
      createTasteApi({
        fetch: need(io.fetch),
        baseUrl: apiUrl,
        auth: provider,
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
  };
}

export { createContext, ENV_KEY_NOTE };
export type { Context };
