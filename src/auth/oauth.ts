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
  forgetRegistration,
  readRegistration,
  registerClient,
  savedTokenEndpoint,
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
  // The lock's wait between tries, injectable so a test needn't wait for real.
  sleep?: (ms: number) => Promise<void>;
};
type Tokens = { accessToken: string; refreshToken: string; expiresAt: number };
// missing: the endpoint answered 404, so it moved; nothing was spent there.
type TokenAnswer = { tokens: Tokens } | { error: string } | { missing: true };
type TokenOptions = { now: () => number; signal?: AbortSignal };

const SCOPE = "openid email offline_access";
const LOGIN_TIMEOUT_MS = 5 * 60_000;
// Everything a refresh sends, together, finishes inside this, well under the lock's stale age and the
// time other processes wait for it (lock.ts).
const REFRESH_BUDGET_MS = 20_000;
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
  { now, signal }: TokenOptions
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
  if (status === 404) return { missing: true };
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
    try {
      code = await waiting;
    } catch (error) {
      // No answer, or an error instead of a code: the server may no longer know this client.
      const code = error instanceof CliError ? error.code : undefined;
      if (code === "LOGIN_TIMEOUT" || code === "LOGIN_FAILED")
        await forgetRegistration(deps.dir);
      throw error;
    }
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
    { now: deps.now, signal: deps.signal }
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
  if (!("tokens" in answer)) throw new CliError("LOGIN_FAILED");
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

// The saved token endpoint first; the metadata documents only when there is none, or it has moved
// (404, or unreachable and discovery names another). A refresh token is never sent twice to the same
// endpoint: a send that failed may still have spent it.
async function exchangeRefresh(
  deps: RefreshDeps,
  session: Session,
  signal: AbortSignal
): Promise<TokenAnswer> {
  const form = {
    grant_type: "refresh_token",
    refresh_token: session.refreshToken,
    client_id: session.clientId,
  };
  const options = { now: deps.now, signal };
  const saved = await savedTokenEndpoint(deps.dir, session.clientId);
  let failure: CliError | null = null;
  if (saved) {
    try {
      const answer = await requestTokens(deps.fetch, saved, form, options);
      if (!("missing" in answer)) return answer;
      failure = new CliError("LOGIN_FAILED");
    } catch (error) {
      if (!(error instanceof CliError && error.code === "NETWORK")) throw error;
      failure = error;
    }
  }
  const meta = await discover(deps.fetch, signal);
  if (failure && meta.token === saved) throw failure;
  const answer = await requestTokens(deps.fetch, meta.token, form, options);
  if ("tokens" in answer)
    await saveRegistration(deps.dir, meta, {
      clientId: session.clientId,
      ports: [...LOOPBACK_PORTS],
    });
  return answer;
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
    const budget = AbortSignal.timeout(REFRESH_BUDGET_MS);
    const signal = deps.signal
      ? AbortSignal.any([deps.signal, budget])
      : budget;
    const answer = await exchangeRefresh(deps, current, signal);
    if ("missing" in answer) throw new CliError("LOGIN_FAILED");
    if ("error" in answer) {
      if (answer.error !== "invalid_grant" && answer.error !== "invalid_client")
        throw new CliError("LOGIN_FAILED");
      // Only end the session we tried to refresh. A process that went ahead without the lock may
      // have been beaten by the holder, which has stored a newer, working session meanwhile.
      const latest = await deps.store.read();
      if (
        latest?.kind === "session" &&
        latest.refreshToken !== current.refreshToken
      )
        return latest;
      await deps.store.clear();
      throw new CliError("SESSION_EXPIRED");
    }
    const next: Session = { ...current, ...answer.tokens };
    await deps.store.write(next);
    return next;
  });
}

export { LOGIN_TIMEOUT_MS, loginWithBrowser, refreshSession };
export type { LoginDeps, RefreshDeps, Session };
