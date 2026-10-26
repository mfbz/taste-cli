// The local end of a browser sign in: a server on 127.0.0.1 only, which takes exactly one callback
// on GET /callback and then closes. The state must match before a code is trusted, and the page it
// answers with never repeats anything from the request.
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";

import { CATALOGUE, CliError } from "../output/errors.ts";
import type { ErrorCode } from "../output/errors.ts";
import { failurePage, PAGE_HEADERS, successPage } from "./success-page.ts";

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

const HOST = "127.0.0.1";
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

// What a callback means, decided from the parameters alone: a code, or the failure to report.
function outcome(
  params: URLSearchParams,
  state: string
): { code: string } | { failure: ErrorCode } {
  if (params.get("state") !== state) return { failure: "LOGIN_DENIED" };
  const error = params.get("error");
  if (error === "access_denied") return { failure: "LOGIN_DENIED" };
  const code = params.get("code");
  if (error !== null || !code) return { failure: "LOGIN_FAILED" };
  return { code };
}

function notFound(res: ServerResponse): void {
  res.writeHead(404, {
    ...PAGE_HEADERS,
    "content-type": "text/plain; charset=utf-8",
  });
  res.end("Not found.\n");
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

  listening.on("request", (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", redirectUri(port));
    if (req.method !== "GET" || url.pathname !== "/callback" || !handler)
      return notFound(res);
    handler(url, res);
  });

  function close(): Promise<void> {
    handler = null;
    return new Promise((resolve) => {
      listening.close(() => resolve());
      listening.closeAllConnections();
    });
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
        const result = outcome(url.searchParams, state);
        const ok = "code" in result;
        res.writeHead(ok ? 200 : 400, PAGE_HEADERS);
        res.end(
          ok ? successPage() : failurePage(CATALOGUE[result.failure].message),
          // The page is sent before the server goes away.
          () => finish(ok ? result.code : new CliError(result.failure))
        );
        // No second callback while this one is answered.
        handler = null;
      };
    });
  }

  return { port, waitForCallback, close };
}

export { listenLoopback, LOOPBACK_PORTS, redirectUri };
export type { Loopback };
