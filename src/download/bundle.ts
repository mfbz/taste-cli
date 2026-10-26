// Saves a finished extraction's files (its download manifest) into a folder the person named. Every
// path and URL in the manifest is the server's, so all of them are checked before anything is written:
// a path must stay inside the folder, a URL must be public https. Writing never follows a symlink: each
// folder inside the output is checked with lstat, and each file is created with "wx", which fails on
// anything already there, a symlink included.
import { lstat, mkdir, open, readdir, realpath, rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

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
type Planned = {
  // Relative, joined with "/", as reported back.
  rel: string;
  segments: string[];
  content?: string;
  url?: string;
};

const CONCURRENCY = 4;
// A drive ("C:"), an NTFS stream ("a:b") or a control character. A trailing dot or space is dropped by
// Windows, so ".. " would become "..".
const BAD_SEGMENT = /[:\u0000-\u001f\u007f]|[. ]$/;

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
    if (segment === ".." || BAD_SEGMENT.test(segment)) throw unsafe();
  return segments;
}

// The absolute path for rel inside root, or BUNDLE_PATH_UNSAFE. ".." is refused outright rather than
// resolved, so no path can climb, even one that would come back down.
function safeJoin(root: string, rel: string): string {
  const target = resolve(root, ...segmentsOf(rel));
  const back = relative(resolve(root), target);
  if (back === "" || back.startsWith("..") || isAbsolute(back)) throw unsafe();
  return target;
}

function isPublicHttps(raw: string): boolean {
  const url = URL.parse(raw);
  return url?.protocol === "https:" && !isPrivateHost(url.hostname);
}

// Every entry checked before anything is written: a safe path, something to save, a public https
// URL, and no two entries landing on the same file (compared without case, as macOS and Windows do).
function plan(manifest: SubmissionManifest): Planned[] {
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
    const key = segments.join("/").toLowerCase();
    if (files.has(key) || folders.has(key))
      throw new CliError("BUNDLE_INVALID");
    files.add(key);
    for (let i = 1; i < segments.length; i += 1)
      folders.add(segments.slice(0, i).join("/").toLowerCase());
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

// Each folder from root down to the file's: a real folder, never a symlink. With create, a missing one
// is made (one level at a time, so a symlink planted meanwhile is still caught by the lstat after).
async function walk(
  root: string,
  segments: string[],
  create: boolean
): Promise<void> {
  let path = root;
  for (const segment of segments.slice(0, -1)) {
    path = join(path, segment);
    let info = await lstatOrNull(path);
    if (info === null) {
      if (!create) return;
      try {
        await mkdir(path);
      } catch (error) {
        if (!isErrno(error, "EEXIST")) throw error;
      }
      info = await lstat(path);
    }
    if (info.isSymbolicLink() || !info.isDirectory()) throw unsafe();
  }
  const target = await lstatOrNull(join(path, segments.at(-1) ?? ""));
  if (target?.isSymbolicLink()) throw unsafe();
}

// Before a paid job starts, so a folder that can't take the files costs nothing. Creates nothing.
async function checkOutDir(dir: string, overwrite: boolean): Promise<void> {
  let entries: string[];
  try {
    const info = await lstatOrNull(resolve(dir));
    if (info === null) return;
    entries = await readdir(dir);
  } catch (error) {
    throw new CliError("OUTPUT_UNUSABLE", {}, { cause: error });
  }
  if (entries.length > 0 && !overwrite) throw new CliError("OUTPUT_EXISTS");
}

async function openRoot(dir: string, overwrite: boolean): Promise<string> {
  await checkOutDir(dir, overwrite);
  try {
    await mkdir(dir, { recursive: true });
    // The folder the person named may itself be a symlink (macOS's /tmp is); what is inside may not.
    return await realpath(dir);
  } catch (error) {
    throw new CliError("OUTPUT_UNUSABLE", {}, { cause: error });
  }
}

async function writeBundle(deps: BundleDeps): Promise<string[]> {
  const { api, manifest, overwrite, signal } = deps;
  const openFile = deps.open ?? open;
  const planned = plan(manifest);
  const root = await openRoot(deps.dir, overwrite);
  try {
    for (const file of planned) await walk(root, file.segments, false);
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError("OUTPUT_UNUSABLE", {}, { cause: error });
  }

  const written: string[] = [];
  // The first file that failed; others running at the time may fail too, but are not the cause.
  let failed: string | undefined;
  async function save(file: Planned): Promise<void> {
    if (signal?.aborted) throw new CliError("INTERRUPTED");
    try {
      await saveOne(file);
    } catch (error) {
      failed ??= file.rel;
      throw error;
    }
    written.push(file.rel);
  }
  async function saveOne(file: Planned): Promise<void> {
    const bytes =
      file.content === undefined
        ? await api.download(file.url ?? "")
        : new TextEncoder().encode(file.content);
    const target = safeJoin(root, file.rel);
    await walk(root, file.segments, true);
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
        total: planned.length,
        file: failed ?? "…",
        id: manifest.submission_id,
      },
      { cause: error }
    );
  }
  return written;
}

export { checkOutDir, safeJoin, writeBundle };
