// A lock file shared by every taste process for one config folder. Refresh tokens rotate, so two
// processes refreshing the same session at once would leave one of them holding a dead token: one
// refreshes under the lock, the others wait and then read what it stored.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

type LockDeps = {
  now: () => number;
  sleep?: (ms: number) => Promise<void>;
};

// The holder's work is bounded (REFRESH_BUDGET_MS in oauth.ts), so a waiter outlasts any live
// holder, and a lock older than that belongs to a process that died holding it.
const WAIT_MS = 25_000;
const STALE_MS = 30_000;
const POLL_MS = 100;

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

// Against the system clock, not deps.now(): a file's mtime is written by that clock.
async function isStale(path: string): Promise<boolean> {
  try {
    return (await stat(path)).mtimeMs < Date.now() - STALE_MS;
  } catch {
    return false;
  }
}

// Our own token in the file, so we only ever remove a lock we still hold.
async function release(path: string, token: string): Promise<void> {
  try {
    if ((await readFile(path, "utf8")) === token) await rm(path);
  } catch {
    // Gone already, or not ours to remove.
  }
}

// A token: we hold the lock. null: we waited as long as any live holder could take, or the folder
// can't hold a lock at all, and go ahead without it; the work re-reads the store either way.
async function acquire(path: string, deps: LockDeps): Promise<string | null> {
  const sleep = deps.sleep ?? ((ms: number) => delay(ms));
  const deadline = deps.now() + WAIT_MS;
  const token = randomBytes(16).toString("hex");
  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  } catch {
    return null;
  }
  for (;;) {
    try {
      await writeFile(path, token, { flag: "wx", mode: 0o600 });
      return token;
    } catch (error) {
      if (errorCode(error) !== "EEXIST") return null;
    }
    if (await isStale(path)) {
      await rm(path, { force: true });
      continue;
    }
    if (deps.now() >= deadline) return null;
    await sleep(POLL_MS);
  }
}

async function withLock<T>(
  path: string,
  deps: LockDeps,
  work: () => Promise<T>
): Promise<T> {
  const token = await acquire(path, deps);
  try {
    return await work();
  } finally {
    if (token) await release(path, token);
  }
}

export { WAIT_MS, withLock };
export type { LockDeps };
