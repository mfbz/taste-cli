import {
  chmodSync,
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

function fakeKeychain(fail?: "read" | "write"): KeychainLike & {
  value: string | null;
} {
  return {
    value: null,
    get() {
      if (fail === "read") return Promise.reject(new Error("no keychain"));
      return Promise.resolve(this.value);
    },
    set(value: string) {
      if (fail === "write") return Promise.reject(new Error("locked"));
      this.value = value;
      return Promise.resolve();
    },
    delete() {
      if (fail === "read") return Promise.reject(new Error("no keychain"));
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
  it("keeps the credential in the keychain as JSON, without a warning", async () => {
    const keychain = fakeKeychain();
    const store = await openStore({ dir, keychain, warn });
    expect(store.name).toBe("keychain");
    await store.write(SESSION);
    expect(JSON.parse(keychain.value ?? "")).toEqual(SESSION);
    expect(await store.read()).toEqual(SESSION);
    expect(warnings).toEqual([]);
    expect(() => readdirSync(dir)).toThrow();
  });

  it("clears both the keychain and a file left from an earlier fallback", async () => {
    const fallback = await openStore({ dir, keychain: null, warn });
    await fallback.write(KEY);
    const keychain = fakeKeychain();
    const store = await openStore({ dir, keychain, warn });
    await store.write(SESSION);
    await store.clear();
    expect(keychain.value).toBeNull();
    expect(readdirSync(dir)).toEqual([]);
    await store.clear();
    expect(await store.read()).toBeNull();
  });

  it("removes a file left from an earlier fallback when it writes", async () => {
    const fallback = await openStore({ dir, keychain: null, warn });
    await fallback.write(KEY);
    const store = await openStore({ dir, keychain: fakeKeychain(), warn });
    await store.write(SESSION);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("reads a keychain that locks after opening as signed out, with one warning", async () => {
    const keychain = fakeKeychain();
    const store = await openStore({ dir, keychain, warn });
    keychain.get = () => Promise.reject(new Error("locked"));
    expect(await store.read()).toBeNull();
    expect(warnings).toEqual([
      "The system keychain could not be read. Unlock it and try again.",
    ]);
  });

  it("reads a corrupt keychain entry as signed out, with one warning", async () => {
    const keychain = fakeKeychain();
    keychain.value = "{not json";
    const store = await openStore({ dir, keychain, warn });
    expect(await store.read()).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("taste login");
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
  it("falls back to a private file with exactly one warning", async () => {
    const store = await openStore({
      dir,
      keychain: fakeKeychain("read"),
      warn,
    });
    expect(store.name).toBe("file");
    await store.write(SESSION);
    expect(await store.read()).toEqual(SESSION);
    await store.clear();
    expect(warnings).toEqual([
      `No system keychain; credentials are stored in ${join(dir, "credentials.json")} (readable only by you).`,
    ]);
  });

  it("falls back the same way when the keychain module could not load", async () => {
    const store = await openStore({ dir, keychain: null, warn });
    expect(store.name).toBe("file");
    expect(warnings).toHaveLength(1);
  });

  it("round trips through a file only its owner can read", async () => {
    const store = await openStore({ dir, keychain: null, warn });
    await store.write(SESSION);
    expect(await store.read()).toEqual(SESSION);
    await store.write(KEY);
    expect(await store.read()).toEqual(KEY);
    expect(readdirSync(dir)).toEqual(["credentials.json"]);
    if (posix) {
      expect(statSync(dir).mode & 0o777).toBe(0o700);
      expect(statSync(join(dir, "credentials.json")).mode & 0o777).toBe(0o600);
    }
  });

  it("reads a missing file as signed out, without a warning", async () => {
    const store = await openStore({ dir, keychain: null, warn });
    warnings = [];
    expect(await store.read()).toBeNull();
    expect(warnings).toEqual([]);
  });

  it("reads a corrupt file as signed out, with a hint and no stack", async () => {
    const store = await openStore({ dir, keychain: null, warn });
    await store.write(KEY);
    writeFileSync(join(dir, "credentials.json"), "{oops", { mode: 0o600 });
    warnings = [];
    expect(await store.read()).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("taste login");
    expect(warnings[0]).not.toMatch(/\n|Error|oops/);
  });

  it("reads a file of the wrong shape as signed out, with a hint", async () => {
    const store = await openStore({ dir, keychain: null, warn });
    await store.write(KEY);
    writeFileSync(
      join(dir, "credentials.json"),
      JSON.stringify({ kind: "key", apiKey: 42 }),
      { mode: 0o600 }
    );
    warnings = [];
    expect(await store.read()).toBeNull();
    expect(warnings).toHaveLength(1);
  });

  it.skipIf(!posix)("refuses a file others can read", async () => {
    const store = await openStore({ dir, keychain: null, warn });
    await store.write(KEY);
    chmodSync(join(dir, "credentials.json"), 0o640);
    warnings = [];
    expect(await store.read()).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("other users");
  });

  it.skipIf(!posix)("refuses a symlink in place of the file", async () => {
    const store = await openStore({ dir, keychain: null, warn });
    await store.write(KEY);
    const elsewhere = join(root, "elsewhere.json");
    writeFileSync(elsewhere, JSON.stringify(KEY), { mode: 0o600 });
    rmSync(join(dir, "credentials.json"));
    symlinkSync(elsewhere, join(dir, "credentials.json"));
    warnings = [];
    expect(await store.read()).toBeNull();
    expect(warnings).toHaveLength(1);
  });

  it.skipIf(!posix)("tightens a config folder others can open", async () => {
    const store = await openStore({ dir, keychain: null, warn });
    await store.write(KEY);
    chmodSync(dir, 0o755);
    await store.write(KEY);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });

  it("clears the file, and clearing twice is fine", async () => {
    const store = await openStore({ dir, keychain: null, warn });
    await store.clear();
    await store.write(KEY);
    await store.clear();
    await store.clear();
    expect(await store.read()).toBeNull();
    expect(readdirSync(dir)).toEqual([]);
  });

  it("says the sign in was not saved when the folder can't be made", async () => {
    writeFileSync(join(root, "a-file"), "");
    const store = await openStore({
      dir: join(root, "a-file", "taste-cli"),
      keychain: null,
      warn,
    });
    const error = thrown(await store.write(KEY).catch((e: unknown) => e));
    expect(error.code).toBe("CREDENTIALS_STORE_FAILED");
  });
});
