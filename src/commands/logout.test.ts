import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { memoryStore } from "../auth/fake-oauth.ts";
import type { KeychainLike } from "../auth/keychain.ts";
import { openStore } from "../auth/store.ts";
import { credentialsFile } from "../config/paths.ts";
import { runCli } from "../fake-io.ts";

// Built at run time so the guards never see a key-shaped literal.
const KEY = ["taste", "TESTKEY", "v".repeat(16)].join("_");

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "taste-logout-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("taste logout", () => {
  it("forgets the stored sign in, and succeeds again when there is none", async () => {
    const store = memoryStore({ kind: "key", apiKey: KEY });
    const io = { store: () => Promise.resolve(store) };
    const first = await runCli(["logout"], io);
    expect(first.code).toBe(0);
    expect(first.out).toContain("Signed out");
    expect(store.value).toBeNull();
    const second = await runCli(["logout", "--json"], io);
    expect(second.code).toBe(0);
    expect(second.doc()).toEqual({ ok: true, data: { signedOut: true } });
  });

  it("notes that TASTE_API_KEY still signs taste in", async () => {
    const store = memoryStore();
    const { code, err } = await runCli(["logout"], {
      store: () => Promise.resolve(store),
      env: { TASTE_API_KEY: KEY },
    });
    expect(code).toBe(0);
    expect(err).toContain("TASTE_API_KEY is set");
    expect(err).not.toContain(KEY);
  });

  it("shows the store's warning when an unreachable keychain may still hold a sign in", async () => {
    const broken: KeychainLike = {
      get: () => Promise.reject(new Error("locked")),
      set: () => Promise.reject(new Error("locked")),
      delete: () => Promise.reject(new Error("locked")),
    };
    const file = credentialsFile(dir);
    writeFileSync(file, JSON.stringify({ kind: "key", apiKey: KEY }), {
      mode: 0o600,
    });
    for (const json of [false, true]) {
      const { code, out, err } = await runCli(
        ["logout", ...(json ? ["--json"] : [])],
        { store: (warn) => openStore({ dir, keychain: broken, warn }) }
      );
      expect(code).toBe(0);
      expect(err).toContain("keychain could not be reached");
      expect(existsSync(file)).toBe(false);
      if (json)
        expect(JSON.parse(out)).toEqual({
          ok: true,
          data: { signedOut: true },
        });
    }
  });
});
