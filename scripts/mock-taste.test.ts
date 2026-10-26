import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { loadFixtures } from "../src/api/fixtures.ts";
import { runCli } from "../src/fake-io.ts";
import { createLibrary } from "./mock-data.ts";
import { startMock } from "./mock-server.ts";
import type { Mock, MockOptions } from "./mock-server.ts";

const KEY = ["taste", "mock", "test"].join("_");
const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const instant = () => Promise.resolve();

let mock: Mock | undefined;
let dir: string | undefined;

afterEach(async () => {
  await mock?.close();
  mock = undefined;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

async function start(
  options: Partial<MockOptions> & {
    onRequest?: (request: string) => void;
  } = {}
) {
  mock = await startMock({
    library: createLibrary({}),
    fast: true,
    ...options,
  });
  return mock;
}

describe("the mock Taste Engine", () => {
  function against(url: string) {
    return {
      env: { TASTE_API_URL: url, TASTE_API_KEY: KEY },
      fetch: globalThis.fetch,
      sleep: instant,
    };
  }

  it("runs taste extract, search, similar and enhance end to end through the real CLI", async () => {
    const { url } = await start();
    const extract = await runCli(
      ["extract", "https://stripe.com", "--json"],
      against(url)
    );
    expect(extract.err).toBe("");
    expect(extract.doc()).toMatchObject({
      ok: true,
      data: { status: "completed", source_url: "https://stripe.com/" },
    });
    for (const argv of [
      ["search", "calm fintech", "--json"],
      ["similar", "stripe.com", "--json"],
      ["enhance", "a pricing page", "--brand", "stripe.com", "--json"],
    ])
      expect((await runCli(argv, against(url))).doc().ok, argv[0]).toBe(true);
  });

  it("ends a real taste extract on Ctrl-C with 130 and one document naming taste wait", async () => {
    // Not fast: the job takes seconds per step, so the interrupt lands mid-wait. Ctrl-C goes in once
    // the mock has answered the first poll, so the job exists and the wait is underway.
    let interruptChild = () => {};
    const { url } = await start({
      fast: false,
      onRequest: (request) => {
        if (/^GET \/design\/submissions\/[^/]+$/.test(request))
          interruptChild();
      },
    });
    const child = spawn(
      process.execPath,
      [MAIN, "extract", "https://stripe.com", "--json"],
      {
        env: { PATH: process.env.PATH, TASTE_API_URL: url, TASTE_API_KEY: KEY },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    interruptChild = () => {
      interruptChild = () => {};
      child.kill("SIGINT");
    };
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    const code = await new Promise<number | null>((resolve) =>
      child.on("close", resolve)
    );
    expect(code).toBe(130);
    expect(stdout.trim().split("\n")).toHaveLength(1);
    const doc = JSON.parse(stdout) as {
      error: { code: string; hint: string; details: { id: string } };
    };
    expect(doc.error.code).toBe("INTERRUPTED");
    expect(doc.error.hint).toContain(`taste wait ${doc.error.details.id}`);
  });

  it("serves a manifest with every file inline, so --out never leaves this machine", async () => {
    const { url } = await start({ library: createLibrary(loadFixtures()) });
    const hosts = new Set<string>();
    const fetch: typeof globalThis.fetch = (input, init) => {
      hosts.add(new URL(input instanceof Request ? input.url : input).hostname);
      return globalThis.fetch(input, init);
    };
    dir = mkdtempSync(join(tmpdir(), "taste-mock-out-"));
    const { code } = await runCli(
      ["extract", "https://stripe.com", "--out", join(dir, "out"), "--json"],
      { ...against(url), fetch }
    );
    expect(code).toBe(0);
    expect([...hosts]).toEqual(["127.0.0.1"]);
  });
});
