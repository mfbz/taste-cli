import {
  chmod,
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
  "CON",
  "nul.txt",
  "a/com1.log",
  "LPT¹",
  "a<b",
  "a|b",
  "a?b",
  "a*b",
  'a"b',
  "a\u0085b",
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

  it("accepts names that merely start with two dots", () => {
    expect(safeJoin("/root/out", "..foo")).toBe(resolve("/root/out", "..foo"));
    expect(safeJoin("/root/out", "a/..b")).toBe(
      resolve("/root/out", "a", "..b")
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
    const { written } = await writeBundle({
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
      // The same name in composed and decomposed Unicode, which macOS treats as one file.
      [
        { path: "caf\u00e9.txt", content: "1" },
        { path: "cafe\u0301.txt", content: "2" },
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

  it("refuses a manifest of more than 2000 files", async () => {
    const files = Array.from({ length: 2001 }, (_, i) => ({
      path: `f${i}.txt`,
      content: "",
    }));
    const code = await codeOf(
      writeBundle({
        api: createFakeApi(),
        manifest: manifest(files),
        dir,
        overwrite: false,
      })
    );
    expect(code).toBe("BUNDLE_INVALID");
    expect(await listAll(base)).toEqual([]);
  });

  it.skipIf(process.platform === "win32")(
    "refuses a folder others can write to, already there, and makes new ones only for the person",
    async () => {
      await mkdir(join(dir, "shared"), { recursive: true });
      await chmod(join(dir, "shared"), 0o777);
      const code = await codeOf(
        writeBundle({
          api: createFakeApi(),
          manifest: manifest([{ path: "shared/x.css", content: "x" }]),
          dir,
          overwrite: true,
        })
      );
      expect(code).toBe("BUNDLE_PATH_UNSAFE");
      expect(await readdir(join(dir, "shared"))).toEqual([]);

      await chmod(dir, 0o777);
      const root = await codeOf(
        writeBundle({
          api: createFakeApi(),
          manifest: manifest([{ path: "x.css", content: "x" }]),
          dir,
          overwrite: true,
        })
      );
      expect(root).toBe("BUNDLE_PATH_UNSAFE");

      const fresh = join(base, "fresh");
      await writeBundle({
        api: createFakeApi(),
        manifest: manifest([{ path: "a/b/c.txt", content: "c" }]),
        dir: fresh,
        overwrite: false,
      });
      for (const folder of [fresh, join(fresh, "a"), join(fresh, "a", "b")])
        expect((await lstat(folder)).mode & 0o077).toBe(0);
    }
  );

  it("uses inline content when an entry has both content and a url", async () => {
    const api = createFakeApi();
    const { written } = await writeBundle({
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
    const api = createFakeApi();
    api.download = () =>
      Promise.reject(
        new CliError("DOWNLOAD_FAILED", { file: "b.css", status: 502 })
      );
    const error = await writeBundle({
      api,
      manifest: files,
      dir,
      overwrite: false,
      concurrency: 1,
    }).catch((e: unknown) => e);
    expect(error).toMatchObject({
      code: "BUNDLE_INCOMPLETE",
      params: { written: 1, skipped: 0, total: 3, file: "b.css" },
    });
    expect(await listAll(dir)).toEqual(["a.txt"]);
  });

  it("skips an asset that is gone for good and saves the rest", async () => {
    const api = createFakeApi();
    // A 403, as a brand's own CDN answered for one asset in a live run.
    api.download = (url) =>
      url.endsWith("gone.avif")
        ? Promise.reject(
            new CliError("DOWNLOAD_FAILED", { file: "gone.avif", status: 403 })
          )
        : Promise.resolve(new TextEncoder().encode("c"));
    const saved = await writeBundle({
      api,
      manifest: manifest([
        { path: "a.txt", content: "a" },
        { path: "media/gone.avif", url: `${CDN}gone.avif` },
        { path: "c.css", url: `${CDN}c.css` },
      ]),
      dir,
      overwrite: false,
      concurrency: 1,
    });
    expect(saved).toEqual({
      written: ["a.txt", "c.css"],
      skipped: [{ path: "media/gone.avif", status: 403 }],
    });
    expect(await listAll(dir)).toEqual(["a.txt", "c.css"]);
  });

  // A 5xx, a request timeout, too many requests and a network failure may all pass.
  it.each([503, 408, 429, "network"])(
    "stops on %s, which may pass, naming the file",
    async (status) => {
      const api = createFakeApi();
      api.download = () =>
        Promise.reject(
          new CliError("DOWNLOAD_FAILED", { file: "b.css", status })
        );
      const error = await writeBundle({
        api,
        manifest: manifest([
          { path: "a.txt", content: "a" },
          { path: "b.css", url: `${CDN}b.css` },
        ]),
        dir,
        overwrite: false,
        concurrency: 1,
      }).catch((e: unknown) => e);
      expect(error).toMatchObject({
        code: "BUNDLE_INCOMPLETE",
        params: { written: 1, skipped: 0, total: 2, file: "b.css" },
      });
    }
  );

  it("skips an asset over the size cap, and with --overwrite removes its older copy", async () => {
    await mkdir(dir);
    await writeFile(join(dir, "big.webm"), "older");
    const api = createFakeApi();
    api.download = () =>
      Promise.reject(new CliError("DOWNLOAD_TOO_LARGE", { file: "big.webm" }));
    const saved = await writeBundle({
      api,
      manifest: manifest([
        { path: "a.txt", content: "a" },
        { path: "big.webm", url: `${CDN}big.webm` },
      ]),
      dir,
      overwrite: true,
    });
    expect(saved.skipped).toEqual([{ path: "big.webm", status: "too large" }]);
    expect(await listAll(dir)).toEqual(["a.txt"]);
  });

  it("stops on a refused signed link, which a fresh run may fix", async () => {
    const api = createFakeApi();
    api.download = () =>
      Promise.reject(
        new CliError("DOWNLOAD_FAILED", { file: "full.jpg", status: 403 })
      );
    const error = await writeBundle({
      api,
      manifest: manifest([
        { path: "crawl/full.jpg", url: `${CDN}full.jpg?token=signed` },
      ]),
      dir,
      overwrite: false,
    }).catch((e: unknown) => e);
    expect(error).toMatchObject({
      code: "BUNDLE_INCOMPLETE",
      params: { written: 0, skipped: 0, total: 1, file: "crawl/full.jpg" },
    });
  });

  it.each([
    ["https://brand.example/a.css?v=1", "skipped"],
    ["https://brand.example/_next/image?url=%2Fa.png&w=640", "skipped"],
    ["https://cdn.example.com/x.jpg?token=abc", "fails"],
    [
      "https://bucket.example.com/x.jpg?X-Amz-Signature=abc&X-Amz-Expires=60",
      "fails",
    ],
    [
      "https://cdn.example.com/x.jpg?Expires=1&Signature=abc&Key-Pair-Id=k",
      "fails",
    ],
  ])("a 403 from %s is %s", async (url, outcome) => {
    const api = createFakeApi();
    api.download = () =>
      Promise.reject(
        new CliError("DOWNLOAD_FAILED", { file: "x", status: 403 })
      );
    const result = await writeBundle({
      api,
      manifest: manifest([{ path: "x.bin", url }]),
      dir,
      overwrite: false,
    }).then(
      (saved) => saved.skipped.map((s) => s.path).join(),
      (e: unknown) => (e instanceof CliError ? e.code : "other")
    );
    expect(result).toBe(outcome === "skipped" ? "x.bin" : "BUNDLE_INCOMPLETE");
  });

  it("names a skipped file whose older copy can't be removed", async () => {
    await mkdir(join(dir, "gone.css"), { recursive: true });
    await writeFile(join(dir, "gone.css", "inner"), "");
    const api = createFakeApi();
    api.download = () =>
      Promise.reject(
        new CliError("DOWNLOAD_FAILED", { file: "gone.css", status: 404 })
      );
    const error = await writeBundle({
      api,
      manifest: manifest([{ path: "gone.css", url: `${CDN}gone.css` }]),
      dir,
      overwrite: true,
    }).catch((e: unknown) => e);
    expect(error).toMatchObject({
      code: "BUNDLE_INCOMPLETE",
      params: { written: 0, total: 1, file: "gone.css" },
    });
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
      params: { written: 1, skipped: 0, total: 2, file: "b.txt" },
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
    const { written } = await writeBundle({
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
