// A lock file shared by every taste process for one config folder. Refresh tokens rotate, so two
// processes refreshing the same session at once would leave one of them holding a dead token: one
// refreshes under the lock, the others wait and then read what it stored.
import { mkdir, open, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

type LockDeps = {
  now: () => number;
  sleep?: (ms: number) => Promise<void>;
};

// A refresh takes a second or two; a lock this old belongs to a process that died holding it.
const STALE_MS = 30_000;
const POLL_MS = 100;
const WAIT_MS = 10_000;

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

// true: we hold the lock. false: we waited long enough, or the folder can't hold a lock at all, and
// go ahead without it; the work re-reads the store either way.
async function acquire(path: string, deps: LockDeps): Promise<boolean> {
  const sleep = deps.sleep ?? ((ms: number) => delay(ms));
  const deadline = deps.now() + WAIT_MS;
  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  } catch {
    return false;
  }
  for (;;) {
    try {
      await (await open(path, "wx", 0o600)).close();
      return true;
    } catch (error) {
      if (errorCode(error) !== "EEXIST") return false;
    }
    if (await isStale(path)) {
      await rm(path, { force: true });
      continue;
    }
    if (deps.now() >= deadline) return false;
    await sleep(POLL_MS);
  }
}

async function withLock<T>(
  path: string,
  deps: LockDeps,
  work: () => Promise<T>
): Promise<T> {
  const held = await acquire(path, deps);
  try {
    return await work();
  } finally {
    if (held) await rm(path, { force: true }).catch(() => undefined);
  }
}

export { withLock };
export type { LockDeps };
