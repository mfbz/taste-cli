// Saves a finished extraction's files (its download manifest) into a folder the person named. Every
// path and URL in the manifest is the server's, so all of them are checked before anything is written:
// a path must stay inside the folder, a URL must be public https. Writing never follows a symlink: each
// folder inside the output is checked with lstat, and each file is created with "wx", which fails on
// anything already there, a symlink included. On POSIX, a folder taste didn't create in this run must
// also be the person's own and not writable by others, so no one else can swap it for a symlink
// between the check and the write.
import type { Stats } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import type { TasteApi } from "../api/client.ts";
import type { SubmissionManifest } from "../api/schemas.ts";
import { isPrivateHost } from "../api/urls.ts";
import { CliError } from "../output/errors.ts";
import { mapLimit } from "../pool.ts";

type BundleDeps = {
  api: TasteApi;
  manifest: SubmissionManifest;
  dir: string;
  overwrite: boolean;
  concurrency?: number;
  // Ctrl-C: no new file starts.
  signal?: AbortSignal;
  // A seam for tests that make a write fail halfway.
  open?: typeof open;
};
type Skipped = { path: string; status: number | "too large" };
type Saved = { written: string[]; skipped: Skipped[] };
type Planned = {
  // Relative, joined with "/", as reported back.
  rel: string;
  segments: string[];
  content?: string;
  url?: string;
};

const CONCURRENCY = 4;
// A manifest is one extraction's files; far more than this is not one.
const MAX_FILES = 2000;
// A drive ("C:"), an NTFS stream ("a:b"), a character Windows refuses in a name, or a control
// character (C0, DEL, C1). A trailing dot or space is dropped by Windows, so ".. " would become "..".
const BAD_SEGMENT = /[:<>"|?*\u0000-\u001f\u007f-\u009f]|[. ]$/;
// Device names Windows opens instead of a file, with any extension. Refused everywhere, so a bundle
// saved on one system can be copied to another.
const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;
const NEW_FOLDER_MODE = 0o700;

// The one rule for a download that fails. Skipped, as gone for good: an asset over the size cap (it
// is as large on every run), and a 4xx other than 408 and 429 from an unsigned address (a brand's own
// site that no longer serves it). Everything else stops the save, since a later run may succeed: a
// network failure, a timeout, a 5xx, 408 or 429, and any refusal of a signed link (one with a query),
// whose signature may simply have expired; each run gets fresh links. Returns the skip's status.
function goneForGood(
  error: unknown,
  url: string
): Skipped["status"] | undefined {
  if (!(error instanceof CliError)) return undefined;
  if (error.code === "DOWNLOAD_TOO_LARGE") return "too large";
  if (error.code !== "DOWNLOAD_FAILED" || URL.parse(url)?.search)
    return undefined;
  const status = error.params.status;
  if (typeof status !== "number" || status < 400 || status > 499)
    return undefined;
  return status === 408 || status === 429 ? undefined : status;
}

function unsafe(): CliError {
  return new CliError("BUNDLE_PATH_UNSAFE");
}

function isErrno(error: unknown, code: string): boolean {
  return (
    error instanceof Error && (error as NodeJS.ErrnoException).code === code
  );
}

// Both separators count, whatever the platform: a manifest written for one may be read on the other.
function segmentsOf(rel: string): string[] {
  if (rel === "" || /^[\\/]/.test(rel) || /^[A-Za-z]:/.test(rel))
    throw unsafe();
  const segments = rel.split(/[\\/]/).filter((s) => s !== "" && s !== ".");
  if (segments.length === 0) throw unsafe();
  for (const segment of segments)
    if (segment === ".." || BAD_SEGMENT.test(segment) || RESERVED.test(segment))
      throw unsafe();
  return segments;
}

// The absolute path for rel inside root, or BUNDLE_PATH_UNSAFE. ".." is refused outright rather than
// resolved, so no path can climb, even one that would come back down.
function safeJoin(root: string, rel: string): string {
  const target = resolve(root, ...segmentsOf(rel));
  const back = relative(resolve(root), target);
  if (
    back === "" ||
    back === ".." ||
    back.startsWith(`..${sep}`) ||
    isAbsolute(back)
  )
    throw unsafe();
  return target;
}

function isPublicHttps(raw: string): boolean {
  const url = URL.parse(raw);
  return url?.protocol === "https:" && !isPrivateHost(url.hostname);
}

// Every entry checked before anything is written: a safe path, something to save, a public https
// URL, and no two entries landing on the same file (compared without case, as macOS and Windows do).
function plan(manifest: SubmissionManifest): Planned[] {
  if (manifest.files.length > MAX_FILES) throw new CliError("BUNDLE_INVALID");
  const planned = manifest.files.map((file): Planned => {
    const segments = segmentsOf(file.path);
    const rel = segments.join("/");
    if (typeof file.content === "string")
      return { rel, segments, content: file.content };
    if (typeof file.url === "string" && isPublicHttps(file.url))
      return { rel, segments, url: file.url };
    throw new CliError("BUNDLE_INVALID");
  });
  const files = new Set<string>();
  const folders = new Set<string>();
  for (const { segments } of planned) {
    const key = segments.join("/").normalize("NFC").toLowerCase();
    if (files.has(key) || folders.has(key))
      throw new CliError("BUNDLE_INVALID");
    files.add(key);
    for (let i = 1; i < segments.length; i += 1)
      folders.add(
        segments.slice(0, i).join("/").normalize("NFC").toLowerCase()
      );
  }
  for (const folder of folders)
    if (files.has(folder)) throw new CliError("BUNDLE_INVALID");
  return planned;
}

async function lstatOrNull(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if (isErrno(error, "ENOENT")) return null;
    throw error;
  }
}

// A folder taste may write in: a real folder, never a symlink, and unless taste made it in this run,
// on POSIX the person's own and not writable by others. Windows has no such mode bits to read.
function checkFolder(path: string, info: Stats, created: Set<string>): void {
  if (info.isSymbolicLink() || !info.isDirectory()) throw unsafe();
  if (process.platform === "win32" || created.has(path)) return;
  if (info.uid !== process.getuid?.() || (info.mode & 0o002) !== 0)
    throw unsafe();
}

// Each folder from root down to the file's, checked. With create, a missing one is made, readable
// only by the person (one level at a time, so a symlink planted meanwhile is caught by the lstat after).
async function walk(
  root: string,
  segments: string[],
  create: boolean,
  created: Set<string>
): Promise<void> {
  let path = root;
  for (const segment of segments.slice(0, -1)) {
    path = join(path, segment);
    let info = await lstatOrNull(path);
    if (info === null) {
      if (!create) return;
      try {
        await mkdir(path, { mode: NEW_FOLDER_MODE });
        created.add(path);
      } catch (error) {
        if (!isErrno(error, "EEXIST")) throw error;
      }
      info = await lstat(path);
    }
    checkFolder(path, info, created);
  }
  const target = await lstatOrNull(join(path, segments.at(-1) ?? ""));
  if (target?.isSymbolicLink()) throw unsafe();
}

// Before a paid job starts, so a folder that can't take the files costs nothing. Creates nothing.
async function checkOutDir(dir: string, overwrite: boolean): Promise<void> {
  let entries: string[];
  let real: string;
  let info: Stats;
  try {
    if ((await lstatOrNull(resolve(dir))) === null) return;
    entries = await readdir(dir);
    real = await realpath(dir);
    info = await lstat(real);
  } catch (error) {
    throw new CliError("OUTPUT_UNUSABLE", {}, { cause: error });
  }
  // A folder that is there already must be the person's own, checked before anything is paid for.
  checkFolder(real, info, new Set());
  if (entries.length > 0 && !overwrite) throw new CliError("OUTPUT_EXISTS");
}

async function openRoot(
  dir: string,
  overwrite: boolean,
  created: Set<string>
): Promise<string> {
  await checkOutDir(dir, overwrite);
  let root: string;
  let info: Stats;
  try {
    const made = await mkdir(dir, { recursive: true, mode: NEW_FOLDER_MODE });
    // The folder the person named may itself be a symlink (macOS's /tmp is); what is inside may not.
    root = await realpath(dir);
    if (made !== undefined) created.add(root);
    info = await lstat(root);
  } catch (error) {
    throw new CliError("OUTPUT_UNUSABLE", {}, { cause: error });
  }
  checkFolder(root, info, created);
  return root;
}

async function writeBundle(deps: BundleDeps): Promise<Saved> {
  const { api, manifest, overwrite, signal } = deps;
  const openFile = deps.open ?? open;
  const planned = plan(manifest);
  // Folders made in this run: the ownership check is for those that were already there.
  const created = new Set<string>();
  const root = await openRoot(deps.dir, overwrite, created);
  try {
    for (const file of planned) await walk(root, file.segments, false, created);
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError("OUTPUT_UNUSABLE", {}, { cause: error });
  }

  const written: string[] = [];
  const skipped: Skipped[] = [];
  // The first file that failed; others running at the time may fail too, but are not the cause.
  let failed: string | undefined;
  async function save(file: Planned): Promise<void> {
    if (signal?.aborted) throw new CliError("INTERRUPTED");
    try {
      await saveOne(file);
    } catch (error) {
      const status = goneForGood(error, file.url ?? "");
      if (status !== undefined) {
        // With --overwrite an older copy would otherwise stay, as if it were this result's.
        if (overwrite) await removeStale(file);
        skipped.push({ path: file.rel, status });
        return;
      }
      failed ??= file.rel;
      throw error;
    }
    written.push(file.rel);
  }
  async function removeStale(file: Planned): Promise<void> {
    await walk(root, file.segments, false, created);
    await rm(safeJoin(root, file.rel), { force: true });
  }
  async function saveOne(file: Planned): Promise<void> {
    const bytes =
      file.content === undefined
        ? await api.download(file.url ?? "")
        : new TextEncoder().encode(file.content);
    const target = safeJoin(root, file.rel);
    await walk(root, file.segments, true, created);
    // Removed rather than opened with "w", which would follow a symlink put there since the check.
    if (overwrite) await rm(target, { force: true });
    const handle = await openFile(target, "wx");
    try {
      await handle.writeFile(bytes);
      await handle.close();
    } catch (error) {
      // Never leave a half-written file looking like a whole one.
      await handle.close().catch(() => {});
      await rm(target, { force: true });
      throw error;
    }
  }

  try {
    await mapLimit(planned, deps.concurrency ?? CONCURRENCY, save);
  } catch (error) {
    if (
      error instanceof CliError &&
      (error.code === "INTERRUPTED" || error.code === "BUNDLE_PATH_UNSAFE")
    )
      throw error;
    throw new CliError(
      "BUNDLE_INCOMPLETE",
      {
        written: written.length,
        skipped: skipped.length,
        total: planned.length,
        file: failed ?? "…",
      },
      { cause: error }
    );
  }
  return { written, skipped };
}

export { checkOutDir, safeJoin, writeBundle };
export type { Saved, Skipped };
