import {
  existsSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CliError } from "../output/errors.ts";
import { EMAIL, ENDPOINTS, fakeOAuth, memoryStore } from "./fake-oauth.ts";
import type { FakeOAuth } from "./fake-oauth.ts";
import { LOOPBACK_PORTS } from "./loopback.ts";
import { loginWithBrowser, refreshSession } from "./oauth.ts";
import type { StoredCredential } from "./store.ts";

type Session = Extract<StoredCredential, { kind: "session" }>;

const NOW = 1_800_000_000_000;

let dir: string;
let notes: string[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "taste-oauth-"));
  notes = [];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function loginDeps(
  fake: FakeOAuth,
  browser = fake.browser(),
  store = memoryStore()
) {
  return {
    fetch: fake.fetch,
    openBrowser: browser.open,
    note: (line: string) => void notes.push(line),
    store,
    dir,
    now: () => NOW,
    signal: new AbortController().signal,
  };
}

async function failure(promise: Promise<unknown>): Promise<CliError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CliError) return error;
    throw error;
  }
  throw new Error("expected a rejection");
}

function tokenCalls(fake: FakeOAuth) {
  return fake.calls.filter((c) => c.url === ENDPOINTS.token);
}

function everythingSaid(error?: unknown): string {
  return [
    ...notes,
    error instanceof Error ? `${error.message} ${JSON.stringify(error)}` : "",
  ].join("\n");
}

describe("loginWithBrowser", () => {
  it("signs in with PKCE S256 through one public client, printing the address, and stores the session", async () => {
    const fake = fakeOAuth();
    const browser = fake.browser();
    const store = memoryStore();
    const session = await loginWithBrowser(loginDeps(fake, browser, store));
    expect(session).toEqual({
      kind: "session",
      clientId: "client-1",
      accessToken: fake.accessTokens[0],
      refreshToken: [...fake.refreshTokens][0],
      expiresAt: NOW + 3600_000,
      email: EMAIL,
    });
    expect(store.value).toEqual(session);
    expect(fake.registrations).toMatchObject([
      {
        redirect_uris: LOOPBACK_PORTS.map(
          (p) => `http://127.0.0.1:${p}/callback`
        ),
        token_endpoint_auth_method: "none",
      },
    ]);
    const opened = new URL(browser.opened[0] ?? "");
    expect(opened.searchParams.get("code_challenge_method")).toBe("S256");
    expect(opened.searchParams.get("resource")).toBe(
      "https://mcp.tastelabs.com/mcp"
    );
    expect(opened.searchParams.get("scope")).toBe(
      "openid email offline_access"
    );
    expect(opened.searchParams.get("state")).toMatch(/^[\w-]{43}$/);
    expect(notes).toContain(opened.href);
  });

  it("reuses a saved registration, and registers once more when Taste forgot it", async () => {
    const fake = fakeOAuth();
    await loginWithBrowser(loginDeps(fake));
    await loginWithBrowser(loginDeps(fake));
    expect(fake.registrations).toHaveLength(1);
    fake.tokenErrors.push("invalid_client");
    const session = await loginWithBrowser(loginDeps(fake));
    expect(session.clientId).toBe("client-2");
  });

  it("turns away a callback with the wrong state and exchanges only the real code", async () => {
    const fake = fakeOAuth();
    const browser = fake.browser("forged-first");
    await loginWithBrowser(loginDeps(fake, browser));
    expect(browser.answers[0]).toBe(400);
    expect(tokenCalls(fake)).toHaveLength(1);
    expect(tokenCalls(fake)[0]?.form?.get("code")).not.toBe("forged-code");
  });

  it("fails with LOGIN_DENIED when the person says no", async () => {
    const fake = fakeOAuth();
    const error = await failure(
      loginWithBrowser(loginDeps(fake, fake.browser("deny")))
    );
    expect(error.code).toBe("LOGIN_DENIED");
  });

  it("never says a token in a note or an error", async () => {
    const fake = fakeOAuth();
    await loginWithBrowser(loginDeps(fake));
    fake.tokenErrors.push("invalid_client", "invalid_client");
    const error = await failure(loginWithBrowser(loginDeps(fake)));
    const said = everythingSaid(error);
    for (const secret of [...fake.accessTokens, ...fake.refreshTokens])
      expect(said).not.toContain(secret);
  });
});

describe("refreshSession", () => {
  // A signed-in session whose access token has run out.
  async function signedIn(fake: FakeOAuth) {
    const store = memoryStore();
    const session = await loginWithBrowser(
      loginDeps(fake, fake.browser(), store)
    );
    const expired: Session = { ...session, expiresAt: NOW - 1 };
    await store.write(expired);
    return { store, expired };
  }

  function refreshDeps(fake: FakeOAuth, store: ReturnType<typeof memoryStore>) {
    return { fetch: fake.fetch, store, dir, now: () => NOW };
  }

  it("stores the rotated refresh token and a new expiry, and releases the lock", async () => {
    const fake = fakeOAuth();
    const { store, expired } = await signedIn(fake);
    const next = await refreshSession(refreshDeps(fake, store), expired);
    expect(next.accessToken).toBe(fake.accessTokens.at(-1));
    expect(next.refreshToken).not.toBe(expired.refreshToken);
    expect(next.expiresAt).toBe(NOW + 3600_000);
    expect(store.value).toEqual(next);
    expect(tokenCalls(fake).at(-1)?.form?.get("grant_type")).toBe(
      "refresh_token"
    );
    expect(existsSync(join(dir, "refresh.lock"))).toBe(false);
  });

  it("ends the session on invalid_grant: clears the store and throws SESSION_EXPIRED", async () => {
    const fake = fakeOAuth();
    const { store, expired } = await signedIn(fake);
    fake.refreshTokens.clear();
    const error = await failure(
      refreshSession(refreshDeps(fake, store), expired)
    );
    expect(error.code).toBe("SESSION_EXPIRED");
    expect(store.value).toBeNull();
    expect(everythingSaid(error)).not.toContain(expired.refreshToken);
  });

  it("refreshes once when two callers race, and both get the same new token", async () => {
    const fake = fakeOAuth();
    const { store, expired } = await signedIn(fake);
    fake.tokenDelayMs = 50;
    const before = tokenCalls(fake).length;
    const [a, b] = await Promise.all([
      refreshSession(refreshDeps(fake, store), expired),
      refreshSession(refreshDeps(fake, store), expired),
    ]);
    expect(tokenCalls(fake).length - before).toBe(1);
    expect(a.accessToken).toBe(b.accessToken);
  });

  it("returns what another process already refreshed without calling the server", async () => {
    const fake = fakeOAuth();
    const { store, expired } = await signedIn(fake);
    const newer: Session = { ...expired, expiresAt: NOW + 1000 };
    await store.write(newer);
    const callsBefore = fake.calls.length;
    await expect(
      refreshSession(refreshDeps(fake, store), expired)
    ).resolves.toEqual(newer);
    expect(fake.calls).toHaveLength(callsBefore);
  });

  it("takes over a lock older than 30 seconds", async () => {
    const fake = fakeOAuth();
    const { store, expired } = await signedIn(fake);
    const lock = join(dir, "refresh.lock");
    writeFileSync(lock, "");
    const old = new Date(Date.now() - 60_000);
    utimesSync(lock, old, old);
    const next = await refreshSession(
      { ...refreshDeps(fake, store), now: () => Date.now() },
      expired
    );
    expect(next.accessToken).toBe(fake.accessTokens.at(-1));
    expect(existsSync(lock)).toBe(false);
  });
});
