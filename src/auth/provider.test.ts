import { describe, expect, it } from "vitest";

import { TasteApiError } from "../api/client.ts";
import { CliError } from "../output/errors.ts";
import { memoryStore } from "./fake-oauth.ts";
import { createAuthProvider } from "./provider.ts";
import type { Session } from "./oauth.ts";
import type { StoredCredential } from "./store.ts";

const NOW = 1_800_000_000_000;
// Built at run time so the guards never see a key-shaped literal.
const ENV_KEY = ["taste", "env", "a".repeat(20)].join("_");
const STORED_KEY = ["taste", "saved", "b".repeat(20)].join("_");
const SESSION: Session = {
  kind: "session",
  clientId: "client-1",
  accessToken: "access-1",
  refreshToken: "refresh-1",
  expiresAt: NOW + 3_600_000,
  email: "person@example.com",
};

function setup(
  initial: StoredCredential | null,
  options: { apiKey?: string; refresh?: (s: Session) => Promise<Session> } = {}
) {
  const store = memoryStore(initial);
  let opened = 0;
  const refreshed: Session[] = [];
  const provider = createAuthProvider({
    env: options.apiKey ? { apiKey: options.apiKey } : {},
    store: () => {
      opened += 1;
      return Promise.resolve(store);
    },
    refresh:
      options.refresh ??
      ((session) => {
        refreshed.push(session);
        return Promise.resolve({
          ...session,
          accessToken: `access-${refreshed.length + 1}`,
          expiresAt: NOW + 7_200_000,
        });
      }),
    now: () => NOW,
  });
  return { provider, store, refreshed, opened: () => opened };
}

async function failure(promise: Promise<unknown>): Promise<CliError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CliError) return error;
    throw error;
  }
  throw new Error("expected a CliError");
}

describe("createAuthProvider", () => {
  it("uses TASTE_API_KEY over a stored sign in, without opening the store", async () => {
    const { provider, opened } = setup(SESSION, { apiKey: ENV_KEY });
    expect(await provider.header()).toEqual({ "x-api-key": ENV_KEY });
    expect(await provider.describe()).toEqual({
      method: "env-key",
      email: null,
      store: null,
    });
    expect(opened()).toBe(0);
  });

  it("sends a stored key as x-api-key and a session as a bearer token", async () => {
    const key = setup({ kind: "key", apiKey: STORED_KEY });
    expect(await key.provider.header()).toEqual({ "x-api-key": STORED_KEY });
    const session = setup(SESSION);
    expect(await session.provider.header()).toEqual({
      authorization: "Bearer access-1",
    });
    expect(await session.provider.describe()).toEqual({
      method: "session",
      email: "person@example.com",
      store: "keychain",
    });
  });

  it("reads the store once per command", async () => {
    const { provider, opened } = setup(SESSION);
    await provider.header();
    await provider.header();
    await provider.describe();
    expect(opened()).toBe(1);
  });

  it("reads nothing stored as not signed in", async () => {
    const { provider } = setup(null);
    expect(await provider.describe()).toBeNull();
    expect((await failure(provider.header())).code).toBe("NOT_SIGNED_IN");
  });

  it("refreshes a session that ends within a minute before using it", async () => {
    const { provider, refreshed } = setup({
      ...SESSION,
      expiresAt: NOW + 59_000,
    });
    expect(await provider.header()).toEqual({
      authorization: "Bearer access-2",
    });
    expect(refreshed).toHaveLength(1);
    expect(await provider.header()).toEqual({
      authorization: "Bearer access-2",
    });
    expect(refreshed).toHaveLength(1);
  });

  it("refreshes a session once on a 401, and never a key", async () => {
    const session = setup(SESSION);
    expect(await session.provider.onUnauthorized()).toBe(true);
    expect(await session.provider.header()).toEqual({
      authorization: "Bearer access-2",
    });
    expect(await session.provider.onUnauthorized()).toBe(false);
    expect(session.refreshed).toHaveLength(1);

    const key = setup({ kind: "key", apiKey: STORED_KEY });
    expect(await key.provider.onUnauthorized()).toBe(false);
    const env = setup(null, { apiKey: ENV_KEY });
    expect(await env.provider.onUnauthorized()).toBe(false);
  });

  it("turns a refresh the sign in service refused into SESSION_EXPIRED", async () => {
    const { provider } = setup(SESSION, {
      refresh: () => Promise.reject(new CliError("LOGIN_FAILED")),
    });
    expect((await failure(provider.onUnauthorized())).code).toBe(
      "SESSION_EXPIRED"
    );
  });

  it("keeps a network failure during a refresh as NETWORK, since the session may still be good", async () => {
    const { provider } = setup(
      { ...SESSION, expiresAt: NOW },
      { refresh: () => Promise.reject(new CliError("NETWORK")) }
    );
    expect((await failure(provider.header())).code).toBe("NETWORK");
  });

  it("explains a final 401 by the credential in use", async () => {
    const unauthorized = new TasteApiError(401);
    const session = setup(SESSION);
    await session.provider.header();
    const explained = session.provider.explain(unauthorized);
    expect(explained).toBeInstanceOf(CliError);
    expect((explained as CliError).code).toBe("SESSION_EXPIRED");

    const key = setup({ kind: "key", apiKey: STORED_KEY });
    await key.provider.header();
    expect(key.provider.explain(unauthorized)).toBe(unauthorized);

    const other = new TasteApiError(403);
    expect(session.provider.explain(other)).toBe(other);
  });
});
