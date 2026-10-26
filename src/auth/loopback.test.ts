import { createServer } from "node:net";
import type { Server } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { CliError } from "../output/errors.ts";
import { listenLoopback, redirectUri } from "./loopback.ts";
import type { Loopback } from "./loopback.ts";

const STATE = "the-state";
const MINUTE = 60_000;
const open: Loopback[] = [];
const held: Server[] = [];

afterEach(async () => {
  await Promise.all(open.splice(0).map((l) => l.close()));
  await Promise.all(
    held.splice(0).map((s) => new Promise((resolve) => s.close(resolve)))
  );
});

// A port the system just handed out and then released: free, as far as anyone can tell.
async function freePort(): Promise<number> {
  const server = await hold(0);
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  held.splice(held.indexOf(server), 1);
  if (!address || typeof address === "string") throw new Error("no port");
  return address.port;
}

function hold(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      held.push(server);
      resolve(server);
    });
  });
}

function portOf(server: Server): number {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  return address.port;
}

async function listen(ports: number[]): Promise<Loopback> {
  const loopback = await listenLoopback(ports);
  open.push(loopback);
  return loopback;
}

async function errorCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CliError) return error.code;
    throw error;
  }
  throw new Error("expected a rejection");
}

function callback(port: number, query: string, path = "/callback") {
  return fetch(`http://127.0.0.1:${port}${path}?${query}`);
}

describe("listenLoopback", () => {
  it("binds the first free port on 127.0.0.1", async () => {
    const busy = await hold(0);
    const free = await freePort();
    const loopback = await listen([portOf(busy), free]);
    expect(loopback.port).toBe(free);
    expect(redirectUri(loopback.port)).toBe(
      `http://127.0.0.1:${free}/callback`
    );
  });

  it("fails with LOGIN_PORTS_BUSY when every port is taken", async () => {
    const ports = [portOf(await hold(0)), portOf(await hold(0))];
    expect(await errorCode(listenLoopback(ports))).toBe("LOGIN_PORTS_BUSY");
  });
});

describe("waitForCallback", () => {
  it("returns the code and shows the success page with a strict CSP", async () => {
    const loopback = await listen([await freePort()]);
    const waiting = loopback.waitForCallback(
      STATE,
      MINUTE,
      new AbortController().signal
    );
    const response = await callback(loopback.port, `code=abc&state=${STATE}`);
    await expect(waiting).resolves.toBe("abc");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; img-src data:"
    );
    expect(await response.text()).toContain("You&#39;re signed in.");
  });

  it("answers 404 to any other path or method and keeps waiting", async () => {
    const loopback = await listen([await freePort()]);
    const waiting = loopback.waitForCallback(
      STATE,
      MINUTE,
      new AbortController().signal
    );
    expect((await callback(loopback.port, "x=1", "/other")).status).toBe(404);
    const post = await fetch(
      `http://127.0.0.1:${loopback.port}/callback?code=abc&state=${STATE}`,
      { method: "POST" }
    );
    expect(post.status).toBe(404);
    await callback(loopback.port, `code=def&state=${STATE}`);
    await expect(waiting).resolves.toBe("def");
  });

  it("handles one callback, then stops listening", async () => {
    const loopback = await listen([await freePort()]);
    const waiting = loopback.waitForCallback(
      STATE,
      MINUTE,
      new AbortController().signal
    );
    await callback(loopback.port, `code=abc&state=${STATE}`);
    await waiting;
    await expect(
      callback(loopback.port, `code=again&state=${STATE}`)
    ).rejects.toThrow();
  });

  it("rejects a callback with the wrong state as LOGIN_DENIED", async () => {
    const loopback = await listen([await freePort()]);
    const waiting = errorCode(
      loopback.waitForCallback(STATE, MINUTE, new AbortController().signal)
    );
    const response = await callback(loopback.port, "code=abc&state=forged");
    expect(await waiting).toBe("LOGIN_DENIED");
    expect(response.status).toBe(400);
  });

  it("reads access_denied as LOGIN_DENIED", async () => {
    const loopback = await listen([await freePort()]);
    const waiting = errorCode(
      loopback.waitForCallback(STATE, MINUTE, new AbortController().signal)
    );
    await callback(loopback.port, `error=access_denied&state=${STATE}`);
    expect(await waiting).toBe("LOGIN_DENIED");
  });

  it("reads any other error as LOGIN_FAILED and never shows the server's words", async () => {
    const loopback = await listen([await freePort()]);
    const waiting = errorCode(
      loopback.waitForCallback(STATE, MINUTE, new AbortController().signal)
    );
    const response = await callback(
      loopback.port,
      `error=server_error&error_description=${encodeURIComponent("<b>injected</b>")}&state=${STATE}`
    );
    expect(await waiting).toBe("LOGIN_FAILED");
    const page = await response.text();
    expect(page).not.toContain("injected");
    expect(page).not.toContain("server_error");
  });

  it("gives up with LOGIN_TIMEOUT", async () => {
    const loopback = await listen([await freePort()]);
    const waiting = loopback.waitForCallback(
      STATE,
      10,
      new AbortController().signal
    );
    expect(await errorCode(waiting)).toBe("LOGIN_TIMEOUT");
  });

  it("stops on Ctrl-C with INTERRUPTED", async () => {
    const loopback = await listen([await freePort()]);
    const controller = new AbortController();
    const waiting = loopback.waitForCallback(STATE, MINUTE, controller.signal);
    controller.abort();
    expect(await errorCode(waiting)).toBe("INTERRUPTED");
  });
});
