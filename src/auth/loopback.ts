// The local end of a browser sign in: a server on 127.0.0.1 only, which takes exactly one callback
// on GET /callback and then closes. Only a callback carrying our state counts: anything else gets a
// fixed failure line and the wait goes on, so another page can neither sign us in nor cancel the sign
// in. The browser gets one line of plain text, and never anything from the request.
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import type { IncomingMessage, Server, ServerResponse } from "node:http";

import { CATALOGUE, CliError } from "../output/errors.ts";
import type { ErrorCode } from "../output/errors.ts";

type Loopback = {
  port: number;
  waitForCallback(
    state: string,
    timeoutMs: number,
    signal: AbortSignal
  ): Promise<string>;
  close(): Promise<void>;
};
type Handler = (url: URL, res: ServerResponse) => void;
type Outcome = { code: string } | { failure: ErrorCode };

const HOST = "127.0.0.1";
const HEADERS = {
  "content-type": "text/plain; charset=utf-8",
  "content-security-policy": "default-src 'none'",
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  // One callback per sign in: no reason to keep the browser's connection open.
  connection: "close",
} as const;
const SIGNED_IN =
  "Signed in. You can close this tab and go back to the terminal.";
const GO_BACK = "Go back to the terminal to try again.";
// How long a page being sent may hold up closing the server.
const SEND_GRACE_MS = 1000;
// Registered all at once, because the server only accepts a redirect it knows to the exact port. Four,
// because the first is also rclone's default and something may hold it.
const LOOPBACK_PORTS: readonly number[] = [53682, 53683, 53684, 53685];

function redirectUri(port: number): string {
  return `http://${HOST}:${port}/callback`;
}

function bind(port: number): Promise<Server | null> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(null));
    server.listen(port, HOST, () => resolve(server));
  });
}

// What a callback with our state means: a code, or the failure to report.
function outcome(params: URLSearchParams): Outcome {
  const error = params.get("error");
  if (error === "access_denied") return { failure: "LOGIN_DENIED" };
  const code = params.get("code");
  if (error !== null || !code) return { failure: "LOGIN_FAILED" };
  return { code };
}

function plain(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, HEADERS);
  res.end(`${text}\n`);
}

function failure(res: ServerResponse, code: ErrorCode): void {
  plain(res, 400, `${CATALOGUE[code].message} ${GO_BACK}`);
}

async function listenLoopback(ports: readonly number[]): Promise<Loopback> {
  let server: Server | null = null;
  let port = 0;
  for (const candidate of ports) {
    server = await bind(candidate);
    if (server) {
      port = candidate;
      break;
    }
  }
  if (!server) throw new CliError("LOGIN_PORTS_BUSY");
  const listening = server;
  let handler: Handler | null = null;
  // The last page still being sent; settles when it is sent or its socket goes away.
  let sending: Promise<void> = Promise.resolve();

  listening.on("request", (req: IncomingMessage, res: ServerResponse) => {
    sending = new Promise((resolve) => res.once("close", resolve));
    const url = URL.parse(req.url ?? "", redirectUri(port));
    if (!url) return plain(res, 400, "Bad request.");
    if (req.method !== "GET" || url.pathname !== "/callback" || !handler)
      return plain(res, 404, "Not found.");
    handler(url, res);
  });

  // Stops taking connections at once, lets a page in flight finish (briefly), then drops the rest.
  async function close(): Promise<void> {
    handler = null;
    const closed = new Promise<void>((resolve) =>
      listening.close(() => resolve())
    );
    listening.closeIdleConnections();
    await Promise.race([
      sending,
      delay(SEND_GRACE_MS, undefined, { ref: false }),
    ]);
    listening.closeAllConnections();
    await closed;
  }

  function waitForCallback(
    state: string,
    timeoutMs: number,
    signal: AbortSignal
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      function finish(result: string | CliError): void {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        handler = null;
        if (result instanceof CliError) reject(result);
        else resolve(result);
        void close();
      }
      const onAbort = () => finish(new CliError("INTERRUPTED"));
      const timer = setTimeout(
        () => finish(new CliError("LOGIN_TIMEOUT")),
        timeoutMs
      );
      if (signal.aborted) return onAbort();
      signal.addEventListener("abort", onAbort, { once: true });
      handler = (url, res) => {
        if (url.searchParams.get("state") !== state)
          return failure(res, "LOGIN_FAILED");
        const result = outcome(url.searchParams);
        if ("code" in result) {
          plain(res, 200, SIGNED_IN);
        } else failure(res, result.failure);
        // Settled now, not when the page is sent: a browser that drops the connection must not leave
        // the sign in waiting. close() lets the page finish first.
        finish("code" in result ? result.code : new CliError(result.failure));
      };
    });
  }

  return { port, waitForCallback, close };
}

export { listenLoopback, LOOPBACK_PORTS, redirectUri };
export type { Loopback };
