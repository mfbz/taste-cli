import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import type { Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clientFile } from "../config/paths.ts";
import { CliError } from "../output/errors.ts";
import { EMAIL, ENDPOINTS, fakeOAuth, memoryStore } from "./fake-oauth.ts";
import type { FakeOAuth } from "./fake-oauth.ts";
import { LOOPBACK_PORTS } from "./loopback.ts";
import { LOGIN_TIMEOUT_MS, loginWithBrowser, refreshSession } from "./oauth.ts";
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
  vi.useRealTimers();
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
  it("signs in and stores a session that expires in an hour, with the email from /design/me", async () => {
    const fake = fakeOAuth();
    const store = memoryStore();
    const session = await loginWithBrowser(
      loginDeps(fake, fake.browser(), store)
    );
    expect(session).toEqual({
      kind: "session",
      clientId: "client-1",
      accessToken: fake.accessTokens[0],
      refreshToken: [...fake.refreshTokens][0],
      expiresAt: NOW + 3600_000,
      email: EMAIL,
    });
    expect(store.value).toEqual(session);
  });

  it("registers one public client for every loopback port", async () => {
    const fake = fakeOAuth();
    await loginWithBrowser(loginDeps(fake));
    expect(fake.registrations).toEqual([
      {
        client_name: "taste-cli (unofficial)",
        redirect_uris: LOOPBACK_PORTS.map(
          (p) => `http://127.0.0.1:${p}/callback`
        ),
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      },
    ]);
    expect(JSON.parse(readFileSync(clientFile(dir), "utf8"))).toEqual({
      clientId: "client-1",
      ports: [...LOOPBACK_PORTS],
      registrationEndpoint: ENDPOINTS.register,
    });
  });

  it("asks for PKCE S256, the resource and offline access, and prints the address before opening it", async () => {
    const fake = fakeOAuth();
    const browser = fake.browser();
    await loginWithBrowser(loginDeps(fake, browser));
    const [opened] = browser.opened;
    expect(opened).toBeDefined();
    expect(opened).toContain("code_challenge_method=S256");
    expect(opened).toContain("resource=https%3A%2F%2Fmcp.tastelabs.com%2Fmcp");
    expect(opened).toContain("scope=openid+email+offline_access");
    expect(opened?.startsWith(`${ENDPOINTS.authorize}?`)).toBe(true);
    const url = new URL(opened ?? "");
    expect(url.searchParams.get("state")).toMatch(/^[\w-]{43}$/);
    expect(notes).toContain(opened);
  });

  it("reuses a saved registration", async () => {
    const fake = fakeOAuth();
    await loginWithBrowser(loginDeps(fake));
    await loginWithBrowser(loginDeps(fake));
    expect(fake.registrations).toHaveLength(1);
  });

  it("registers again when the saved registration has other ports", async () => {
    const fake = fakeOAuth();
    await loginWithBrowser(loginDeps(fake));
    writeFileSync(
      clientFile(dir),
      JSON.stringify({
        clientId: "client-1",
        ports: [1234],
        registrationEndpoint: ENDPOINTS.register,
      })
    );
    await loginWithBrowser(loginDeps(fake));
    expect(fake.registrations).toHaveLength(2);
  });

  it("registers again when the saved registration can't be read", async () => {
    const fake = fakeOAuth();
    writeFileSync(clientFile(dir), "{not json");
    await loginWithBrowser(loginDeps(fake));
    expect(fake.registrations).toHaveLength(1);
  });

  it("registers once more and signs in when the token endpoint answers invalid_client", async () => {
    const fake = fakeOAuth();
    fake.tokenErrors.push("invalid_client");
    const browser = fake.browser();
    const session = await loginWithBrowser(loginDeps(fake, browser));
    expect(fake.registrations).toHaveLength(2);
    expect(browser.opened).toHaveLength(2);
    expect(session.clientId).toBe("client-2");
  });

  it("gives up after a second invalid_client", async () => {
    const fake = fakeOAuth();
    fake.tokenErrors.push("invalid_client", "invalid_client");
    expect((await failure(loginWithBrowser(loginDeps(fake)))).code).toBe(
      "LOGIN_FAILED"
    );
  });

  it("fails with LOGIN_DENIED on a callback with the wrong state, and stores nothing", async () => {
    const fake = fakeOAuth();
    const store = memoryStore();
    const error = await failure(
      loginWithBrowser(loginDeps(fake, fake.browser("wrong-state"), store))
    );
    expect(error.code).toBe("LOGIN_DENIED");
    expect(tokenCalls(fake)).toHaveLength(0);
    expect(store.value).toBeNull();
  });

  it("fails with LOGIN_DENIED when the person says no", async () => {
    const fake = fakeOAuth();
    const error = await failure(
      loginWithBrowser(loginDeps(fake, fake.browser("deny")))
    );
    expect(error.code).toBe("LOGIN_DENIED");
  });

  it("fails with LOGIN_TIMEOUT after five minutes", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const fake = fakeOAuth();
    let opened!: () => void;
    const wasOpened = new Promise<void>((resolve) => (opened = resolve));
    const deps = {
      ...loginDeps(fake),
      openBrowser: () => {
        opened();
        return Promise.resolve();
      },
    };
    const login = failure(loginWithBrowser(deps));
    await wasOpened;
    await vi.advanceTimersByTimeAsync(LOGIN_TIMEOUT_MS);
    expect((await login).code).toBe("LOGIN_TIMEOUT");
  });

  it("fails with LOGIN_PORTS_BUSY when every loopback port is taken", async () => {
    const held: Server[] = [];
    for (const port of LOOPBACK_PORTS) {
      const server = createServer();
      // A port something else already holds is just as busy.
      await new Promise<void>((resolve) => {
        server.once("error", () => resolve());
        server.listen(port, "127.0.0.1", () => {
          held.push(server);
          resolve();
        });
      });
    }
    try {
      const fake = fakeOAuth();
      const error = await failure(loginWithBrowser(loginDeps(fake)));
      expect(error.code).toBe("LOGIN_PORTS_BUSY");
    } finally {
      await Promise.all(
        held.map((s) => new Promise((resolve) => s.close(resolve)))
      );
    }
  });

  it("still signs in when the browser can't be opened", async () => {
    const fake = fakeOAuth();
    const browser = fake.browser();
    const deps = {
      ...loginDeps(fake, browser),
      openBrowser: async (url: string) => {
        await browser.open(url);
        throw new Error("no browser");
      },
    };
    await expect(loginWithBrowser(deps)).resolves.toMatchObject({
      kind: "session",
    });
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

  it("stores the rotated refresh token and a new expiry", async () => {
    const fake = fakeOAuth();
    const { store, expired } = await signedIn(fake);
    const next = await refreshSession(refreshDeps(fake, store), expired);
    expect(next.accessToken).toBe(fake.accessTokens.at(-1));
    expect(next.refreshToken).not.toBe(expired.refreshToken);
    expect(fake.refreshTokens.has(next.refreshToken)).toBe(true);
    expect(next.expiresAt).toBe(NOW + 3600_000);
    expect(store.value).toEqual(next);
    const form = tokenCalls(fake).at(-1)?.form;
    expect(form?.get("grant_type")).toBe("refresh_token");
    expect(form?.get("client_id")).toBe(expired.clientId);
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
    expect(existsSync(join(dir, "refresh.lock"))).toBe(false);
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
    expect(a.accessToken).toBe(fake.accessTokens.at(-1));
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

  it("goes ahead after waiting 10 seconds on a lock that stays held, and leaves that lock alone", async () => {
    const fake = fakeOAuth();
    const { store, expired } = await signedIn(fake);
    const lock = join(dir, "refresh.lock");
    writeFileSync(lock, "");
    let clock = Date.now();
    const waits: number[] = [];
    const next = await refreshSession(
      {
        ...refreshDeps(fake, store),
        now: () => clock,
        sleep: (ms: number) => {
          waits.push(ms);
          clock += ms;
          return Promise.resolve();
        },
      },
      expired
    );
    expect(next.accessToken).toBe(fake.accessTokens.at(-1));
    expect(waits.every((ms) => ms === 100)).toBe(true);
    expect(waits.length).toBe(100);
    expect(existsSync(lock)).toBe(true);
  });

  it("throws SESSION_EXPIRED when another process signed out meanwhile", async () => {
    const fake = fakeOAuth();
    const { store, expired } = await signedIn(fake);
    await store.clear();
    expect(
      (await failure(refreshSession(refreshDeps(fake, store), expired))).code
    ).toBe("SESSION_EXPIRED");
  });
});
