import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { memoryStore } from "../auth/fake-oauth.ts";
import { openStore } from "../auth/store.ts";
import type { StoredCredential } from "../auth/store.ts";
import { credentialsFile } from "../config/paths.ts";
import { fakeMe, runCli } from "../fake-io.ts";
import type { Io } from "../io.ts";

const NOW = 1_800_000_000_000;
// Built at run time so the guards never see a key-shaped literal.
const KEY = ["taste", "TESTKEY", "y".repeat(16)].join("_");
const ACCESS = ["access", "z".repeat(12)].join("-");

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "taste-whoami-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function session(overrides: Partial<StoredCredential> = {}): StoredCredential {
  return {
    kind: "session",
    clientId: "client-1",
    accessToken: ACCESS,
    refreshToken: "refresh-1",
    expiresAt: NOW + 3_600_000,
    email: "stored@example.com",
    ...overrides,
  } as StoredCredential;
}

function seams(initial: StoredCredential | null, overrides: Partial<Io> = {}) {
  const store = memoryStore(initial);
  let opened = 0;
  const me = fakeMe(KEY, `Bearer ${ACCESS}`);
  const io: Partial<Io> = {
    fetch: me.fetch,
    store: () => {
      opened += 1;
      return Promise.resolve(store);
    },
    configDir: dir,
    now: () => NOW,
    ...overrides,
  };
  return { io, store, me, opened: () => opened };
}

describe("taste whoami", () => {
  it("says you are not signed in when nothing is stored", async () => {
    const { io, me } = seams(null);
    const { code, err } = await runCli(["whoami"], io);
    expect(code).toBe(1);
    expect(err).toContain("not signed in");
    expect(err).toContain("taste login");
    expect(me.calls).toHaveLength(0);
    const json = await runCli(["whoami", "--json"], io);
    expect(json.doc().error.code).toBe("NOT_SIGNED_IN");
  });

  it("reads a corrupt credentials file as not signed in, warning on stderr in both modes, never a stack", async () => {
    writeFileSync(credentialsFile(dir), "{not json", { mode: 0o600 });
    const { io } = seams(null, {
      store: (warn) => openStore({ dir, keychain: null, warn }),
    });
    const human = await runCli(["whoami", "--debug"], io);
    expect(human.code).toBe(1);
    expect(human.err).toContain("can't be read");
    expect(human.err).toContain("not signed in");
    expect(human.err).not.toMatch(/SyntaxError|\bat \S+:\d+/);
    const { out, err, doc } = await runCli(["whoami", "--json"], io);
    expect(err).toContain("can't be read");
    expect(out.trim().split("\n")).toHaveLength(1);
    expect(doc().error.code).toBe("NOT_SIGNED_IN");
  });

  it("uses TASTE_API_KEY without opening the store", async () => {
    const { io, me, opened } = seams(session(), {
      env: { TASTE_API_KEY: KEY },
    });
    const { code, out, err, doc } = await runCli(["whoami", "--json"], io);
    expect(code).toBe(0);
    expect(doc().data).toEqual({
      method: "env-key",
      email: "person@example.com",
      store: null,
    });
    expect(me.calls[0]?.headers.get("x-api-key")).toBe(KEY);
    expect(opened()).toBe(0);
    expect(out + err).not.toContain(KEY);

    const human = await runCli(["whoami"], io);
    expect(human.out).toContain("Using an API key from TASTE_API_KEY");
    expect(human.err).toContain("TASTE_API_KEY is set");
  });

  it("confirms a browser session with one request", async () => {
    const { io, me } = seams(session());
    const { code, out } = await runCli(["whoami"], io);
    expect(code).toBe(0);
    expect(out).toContain("Signed in as person@example.com (browser session)");
    expect(me.calls).toHaveLength(1);
    const json = await runCli(["whoami", "--json"], io);
    expect(json.doc().data).toEqual({
      method: "session",
      email: "person@example.com",
      store: "keychain",
    });
  });

  it("reports a stored key that Taste no longer accepts as INVALID_API_KEY", async () => {
    const other = ["taste", "OTHER", "w".repeat(16)].join("_");
    const { io } = seams({ kind: "key", apiKey: other });
    const { code, out, err, doc } = await runCli(["whoami", "--json"], io);
    expect(code).toBe(1);
    expect(doc().error.code).toBe("INVALID_API_KEY");
    expect(out + err).not.toContain(other);
  });
});
