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
import type { FakeApi } from "../api/fake-api.ts";
import { SUBMISSION_MANIFEST } from "../api/schemas.ts";
import type { SubmissionManifest } from "../api/schemas.ts";
import { fixtures } from "../job-seams.ts";
import { CliError } from "../output/errors.ts";
import { checkOutDir, safeJoin, writeBundle } from "./bundle.ts";

type Files = SubmissionManifest["files"];
type SaveOptions = Partial<Parameters<typeof writeBundle>[0]>;

const CDN = "https://cdn.example.com/a/";
const HOSTILE = [
  ...["../x", "/etc/x", "a/../../x", "a/../b", "..", "", "/", ".. /x"],
  ...["C:\\x", "C:x", "\\\\server\\x", "a\\..\\..\\x", "a/b. "],
  ...["CON", "nul.txt", "a/com1.log", "LPT¹"],
  ...["a<b", "a|b", "a?b", "a*b", 'a"b', "a/\u0000b", "a\u0085b"],
];

let base: string;
let dir: string;

function save(files: Files, options: SaveOptions = {}) {
  return writeBundle({
    api: createFakeApi(),
    manifest: { submission_id: "sub-1", files },
    dir,
    overwrite: false,
    concurrency: 1,
    ...options,
  });
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

// An API whose downloads all fail with this status.
function failing(status: number | string): FakeApi {
  const api = createFakeApi();
  api.download = () =>
    Promise.reject(new CliError("DOWNLOAD_FAILED", { file: "x", status }));
  return api;
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
  it("refuses every hostile path", () => {
    for (const rel of HOSTILE)
      expect(() => safeJoin("/root/out", rel), rel).toThrow(
        expect.objectContaining({ code: "BUNDLE_PATH_UNSAFE" })
      );
  });

  it("keeps a relative path inside the root, names starting with two dots included", () => {
    expect(safeJoin("/root/out", "a/./..foo")).toBe(
      resolve("/root/out", "a", "..foo")
    );
  });
});

describe("writeBundle", () => {
  it("writes the recorded manifest's files at their paths, downloading only its URL entries", async () => {
    const recorded = SUBMISSION_MANIFEST.parse(
      fixtures.manifest?.data.manifest
    );
    const downloads: Record<string, Uint8Array> = {};
    for (const file of recorded.files)
      if (file.url) downloads[file.url] = new TextEncoder().encode(file.path);
    const api = createFakeApi({ downloads });
    await writeBundle({ api, manifest: recorded, dir, overwrite: false });
    for (const file of recorded.files)
      expect(await readFile(join(dir, file.path), "utf8")).toBe(
        file.content ?? file.path
      );
    expect(api.calls.length).toBe(
      recorded.files.filter((file) => file.content == null).length
    );
  });

  it("uses inline content when an entry has both content and a url", async () => {
    await save([{ path: "g.json", content: "{}", url: `${CDN}g.json` }]);
    expect(await readFile(join(dir, "g.json"), "utf8")).toBe("{}");
  });

  it("refuses a manifest naming a hostile path and writes nothing", async () => {
    for (const path of HOSTILE) {
      const files = [
        { path: "ok.txt", content: "fine" },
        { path, content: "pwned" },
      ];
      expect(await codeOf(save(files)), path).toBe("BUNDLE_PATH_UNSAFE");
    }
    expect(await listAll(base)).toEqual([]);
  });

  it("refuses an invalid manifest before any download or write", async () => {
    const cases: Files[] = [
      [{ path: "meta.json", url: "https://169.254.169.254/latest" }],
      [{ path: "a.css", url: "http://cdn.example.com/a.css" }],
      [{ path: "b.css", url: null, content: null }],
      [
        { path: "a.txt", content: "1" },
        { path: "./A.txt", content: "2" },
      ],
      [
        { path: "a", content: "1" },
        { path: "a/b", content: "2" },
      ],
      // One name in composed and decomposed Unicode, which macOS treats as one file.
      [
        { path: "caf\u00e9.txt", content: "1" },
        { path: "cafe\u0301.txt", content: "2" },
      ],
      Array.from({ length: 2001 }, (_, i) => ({ path: `f${i}`, content: "" })),
    ];
    for (const files of cases) {
      const api = createFakeApi();
      expect(await codeOf(save(files, { api }))).toBe("BUNDLE_INVALID");
      expect(api.calls).toEqual([]);
    }
    expect(await listAll(base)).toEqual([]);
  });

  it("never writes through a symlink planted in the folder", async () => {
    const outside = join(base, "outside");
    await mkdir(outside);
    await writeFile(join(base, "secret.txt"), "keep");
    await mkdir(dir);
    await symlink(outside, join(dir, "crawl"));
    await symlink(join(base, "secret.txt"), join(dir, "x.txt"));
    for (const path of ["crawl/x.css", "x.txt"])
      expect(
        await codeOf(save([{ path, content: "pwned" }], { overwrite: true }))
      ).toBe("BUNDLE_PATH_UNSAFE");
    expect(await readdir(outside)).toEqual([]);
    expect(await readFile(join(base, "secret.txt"), "utf8")).toBe("keep");
  });

  it.skipIf(process.platform === "win32")(
    "refuses a folder others can write to, and makes new ones only for the person",
    async () => {
      await mkdir(join(dir, "shared"), { recursive: true });
      await chmod(join(dir, "shared"), 0o777);
      const files = [{ path: "shared/x.css", content: "x" }];
      expect(await codeOf(save(files, { overwrite: true }))).toBe(
        "BUNDLE_PATH_UNSAFE"
      );
      await save([{ path: "a/b/c.txt", content: "c" }], {
        dir: join(base, "new"),
      });
      for (const folder of ["new", "new/a", "new/a/b"])
        expect((await lstat(join(base, folder))).mode & 0o077).toBe(0);
    }
  );

  it("replaces only files of the same name with --overwrite", async () => {
    await mkdir(dir);
    await writeFile(join(dir, "old.txt"), "old");
    await writeFile(join(dir, "a.txt"), "old");
    const files = [{ path: "a.txt", content: "new" }];
    expect(await codeOf(save(files))).toBe("OUTPUT_EXISTS");
    await save(files, { overwrite: true });
    expect(await readFile(join(dir, "a.txt"), "utf8")).toBe("new");
    expect(await readFile(join(dir, "old.txt"), "utf8")).toBe("old");
  });

  it("stops on a download failure that may pass, saying what was saved", async () => {
    for (const status of [502, 503, 408, 429, "network"]) {
      await rm(dir, { recursive: true, force: true });
      const error = await save(
        [
          { path: "a.txt", content: "a" },
          { path: "b.css", url: `${CDN}b.css` },
          { path: "c.txt", content: "c" },
        ],
        { api: failing(status) }
      ).catch((e: unknown) => e);
      expect(error, String(status)).toMatchObject({
        code: "BUNDLE_INCOMPLETE",
        params: { written: 1, skipped: 0, total: 3, file: "b.css" },
      });
    }
  });

  it("skips an unsigned asset refused for good, but never a signed link", async () => {
    const cases = [
      ["https://brand.example/a.css?v=1", "skipped"],
      ["https://brand.example/_next/image?url=%2Fa.png&w=640", "skipped"],
      ["https://cdn.example.com/x.jpg?token=abc", "BUNDLE_INCOMPLETE"],
      ["https://b.example.com/x.jpg?X-Amz-Signature=abc", "BUNDLE_INCOMPLETE"],
      [
        "https://c.example.com/x.jpg?Signature=a&Key-Pair-Id=k",
        "BUNDLE_INCOMPLETE",
      ],
    ] as const;
    for (const [url, outcome] of cases) {
      await rm(dir, { recursive: true, force: true });
      const result = await save(
        [
          { path: "a.txt", content: "a" },
          { path: "x.bin", url },
        ],
        { api: failing(403) }
      ).then(
        (saved) => {
          expect(saved.skipped).toEqual([{ path: "x.bin", status: 403 }]);
          return "skipped";
        },
        (e: unknown) => (e instanceof CliError ? e.code : "other")
      );
      expect(result, url).toBe(outcome);
      expect(await listAll(dir)).toEqual(["a.txt"]);
    }
  });

  it("skips an asset over the size cap, and with --overwrite removes its older copy", async () => {
    await mkdir(dir);
    await writeFile(join(dir, "big.webm"), "older");
    const api = createFakeApi();
    api.download = () =>
      Promise.reject(new CliError("DOWNLOAD_TOO_LARGE", { file: "big.webm" }));
    const saved = await save([{ path: "big.webm", url: `${CDN}big.webm` }], {
      api,
      overwrite: true,
    });
    expect(saved.skipped).toEqual([{ path: "big.webm", status: "too large" }]);
    expect(await listAll(dir)).toEqual([]);
  });

  it("removes a half-written file when a write fails", async () => {
    const halfway: typeof open = async (path, flags, mode) => {
      const handle = await open(path, flags, mode);
      if (!String(path).endsWith("b.txt")) return handle;
      // Half the bytes reach the disk, then the disk is full.
      handle.writeFile = async (data) => {
        await handle.write((data as Uint8Array).subarray(0, 2));
        throw Object.assign(new Error("no space"), { code: "ENOSPC" });
      };
      return handle;
    };
    const error = await save(
      [
        { path: "a.txt", content: "aaaa" },
        { path: "b.txt", content: "bbbb" },
      ],
      { open: halfway }
    ).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "BUNDLE_INCOMPLETE" });
    expect(await listAll(dir)).toEqual(["a.txt"]);
  });

  it("stops at Ctrl-C without starting another file", async () => {
    const interrupt = new AbortController();
    interrupt.abort();
    const files = [{ path: "a.txt", content: "a" }];
    expect(await codeOf(save(files, { signal: interrupt.signal }))).toBe(
      "INTERRUPTED"
    );
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
    await save(files, { api, concurrency: undefined });
    expect(most).toBe(4);
  });
});

describe("checkOutDir", () => {
  it("accepts a missing or empty folder, and refuses one with files or a file", async () => {
    await checkOutDir(dir, false);
    await mkdir(dir);
    await checkOutDir(dir, false);
    await writeFile(join(dir, "x"), "");
    expect(await codeOf(checkOutDir(dir, false))).toBe("OUTPUT_EXISTS");
    await checkOutDir(dir, true);
    expect(await codeOf(checkOutDir(join(dir, "x"), true))).toBe(
      "OUTPUT_UNUSABLE"
    );
  });
});
