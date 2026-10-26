import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CliError } from "../output/errors.ts";
import type { KeychainLike } from "./keychain.ts";
import { openStore } from "./store.ts";
import type { StoredCredential } from "./store.ts";

// Token-shaped values are built at run time so the guards never see a literal.
const SESSION: StoredCredential = {
  kind: "session",
  clientId: "client-1",
  accessToken: ["access", "x".repeat(10)].join("-"),
  refreshToken: ["refresh", "y".repeat(10)].join("-"),
  expiresAt: 1_800_000_000_000,
  email: "person@example.com",
};
const KEY: StoredCredential = {
  kind: "key",
  apiKey: ["taste", "test", "z".repeat(8)].join("_"),
};
const posix = process.platform !== "win32";

let root: string;
let dir: string;
let warnings: string[];
const warn = (line: string) => void warnings.push(line);

type FakeKeychain = KeychainLike & {
  value: string | null;
  fail: "read" | "write" | undefined;
};

// "read": the keychain can't be used at all (every call rejects). "write": only writes reject.
function fakeKeychain(fail?: "read" | "write"): FakeKeychain {
  return {
    value: null,
    fail,
    get() {
      if (this.fail === "read") return Promise.reject(new Error("no keychain"));
      return Promise.resolve(this.value);
    },
    set(value: string) {
      if (this.fail) return Promise.reject(new Error("locked"));
      this.value = value;
      return Promise.resolve();
    },
    delete() {
      if (this.fail === "read") return Promise.reject(new Error("no keychain"));
      this.value = null;
      return Promise.resolve();
    },
  };
}

function thrown(error: unknown): CliError {
  if (error instanceof CliError) return error;
  throw new Error("expected a CliError");
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "taste-store-"));
  dir = join(root, "taste-cli");
  warnings = [];
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("openStore with a working keychain", () => {
  it("keeps the credential in the keychain as JSON, and nothing on disk", async () => {
    const keychain = fakeKeychain();
    const store = await openStore({ dir, keychain, warn });
    expect(store.name).toBe("keychain");
    await store.write(SESSION);
    expect(JSON.parse(keychain.value ?? "")).toEqual(SESSION);
    expect(await store.read()).toEqual(SESSION);
    expect(warnings).toEqual([]);
    expect(() => readdirSync(dir)).toThrow();
  });

  it("removes a file left from an earlier fallback, and clears both", async () => {
    const fallback = await openStore({ dir, keychain: null, warn });
    await fallback.write(KEY);
    const keychain = fakeKeychain();
    const store = await openStore({ dir, keychain, warn });
    await store.write(SESSION);
    expect(readdirSync(dir)).toEqual([]);
    await store.clear();
    await store.clear();
    expect(keychain.value).toBeNull();
    expect(await store.read()).toBeNull();
  });

  it("reads a locked keychain or a corrupt entry as signed out, with one warning each", async () => {
    const keychain = fakeKeychain();
    keychain.value = "{not json";
    const store = await openStore({ dir, keychain, warn });
    expect(await store.read()).toBeNull();
    keychain.get = () => Promise.reject(new Error("locked"));
    expect(await store.read()).toBeNull();
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("taste login");
    expect(warnings[1]).toBe(
      "The system keychain could not be read. Unlock it and try again."
    );
  });

  it("says the sign in was not saved when the keychain refuses a write", async () => {
    const store = await openStore({
      dir,
      keychain: fakeKeychain("write"),
      warn,
    });
    const error = thrown(await store.write(KEY).catch((e: unknown) => e));
    expect(error.code).toBe("CREDENTIALS_STORE_FAILED");
  });
});

describe("openStore without a usable keychain", () => {
  it("falls back to a file only its owner can read, with exactly one warning", async () => {
    const store = await openStore({
      dir,
      keychain: fakeKeychain("read"),
      warn,
    });
    expect(store.name).toBe("file");
    await store.write(SESSION);
    await store.write(KEY);
    expect(await store.read()).toEqual(KEY);
    expect(readdirSync(dir)).toEqual(["credentials.json"]);
    if (posix) {
      expect(statSync(dir).mode & 0o777).toBe(0o700);
      expect(statSync(join(dir, "credentials.json")).mode & 0o777).toBe(0o600);
    }
    expect(warnings).toEqual([
      `No system keychain; credentials are stored in ${join(dir, "credentials.json")} (readable only by you).`,
    ]);
  });

  it("reads a corrupt or wrongly shaped file as signed out, with a hint and no stack", async () => {
    const store = await openStore({ dir, keychain: null, warn });
    await store.write(KEY);
    for (const text of ["{oops", JSON.stringify({ kind: "key", apiKey: 42 })]) {
      writeFileSync(join(dir, "credentials.json"), text, { mode: 0o600 });
      warnings = [];
      expect(await store.read()).toBeNull();
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("taste login");
      expect(warnings[0]).not.toMatch(/\n|Error|oops/);
    }
  });

  it.skipIf(!posix)(
    "refuses a file others can read or a symlink in its place, and tightens the folder",
    async () => {
      const store = await openStore({ dir, keychain: null, warn });
      await store.write(KEY);
      const file = join(dir, "credentials.json");
      chmodSync(file, 0o640);
      warnings = [];
      expect(await store.read()).toBeNull();
      expect(warnings[0]).toContain("other users");
      const elsewhere = join(root, "elsewhere.json");
      writeFileSync(elsewhere, JSON.stringify(KEY), { mode: 0o600 });
      rmSync(file);
      symlinkSync(elsewhere, file);
      expect(await store.read()).toBeNull();
      expect(warnings).toHaveLength(2);
      chmodSync(dir, 0o755);
      rmSync(file);
      await store.write(KEY);
      expect(statSync(dir).mode & 0o777).toBe(0o700);
    }
  );

  it("warns on logout when an unreachable keychain may still hold an old sign in", async () => {
    const keychain = fakeKeychain();
    keychain.value = JSON.stringify(KEY);
    keychain.fail = "read";
    const store = await openStore({ dir, keychain, warn });
    await store.write(SESSION);
    warnings = [];
    await store.clear();
    expect(readdirSync(dir)).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("taste logout");
  });

  it("clears the file and temporary files a killed write left behind", async () => {
    const store = await openStore({ dir, keychain: null, warn });
    await store.write(KEY);
    const leftover = ".credentials-0b5e8a7c-1f2d-4c3b-9a8e-7d6c5b4a3f21.tmp";
    writeFileSync(join(dir, leftover), JSON.stringify(KEY), { mode: 0o600 });
    mkdirSync(join(dir, "keep"));
    warnings = [];
    await store.clear();
    expect(readdirSync(dir)).toEqual(["keep"]);
    expect(warnings).toEqual([]);
  });
});
