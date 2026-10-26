// Which credential a command sends: TASTE_API_KEY first, then what taste login stored. A browser
// session is refreshed shortly before it ends, and once more if the API still answers 401. The store
// is opened only when a command first needs it, so a key from the environment never touches the
// keychain.
import type { AuthProvider } from "../api/client.ts";
import type { Env } from "../config/env.ts";
import { CliError, isUpstreamError } from "../output/errors.ts";
import type { Session } from "./oauth.ts";
import type { SecretStore, StoredCredential } from "./store.ts";

type Method = "env-key" | "key" | "session";
type Identity = {
  method: Method;
  email: string | null;
  store: SecretStore["name"] | null;
};
type ProviderDeps = {
  env: Env;
  store: () => Promise<SecretStore>;
  refresh: (session: Session) => Promise<Session>;
  now: () => number;
  signal?: AbortSignal;
};
type Credential = StoredCredential | { kind: "env-key"; apiKey: string };
type Loaded = { credential: Credential | null; store: SecretStore | null };
type Provider = AuthProvider & {
  // null: nothing to sign in with. Never contains the key or a token.
  describe(): Promise<Identity | null>;
  // A final 401 means "sign in again" for a session and "that key is wrong" for a key.
  explain(error: unknown): unknown;
};

// Refreshed this long before it ends, so a token never expires between the check and the request.
const REFRESH_MARGIN_MS = 60_000;
// The sign in service refused the refresh: only a new sign in helps. A network failure is kept as
// it is, because the session may still be good.
const ENDED = new Set(["SESSION_EXPIRED", "LOGIN_FAILED"]);

function createAuthProvider(deps: ProviderDeps): Provider {
  let loaded: Loaded | undefined;
  let loading: Promise<Loaded> | undefined;
  let refreshedOnce = false;

  async function load(): Promise<Loaded> {
    if (deps.env.apiKey)
      return {
        credential: { kind: "env-key", apiKey: deps.env.apiKey },
        store: null,
      };
    loading ??= (async () => {
      const store = await deps.store();
      return { credential: await store.read(), store };
    })();
    loaded = await loading;
    return loaded;
  }

  async function credential(): Promise<Credential> {
    const { credential } = await load();
    if (!credential) throw new CliError("NOT_SIGNED_IN");
    return credential;
  }

  async function refresh(session: Session): Promise<Session> {
    try {
      const next = await deps.refresh(session);
      loaded = { credential: next, store: loaded?.store ?? null };
      loading = Promise.resolve(loaded);
      return next;
    } catch (error) {
      if (deps.signal?.aborted)
        throw new CliError("INTERRUPTED", {}, { cause: error });
      if (error instanceof CliError && ENDED.has(error.code))
        throw new CliError("SESSION_EXPIRED", {}, { cause: error });
      throw error;
    }
  }

  return {
    async header(): Promise<Record<string, string>> {
      let current = await credential();
      if (
        current.kind === "session" &&
        current.expiresAt - deps.now() < REFRESH_MARGIN_MS
      )
        current = await refresh(current);
      return current.kind === "session"
        ? { authorization: `Bearer ${current.accessToken}` }
        : { "x-api-key": current.apiKey };
    },

    async onUnauthorized() {
      const current = await credential();
      if (current.kind !== "session" || refreshedOnce) return false;
      refreshedOnce = true;
      await refresh(current);
      return true;
    },

    async describe() {
      const { credential, store } = await load();
      if (!credential) return null;
      return {
        method: credential.kind,
        email: credential.kind === "session" ? credential.email : null,
        store: store?.name ?? null,
      };
    },

    explain(error) {
      if (
        isUpstreamError(error) &&
        error.status === 401 &&
        loaded?.credential?.kind === "session"
      )
        return new CliError("SESSION_EXPIRED", {}, { cause: error });
      return error;
    },
  };
}

export { createAuthProvider };
export type { Identity, Method, Provider };
