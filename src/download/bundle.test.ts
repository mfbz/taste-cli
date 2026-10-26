import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFakeApi } from "../api/fake-api.ts";
import { fixtures } from "../job-seams.ts";
import { SUBMISSION_MANIFEST } from "../api/schemas.ts";
import type { SubmissionManifest } from "../api/schemas.ts";
import { CliError } from "../output/errors.ts";
import { checkOutDir, safeJoin, writeBundle } from "./bundle.ts";

const ID = "00000000-0000-4000-8000-000000000100";
const CDN = "https://cdn.example.com/a/";
const HOSTILE = [
  "../x",
  "/etc/x",
  "a/../../x",
  "C:\\x",
  "C:x",
  "\\\\server\\x",
  "a\\..\\..\\x",
  "..",
  "a/..",
  "",
  "/",
  "a/\u0000b",
  "a/../b",
  ".. /x",
  "a/b. ",
];

let base: string;
let dir: string;

function manifest(files: SubmissionManifest["files"]): SubmissionManifest {
  return { submission_id: ID, extraction_id: null, files };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CliError) return error.code;
    throw error;
  }
  return "none";
}

async function listAll(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true });
  return entries.map((entry) => entry.split("\\").join("/")).sort();
}

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "taste-bundle-"));
  dir = join(base, "out");
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("safeJoin", () => {
  it.each(HOSTILE)("refuses %j as unsafe", (rel) => {
    expect(() => safeJoin("/root/out", rel)).toThrow(
      expect.objectContaining({ code: "BUNDLE_PATH_UNSAFE" })
    );
  });

  it("keeps a relative path inside the root", () => {
    expect(safeJoin("/root/out", "crawl/./css.css")).toBe(
      resolve("/root/out", "crawl", "css.css")
    );
  });
});

describe("writeBundle", () => {
  it("writes the recorded manifest's files at their paths, inline and downloaded", async () => {
    const recorded = SUBMISSION_MANIFEST.parse(
      fixtures.manifest?.data.manifest
    );
    const downloads: Record<string, Uint8Array> = {};
    for (const file of recorded.files)
      if (file.url) downloads[file.url] = new TextEncoder().encode(file.path);
    const api = createFakeApi({ downloads });
    const written = await writeBundle({
      api,
      manifest: recorded,
      dir,
      overwrite: false,
    });
    const paths = recorded.files.map((file) => file.path);
    expect([...written].sort()).toEqual([...paths].sort());
    for (const file of recorded.files) {
      const text = await readFile(join(dir, file.path), "utf8");
      expect(text).toBe(file.content ?? file.path);
    }
    expect(api.calls.filter((c) => c.startsWith("GET https:")).length).toBe(
      recorded.files.filter((file) => file.content == null).length
    );
  });

  it.each(HOSTILE)(
    "refuses a manifest naming %j and writes nothing",
    async (path) => {
      const api = createFakeApi();
      const code = await codeOf(
        writeBundle({
          api,
          manifest: manifest([
            { path: "ok.txt", content: "fine" },
            { path, content: "pwned" },
          ]),
          dir,
          overwrite: false,
        })
      );
      expect(code).toBe("BUNDLE_PATH_UNSAFE");
      expect(await listAll(base)).toEqual([]);
    }
  );

  it("refuses to write through a symlink planted in the folder", async () => {
    const outside = join(base, "outside");
    await mkdir(outside);
    await mkdir(dir);
    await symlink(outside, join(dir, "crawl"));
    const code = await codeOf(
      writeBundle({
        api: createFakeApi(),
        manifest: manifest([{ path: "crawl/x.css", content: "pwned" }]),
        dir,
        overwrite: true,
      })
    );
    expect(code).toBe("BUNDLE_PATH_UNSAFE");
    expect(await readdir(outside)).toEqual([]);
  });

  it("refuses to overwrite a symlinked file, leaving its target alone", async () => {
    const outside = join(base, "secret.txt");
    await writeFile(outside, "keep");
    await mkdir(dir);
    await symlink(outside, join(dir, "x.txt"));
    const code = await codeOf(
      writeBundle({
        api: createFakeApi(),
        manifest: manifest([{ path: "x.txt", content: "pwned" }]),
        dir,
        overwrite: true,
      })
    );
    expect(code).toBe("BUNDLE_PATH_UNSAFE");
    expect(await readFile(outside, "utf8")).toBe("keep");
  });

  it("refuses a file whose url points to a private host, writing nothing", async () => {
    const api = createFakeApi();
    const code = await codeOf(
      writeBundle({
        api,
        manifest: manifest([
          { path: "ok.txt", content: "fine" },
          { path: "meta.json", url: "https://169.254.169.254/latest" },
        ]),
        dir,
        overwrite: false,
      })
    );
    expect(code).toBe("BUNDLE_INVALID");
    expect(api.calls).toEqual([]);
    expect(await listAll(base)).toEqual([]);
  });

  it("refuses an http url, and an entry with nothing to save", async () => {
    for (const file of [
      { path: "a.css", url: "http://cdn.example.com/a.css" },
      { path: "b.css", url: null, content: null },
    ]) {
      const code = await codeOf(
        writeBundle({
          api: createFakeApi(),
          manifest: manifest([file]),
          dir,
          overwrite: false,
        })
      );
      expect(code).toBe("BUNDLE_INVALID");
    }
    expect(await listAll(base)).toEqual([]);
  });

  it("refuses two entries that would land on the same file", async () => {
    for (const files of [
      [
        { path: "a.txt", content: "1" },
        { path: "./A.txt", content: "2" },
      ],
      [
        { path: "a", content: "1" },
        { path: "a/b", content: "2" },
      ],
    ]) {
      const code = await codeOf(
        writeBundle({
          api: createFakeApi(),
          manifest: manifest(files),
          dir,
          overwrite: false,
        })
      );
      expect(code).toBe("BUNDLE_INVALID");
    }
    expect(await listAll(base)).toEqual([]);
  });

  it("uses inline content when an entry has both content and a url", async () => {
    const api = createFakeApi();
    const written = await writeBundle({
      api,
      manifest: manifest([
        { path: "guidelines.json", content: "{}", url: `${CDN}g.json` },
      ]),
      dir,
      overwrite: false,
    });
    expect(written).toEqual(["guidelines.json"]);
    expect(await readFile(join(dir, "guidelines.json"), "utf8")).toBe("{}");
    expect(api.calls).toEqual([]);
  });

  it("refuses a folder that already has files, unless told to overwrite", async () => {
    await mkdir(dir);
    await writeFile(join(dir, "old.txt"), "old");
    await writeFile(join(dir, "a.txt"), "old");
    const files = manifest([{ path: "a.txt", content: "new" }]);
    const api = createFakeApi();
    expect(
      await codeOf(writeBundle({ api, manifest: files, dir, overwrite: false }))
    ).toBe("OUTPUT_EXISTS");
    expect(await readFile(join(dir, "a.txt"), "utf8")).toBe("old");
    await writeBundle({ api, manifest: files, dir, overwrite: true });
    expect(await readFile(join(dir, "a.txt"), "utf8")).toBe("new");
    expect(await readFile(join(dir, "old.txt"), "utf8")).toBe("old");
  });

  it("reports what was saved when a download fails partway", async () => {
    const files = manifest([
      { path: "a.txt", content: "a" },
      { path: "b.css", url: `${CDN}b.css` },
      { path: "c.txt", content: "c" },
    ]);
    const error = await writeBundle({
      api: createFakeApi(),
      manifest: files,
      dir,
      overwrite: false,
      concurrency: 1,
    }).catch((e: unknown) => e);
    expect(error).toMatchObject({
      code: "BUNDLE_INCOMPLETE",
      params: { written: 1, total: 3, file: "b.css", id: ID },
    });
    expect(await listAll(dir)).toEqual(["a.txt"]);
  });

  it("removes a half-written file when a write fails", async () => {
    const failing: typeof open = async (path, flags, mode) => {
      const handle = await open(path, flags, mode);
      if (!String(path).endsWith("b.txt")) return handle;
      // Half the bytes reach the disk, then the disk is full.
      handle.writeFile = async (data) => {
        await handle.write((data as Uint8Array).subarray(0, 2));
        throw Object.assign(new Error("no space"), { code: "ENOSPC" });
      };
      return handle;
    };
    const error = await writeBundle({
      api: createFakeApi(),
      manifest: manifest([
        { path: "a.txt", content: "aaaa" },
        { path: "b.txt", content: "bbbb" },
      ]),
      dir,
      overwrite: false,
      concurrency: 1,
      open: failing,
    }).catch((e: unknown) => e);
    expect(error).toMatchObject({
      code: "BUNDLE_INCOMPLETE",
      params: { written: 1, total: 2, file: "b.txt" },
    });
    expect(await listAll(dir)).toEqual(["a.txt"]);
  });

  it("stops at Ctrl-C without starting another file", async () => {
    const interrupt = new AbortController();
    interrupt.abort();
    const error = await writeBundle({
      api: createFakeApi(),
      manifest: manifest([{ path: "a.txt", content: "a" }]),
      dir,
      overwrite: false,
      signal: interrupt.signal,
    }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "INTERRUPTED" });
    expect(await listAll(dir)).toEqual([]);
  });

  it("downloads at most four at a time", async () => {
    let running = 0;
    let most = 0;
    const api = createFakeApi();
    api.download = async () => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((settle) => setTimeout(settle, 5));
      running -= 1;
      return new Uint8Array([1]);
    };
    const files = Array.from({ length: 10 }, (_, i) => ({
      path: `f${i}.bin`,
      url: `${CDN}f${i}.bin`,
    }));
    const written = await writeBundle({
      api,
      manifest: manifest(files),
      dir,
      overwrite: false,
    });
    expect(written).toHaveLength(10);
    expect(most).toBe(4);
  });
});

describe("checkOutDir", () => {
  it("accepts a missing or empty folder and creates nothing", async () => {
    await checkOutDir(dir, false);
    await expect(lstat(dir)).rejects.toThrow();
    await mkdir(dir);
    await checkOutDir(dir, false);
  });

  it("refuses a folder with files unless told to overwrite", async () => {
    await mkdir(dir);
    await writeFile(join(dir, "x"), "");
    expect(await codeOf(checkOutDir(dir, false))).toBe("OUTPUT_EXISTS");
    await checkOutDir(dir, true);
  });

  it("refuses a path that is a file", async () => {
    await writeFile(dir, "");
    expect(await codeOf(checkOutDir(dir, true))).toBe("OUTPUT_UNUSABLE");
  });
});
