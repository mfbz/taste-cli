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
  it("binds the first free port on 127.0.0.1, or fails with LOGIN_PORTS_BUSY", async () => {
    const busy = portOf(await hold(0));
    const free = await freePort();
    const loopback = await listen([busy, free]);
    expect(redirectUri(loopback.port)).toBe(
      `http://127.0.0.1:${free}/callback`
    );
    expect(await errorCode(listenLoopback([busy, free]))).toBe(
      "LOGIN_PORTS_BUSY"
    );
  });
});

describe("waitForCallback", () => {
  function waitOn(
    loopback: Loopback,
    timeoutMs = MINUTE,
    signal?: AbortSignal
  ) {
    return loopback.waitForCallback(
      STATE,
      timeoutMs,
      signal ?? new AbortController().signal
    );
  }

  it("returns the code and tells the browser in one line of plain text", async () => {
    const loopback = await listen([await freePort()]);
    const waiting = waitOn(loopback);
    const response = await callback(loopback.port, `code=abc&state=${STATE}`);
    await expect(waiting).resolves.toBe("abc");
    expect(response.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8"
    );
    expect(await response.text()).toContain("Signed in.");
  });

  it("turns away another path, method or state and keeps waiting for the real callback", async () => {
    const loopback = await listen([await freePort()]);
    const waiting = waitOn(loopback);
    expect((await callback(loopback.port, "x=1", "/other")).status).toBe(404);
    const post = await fetch(
      `http://127.0.0.1:${loopback.port}/callback?code=abc&state=${STATE}`,
      { method: "POST" }
    );
    expect(post.status).toBe(404);
    const forged = await callback(loopback.port, "code=forged&state=other");
    expect(forged.status).toBe(400);
    await callback(loopback.port, `code=real&state=${STATE}`);
    await expect(waiting).resolves.toBe("real");
  });

  it("reads access_denied as LOGIN_DENIED, and any other error as LOGIN_FAILED without the server's words", async () => {
    const denied = await listen([await freePort()]);
    const deniedWait = errorCode(waitOn(denied));
    await callback(denied.port, `error=access_denied&state=${STATE}`);
    expect(await deniedWait).toBe("LOGIN_DENIED");

    const failed = await listen([await freePort()]);
    const failedWait = errorCode(waitOn(failed));
    const response = await callback(
      failed.port,
      `error=server_error&error_description=${encodeURIComponent("<b>injected</b>")}&state=${STATE}`
    );
    expect(await failedWait).toBe("LOGIN_FAILED");
    expect(await response.text()).not.toContain("injected");
  });

  it("gives up with LOGIN_TIMEOUT, and stops on Ctrl-C with INTERRUPTED", async () => {
    const loopback = await listen([await freePort()]);
    expect(await errorCode(waitOn(loopback, 10))).toBe("LOGIN_TIMEOUT");
    const controller = new AbortController();
    const waiting = errorCode(waitOn(loopback, MINUTE, controller.signal));
    controller.abort();
    expect(await waiting).toBe("INTERRUPTED");
  });
});
