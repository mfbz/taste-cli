import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { EMAIL, fakeOAuth, memoryStore } from "../auth/fake-oauth.ts";
import { fakeMe, runCli } from "../fake-io.ts";
import type { Io } from "../io.ts";

// Built at run time so the guards never see a key-shaped literal.
const KEY = ["taste", "TESTKEY", "x".repeat(16)].join("_");

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "taste-login-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function seams(overrides: Partial<Io> = {}) {
  const store = memoryStore();
  const me = fakeMe(KEY);
  const io: Partial<Io> = {
    fetch: me.fetch,
    store: () => Promise.resolve(store),
    configDir: dir,
    now: () => 1_800_000_000_000,
    ...overrides,
  };
  return { io, store, me };
}

describe("taste login --with-api-key", () => {
  it("reads the key from stdin, checks it with Taste and stores it, never printing it", async () => {
    for (const json of [false, true]) {
      const { io, store, me } = seams({
        stdinText: () => Promise.resolve(`  ${KEY}\n`),
      });
      const argv = ["login", "--with-api-key", ...(json ? ["--json"] : [])];
      const { code, out, err, doc } = await runCli(argv, io);
      expect(code).toBe(0);
      expect(store.value).toEqual({ kind: "key", apiKey: KEY });
      expect(me.calls).toHaveLength(1);
      expect(me.calls[0]?.url).toBe("https://api.tastelabs.com/design/me");
      expect(me.calls[0]?.headers.get("x-api-key")).toBe(KEY);
      expect(out + err).not.toContain(KEY);
      if (json)
        expect(doc().data).toEqual({
          method: "key",
          email: "person@example.com",
          store: "keychain",
        });
      else expect(out).toContain("Signed in as person@example.com");
    }
  });

  it("stores nothing when Taste does not accept the key", async () => {
    const { io, store } = seams({
      stdinText: () =>
        Promise.resolve(["taste", "wrong", "k".repeat(16)].join("_")),
    });
    const { code, doc } = await runCli(
      ["login", "--with-api-key", "--json"],
      io
    );
    expect(code).toBe(1);
    expect(doc().error.code).toBe("INVALID_API_KEY");
    expect(store.value).toBeNull();
  });

  it("refuses empty input or more than one word before calling Taste", async () => {
    for (const text of ["", "  \n", `${KEY} ${KEY}`]) {
      const { io, store, me } = seams({
        stdinText: () => Promise.resolve(text),
      });
      const { code, out, err, doc } = await runCli(
        ["login", "--with-api-key", "--json"],
        io
      );
      expect(code).toBe(2);
      expect(doc().error.code).toBe("INVALID_KEY_INPUT");
      expect(out + err).not.toContain(KEY);
      expect(me.calls).toHaveLength(0);
      expect(store.value).toBeNull();
    }
  });

  it("says how to end the input when stdin is a terminal, and only then", async () => {
    for (const interactive of [true, false]) {
      const { io } = seams({
        interactive,
        stdinText: () => Promise.resolve(KEY),
      });
      const { code, err } = await runCli(["login", "--with-api-key"], io);
      expect(code).toBe(0);
      if (interactive) expect(err).toContain("End with Ctrl-D");
      else expect(err).not.toContain("Ctrl-D");
    }
  });

  it("uses TASTE_API_URL for the check", async () => {
    const { io, me } = seams({
      stdinText: () => Promise.resolve(KEY),
      env: { TASTE_API_URL: "http://127.0.0.1:8787" },
    });
    expect((await runCli(["login", "--with-api-key"], io)).code).toBe(0);
    expect(me.calls[0]?.url).toBe("http://127.0.0.1:8787/design/me");
  });

  it("notes that TASTE_API_KEY overrides what it stores", async () => {
    const { io } = seams({
      stdinText: () => Promise.resolve(KEY),
      env: { TASTE_API_KEY: KEY },
    });
    const { code, err } = await runCli(["login", "--with-api-key"], io);
    expect(code).toBe(0);
    expect(err).toContain("TASTE_API_KEY is set");
    expect(err).not.toContain(KEY);
  });
});

describe("taste login --api-key", () => {
  it("needs a terminal, and never prompts under --json", async () => {
    for (const [argv, interactive] of [
      [["login", "--api-key"], false],
      [["login", "--api-key", "--json"], true],
    ] as const) {
      let asked = 0;
      const { io, store } = seams({
        interactive,
        askSecret: () => {
          asked += 1;
          return Promise.resolve(KEY);
        },
      });
      const { code, out, err } = await runCli([...argv], io);
      expect(code).toBe(1);
      expect(out + err).toContain("terminal");
      expect(asked).toBe(0);
      const json = await runCli(["login", "--api-key", "--json"], {
        ...io,
        interactive: false,
      });
      expect(json.doc().error.code).toBe("LOGIN_NOT_INTERACTIVE");
      expect(store.value).toBeNull();
    }
  });

  it("asks for the key with a hidden prompt, checks it and stores it", async () => {
    const prompts: string[] = [];
    const { io, store } = seams({
      interactive: true,
      askSecret: (message) => {
        prompts.push(message);
        return Promise.resolve(KEY);
      },
    });
    const { code, out, err } = await runCli(["login", "--api-key"], io);
    expect(code).toBe(0);
    expect(prompts).toHaveLength(1);
    expect(store.value).toEqual({ kind: "key", apiKey: KEY });
    expect(out + err).not.toContain(KEY);
  });

  it("saves nothing when the prompt is cancelled", async () => {
    const { io, store } = seams({
      interactive: true,
      askSecret: () => Promise.resolve(null),
    });
    const { code, err } = await runCli(["login", "--api-key"], io);
    expect(code).toBe(130);
    expect(err).toContain("Nothing was saved");
    expect(store.value).toBeNull();
  });

  it("refuses both key flags at once", async () => {
    const { io } = seams({ interactive: true });
    const { code, doc } = await runCli(
      ["login", "--api-key", "--with-api-key", "--json"],
      io
    );
    expect(code).toBe(2);
    expect(doc().error.code).toBe("USAGE_CONFLICTING_OPTIONS");
  });
});

describe("taste login with the browser", () => {
  it("refuses without a terminal or under --json, naming the other ways in", async () => {
    for (const [argv, interactive] of [
      [["login"], false],
      [["login", "--json"], true],
    ] as const) {
      const oauth = fakeOAuth();
      const browser = oauth.browser();
      const { io } = seams({
        interactive,
        fetch: oauth.fetch,
        openBrowser: browser.open,
      });
      const { code, out, err } = await runCli([...argv], io);
      expect(code).toBe(1);
      expect(out + err).toContain("--with-api-key");
      expect(out + err).toContain("TASTE_API_KEY");
      expect(browser.opened).toHaveLength(0);
      if ((argv as readonly string[]).includes("--json"))
        expect(JSON.parse(out)).toMatchObject({
          ok: false,
          error: { code: "LOGIN_NOT_INTERACTIVE" },
        });
    }
  });

  it("signs in through the browser, prints the address on stderr and stores the session", async () => {
    const oauth = fakeOAuth();
    const browser = oauth.browser();
    const { io, store } = seams({
      interactive: true,
      fetch: oauth.fetch,
      openBrowser: browser.open,
      signal: new AbortController().signal,
    });
    const { code, out, err } = await runCli(["login"], io);
    expect(code).toBe(0);
    expect(browser.opened).toHaveLength(1);
    expect(err).toContain(browser.opened[0]);
    expect(out).toContain(`Signed in as ${EMAIL}`);
    expect(store.value).toMatchObject({ kind: "session", email: EMAIL });
    for (const token of oauth.accessTokens)
      expect(out + err).not.toContain(token);
  });

  it("reports a session Taste refuses straight after the sign in as LOGIN_FAILED, not a wrong key", async () => {
    const oauth = fakeOAuth();
    const browser = oauth.browser();
    const { io, store } = seams({
      interactive: true,
      fetch: (input, init) =>
        String(input instanceof Request ? input.url : input).endsWith(
          "/design/me"
        )
          ? Promise.resolve(new Response("{}", { status: 401 }))
          : oauth.fetch(input, init),
      openBrowser: browser.open,
    });
    const { code, err } = await runCli(["login"], io);
    expect(code).toBe(1);
    expect(err).toContain("The sign in couldn't be finished");
    expect(store.value).toBeNull();
  });

  it("ends with INTERRUPTED when Ctrl-C lands while it waits for the browser", async () => {
    const oauth = fakeOAuth();
    const browser = oauth.browser("ignore");
    const controller = new AbortController();
    const { io, store } = seams({
      interactive: true,
      fetch: oauth.fetch,
      openBrowser: (url) => {
        setTimeout(() => controller.abort(), 10);
        return browser.open(url);
      },
      signal: controller.signal,
    });
    const { code, err } = await runCli(["login"], io);
    expect(code).toBe(130);
    expect(err).toContain("Run the command again.");
    expect(err).not.toContain("taste wait");
    expect(store.value).toBeNull();
  });
});
