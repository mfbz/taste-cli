// Where a sign in is kept: the system keychain when there is a usable one, otherwise a file only its
// owner can read. A credential that can't be read (corrupt, the wrong shape, readable by others) reads
// as signed out with one warning, never as a crash: the fix is always taste login.
import { randomUUID } from "node:crypto";
import { chmod, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import { credentialsFile } from "../config/paths.ts";
import { CliError } from "../output/errors.ts";
import { loadKeychain } from "./keychain.ts";
import type { KeychainLike } from "./keychain.ts";
import { PrivateFileError, readPrivateFile } from "./private-file.ts";

type StoredCredential =
  | {
      kind: "session";
      clientId: string;
      accessToken: string;
      refreshToken: string;
      expiresAt: number;
      email: string | null;
    }
  | { kind: "key"; apiKey: string };
type SecretStore = {
  name: "keychain" | "file";
  read(): Promise<StoredCredential | null>;
  write(credential: StoredCredential): Promise<void>;
  clear(): Promise<void>;
};
type Deps = {
  dir: string;
  // undefined: load the real keychain. null: there is none.
  keychain?: KeychainLike | null;
  warn: (line: string) => void;
  platform?: NodeJS.Platform;
};

const TEMP = /^\.credentials-[0-9a-f-]+\.tmp$/;
// A credential is well under 8 KB; anything much bigger isn't one.
const MAX_FILE_BYTES = 64 * 1024;
const CREDENTIAL = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("session"),
    clientId: z.string().min(1),
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1),
    expiresAt: z.number().int(),
    email: z.string().nullable(),
  }),
  z.object({ kind: z.literal("key"), apiKey: z.string().min(1) }),
]);

function unreadable(where: string): string {
  return `The saved sign in ${where} can't be read, so taste ignores it. Run taste login to sign in again.`;
}

function parse(
  text: string,
  where: string,
  warn: Deps["warn"]
): StoredCredential | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  const parsed = CREDENTIAL.safeParse(json);
  if (parsed.success) return parsed.data;
  warn(unreadable(where));
  return null;
}

function storeFailed(cause: unknown): CliError {
  return new CliError("CREDENTIALS_STORE_FAILED", {}, { cause });
}

// Probing reads the entry once: "no entry" is a working keychain, a throw is not one. The value is
// kept for the first read, because each keychain read can mean an access prompt on macOS.
async function probe(
  keychain: KeychainLike | null
): Promise<{ value: string | null } | null> {
  if (!keychain) return null;
  try {
    return { value: await keychain.get() };
  } catch {
    return null;
  }
}

function fileStore(dir: string, platform: NodeJS.Platform, warn: Deps["warn"]) {
  const path = credentialsFile(dir);

  // Synchronous: the race-free reader works on one open descriptor.
  function read(): StoredCredential | null {
    let text: string;
    try {
      text = readPrivateFile(path, { maxBytes: MAX_FILE_BYTES, platform });
    } catch (error) {
      if (error instanceof PrivateFileError && error.reason === "missing")
        return null;
      warn(
        error instanceof PrivateFileError && error.reason === "too-open"
          ? `${path} can be read by other users, so taste ignores it. Run taste login to sign in again.`
          : unreadable(`at ${path}`)
      );
      return null;
    }
    return parse(text, `at ${path}`, warn);
  }

  // Written to a temporary file in the same folder and renamed over the old one, so a crash or a full
  // disk never leaves half a credential behind.
  async function write(credential: StoredCredential): Promise<void> {
    const temp = join(dir, `.credentials-${randomUUID()}.tmp`);
    // Matches TEMP, so clear() can find one a killed process left behind.
    try {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      // mkdir's mode only applies to a folder it creates; an older one is tightened too.
      if (platform !== "win32") await chmod(dir, 0o700);
      await writeFile(temp, JSON.stringify(credential), {
        mode: 0o600,
        flag: "wx",
      });
      await rename(temp, path);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined);
      throw storeFailed(error);
    }
  }

  // Also removes temporary files a process killed between write and rename left behind: each holds
  // a secret.
  async function clear(): Promise<void> {
    try {
      const names = await readdir(dir).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      });
      for (const name of names.filter((n) => TEMP.test(n)))
        await rm(join(dir, name), { force: true });
      await rm(path, { force: true });
    } catch (error) {
      throw storeFailed(error);
    }
  }

  return { read, write, clear };
}

async function openStore(deps: Deps): Promise<SecretStore> {
  const platform = deps.platform ?? process.platform;
  const file = fileStore(deps.dir, platform, deps.warn);
  const keychain =
    deps.keychain === undefined ? await loadKeychain() : deps.keychain;

  const probed = await probe(keychain);
  if (!keychain || !probed) {
    deps.warn(
      `No system keychain; credentials are stored in ${credentialsFile(deps.dir)} (readable only by you).`
    );
    return {
      name: "file",
      read: () => Promise.resolve(file.read()),
      write: file.write,
      // A keychain that failed the probe may still hold an old sign in that comes back when it
      // recovers. A warning, not a failure: with no keychain at all the delete always fails, and
      // logout must still work there.
      clear: async () => {
        await file.clear();
        if (!keychain) return;
        try {
          await keychain.delete();
        } catch {
          deps.warn(
            "The system keychain could not be reached, so a sign in saved there earlier may remain. Unlock it and run taste logout again."
          );
        }
      },
    };
  }

  const where = "in the system keychain";
  // The probe's value serves the first read; a write or clear makes it stale.
  let cached: { value: string | null } | null = probed;
  return {
    name: "keychain",
    async read() {
      let text: string | null;
      try {
        text = cached ? cached.value : await keychain.get();
        cached = null;
      } catch {
        deps.warn(
          "The system keychain could not be read. Unlock it and try again."
        );
        return null;
      }
      return text === null ? null : parse(text, where, deps.warn);
    },
    async write(credential) {
      cached = null;
      try {
        await keychain.set(JSON.stringify(credential));
      } catch (error) {
        throw storeFailed(error);
      }
      // A file left from an earlier fallback would be a second, stale copy of a secret. The sign in is
      // saved by now, so failing to remove it is a warning, not a failed write.
      try {
        await file.clear();
      } catch {
        deps.warn(
          `Couldn't remove an old credentials file at ${credentialsFile(deps.dir)}. Delete it by hand.`
        );
      }
    },
    async clear() {
      cached = null;
      try {
        await keychain.delete();
      } catch (error) {
        throw storeFailed(error);
      }
      await file.clear();
    },
  };
}

export { openStore };
export type { SecretStore, StoredCredential };
