// Browser sign in (OAuth 2.1 authorization code with PKCE and a loopback redirect) and the refresh of
// a session it leaves behind. Nothing here prints: what a person should see goes through note(), and
// no token ever goes into a note, an error or a thrown message.
import { createHash, randomBytes } from "node:crypto";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { z } from "zod";

import { createTasteApi } from "../api/client.ts";
import { DEFAULT_API_URL } from "../config/env.ts";
import { CliError } from "../output/errors.ts";
import { discover } from "./discovery.ts";
import type { OAuthEndpoints } from "./discovery.ts";
import { requestJson } from "./http.ts";
import { withLock } from "./lock.ts";
import { listenLoopback, LOOPBACK_PORTS, redirectUri } from "./loopback.ts";
import {
  readRegistration,
  registerClient,
  saveRegistration,
} from "./registration.ts";
import type { SecretStore, StoredCredential } from "./store.ts";

type Session = Extract<StoredCredential, { kind: "session" }>;
type LoginDeps = {
  fetch: typeof globalThis.fetch;
  openBrowser: (url: string) => Promise<void>;
  note: (line: string) => void;
  store: SecretStore;
  dir: string;
  now: () => number;
  signal: AbortSignal;
  // TASTE_API_URL, for the identity check against a local mock.
  apiUrl?: string;
};
type RefreshDeps = {
  fetch: typeof globalThis.fetch;
  store: SecretStore;
  dir: string;
  now: () => number;
  signal?: AbortSignal;
  // The lock's wait between tries, injectable so a test needn't wait 10 seconds.
  sleep?: (ms: number) => Promise<void>;
};
type Tokens = { accessToken: string; refreshToken: string; expiresAt: number };
type TokenAnswer = { tokens: Tokens } | { error: string };

const SCOPE = "openid email offline_access";
const LOGIN_TIMEOUT_MS = 5 * 60_000;
const TOKENS = z.looseObject({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().positive(),
  token_type: z.string().refine((type) => type.toLowerCase() === "bearer"),
});
const TOKEN_ERROR = z.looseObject({ error: z.string() });

function base64url(bytes: Buffer): string {
  return bytes.toString("base64url");
}

async function requestTokens(
  fetch: typeof globalThis.fetch,
  endpoint: string,
  form: Record<string, string>,
  now: () => number,
  signal?: AbortSignal
): Promise<TokenAnswer> {
  const { status, body } = await requestJson(fetch, endpoint, {
    method: "POST",
    form,
    signal,
  });
  if (status === 200) {
    const parsed = TOKENS.safeParse(body);
    if (!parsed.success) throw new CliError("LOGIN_FAILED");
    const t = parsed.data;
    // From expires_in, not the token's own claims: the token is opaque to us by design.
    const expiresAt = now() + t.expires_in * 1000;
    return {
      tokens: {
        accessToken: t.access_token,
        refreshToken: t.refresh_token,
        expiresAt,
      },
    };
  }
  if (status >= 500) throw new CliError("UPSTREAM");
  const parsed = TOKEN_ERROR.safeParse(body);
  if (!parsed.success) throw new CliError("LOGIN_FAILED");
  return { error: parsed.data.error };
}

async function loadOrRegister(
  deps: LoginDeps,
  meta: OAuthEndpoints,
  fresh: boolean
): Promise<string> {
  const saved = fresh ? null : await readRegistration(deps.dir, meta);
  if (saved) return saved.clientId;
  const registration = await registerClient(deps.fetch, meta, deps.signal);
  await saveRegistration(deps.dir, meta, registration);
  return registration.clientId;
}

// One trip through the browser: a fresh verifier and state, the address printed and opened, the
// callback awaited, the code exchanged.
async function authorize(
  deps: LoginDeps,
  meta: OAuthEndpoints,
  clientId: string
): Promise<TokenAnswer> {
  const loopback = await listenLoopback(LOOPBACK_PORTS);
  const redirect = redirectUri(loopback.port);
  let code: string;
  const verifier = base64url(randomBytes(32));
  try {
    const state = base64url(randomBytes(32));
    const challenge = base64url(createHash("sha256").update(verifier).digest());
    const url = new URL(meta.authorize);
    // Added to, not replacing, any query the endpoint already has.
    for (const [name, value] of Object.entries({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirect,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
      scope: SCOPE,
      resource: meta.resource,
    }))
      url.searchParams.set(name, value);
    const waiting = loopback.waitForCallback(
      state,
      LOGIN_TIMEOUT_MS,
      deps.signal
    );
    // Caught at once, so a failure that lands while the browser opens is never unhandled.
    waiting.catch(() => undefined);
    deps.note(
      "Opening your browser to sign in. If it doesn't open, go to this address:"
    );
    deps.note(url.toString());
    // Not opening is fine: the address is on screen.
    await Promise.resolve()
      .then(() => deps.openBrowser(url.toString()))
      .catch(() => undefined);
    code = await waiting;
  } finally {
    await loopback.close();
  }
  return requestTokens(
    deps.fetch,
    meta.token,
    {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirect,
      client_id: clientId,
      code_verifier: verifier,
      resource: meta.resource,
    },
    deps.now,
    deps.signal
  );
}

async function loginWithBrowser(deps: LoginDeps): Promise<Session> {
  const meta = await discover(deps.fetch, deps.signal);
  let clientId = await loadOrRegister(deps, meta, false);
  let answer = await authorize(deps, meta, clientId);
  // The server forgot the registration (it may expire them): register again and go round once more.
  if ("error" in answer && answer.error === "invalid_client") {
    deps.note(
      "The sign in needs one more step in the browser. Opening it again."
    );
    clientId = await loadOrRegister(deps, meta, true);
    answer = await authorize(deps, meta, clientId);
  }
  if ("error" in answer) throw new CliError("LOGIN_FAILED");
  const { tokens } = answer;
  const api = createTasteApi({
    fetch: deps.fetch,
    baseUrl: deps.apiUrl ?? DEFAULT_API_URL,
    auth: {
      header: () =>
        Promise.resolve({ authorization: `Bearer ${tokens.accessToken}` }),
      onUnauthorized: () => Promise.resolve(false),
    },
    sleep: (ms, signal) => delay(ms, undefined, { signal }),
    signal: deps.signal,
  });
  const me = await api.me();
  const session: Session = {
    kind: "session",
    clientId,
    ...tokens,
    email: me.email ?? null,
  };
  await deps.store.write(session);
  return session;
}

async function refreshSession(
  deps: RefreshDeps,
  credential: Session
): Promise<Session> {
  return withLock(join(deps.dir, "refresh.lock"), deps, async () => {
    const current = await deps.store.read();
    // Signed out, or switched to a key, while we waited.
    if (current?.kind !== "session") throw new CliError("SESSION_EXPIRED");
    // Another process refreshed first; its token is the one that works now.
    if (current.expiresAt > credential.expiresAt) return current;
    const meta = await discover(deps.fetch, deps.signal);
    const answer = await requestTokens(
      deps.fetch,
      meta.token,
      {
        grant_type: "refresh_token",
        refresh_token: current.refreshToken,
        client_id: current.clientId,
      },
      deps.now,
      deps.signal
    );
    if ("error" in answer) {
      if (
        answer.error === "invalid_grant" ||
        answer.error === "invalid_client"
      ) {
        await deps.store.clear();
        throw new CliError("SESSION_EXPIRED");
      }
      throw new CliError("LOGIN_FAILED");
    }
    const next: Session = { ...current, ...answer.tokens };
    await deps.store.write(next);
    return next;
  });
}

export { LOGIN_TIMEOUT_MS, loginWithBrowser, refreshSession };
export type { LoginDeps, RefreshDeps, Session };
