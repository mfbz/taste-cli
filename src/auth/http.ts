// One request to the sign in service, answered as a status and a parsed JSON body. A failed send
// becomes NETWORK, or INTERRUPTED after Ctrl-C; the service's words stay in the body for the caller to
// branch on and are never shown.
import { CliError } from "../output/errors.ts";

type JsonAnswer = { status: number; body: unknown };
type Send = {
  method?: "GET" | "POST";
  json?: unknown;
  form?: Record<string, string>;
  signal?: AbortSignal;
};

const TIMEOUT_MS = 30_000;

async function requestJson(
  fetch: typeof globalThis.fetch,
  url: string,
  { method = "GET", json, form, signal }: Send = {}
): Promise<JsonAnswer> {
  const headers: Record<string, string> = { accept: "application/json" };
  let body: string | undefined;
  if (json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(json);
  } else if (form) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(form).toString();
  }
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  let text: string;
  let status: number;
  try {
    // A redirect could carry a code or a token somewhere else, so none is followed.
    const response = await fetch(url, {
      method,
      headers,
      body,
      redirect: "error",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    status = response.status;
    text = await response.text();
  } catch (error) {
    // A deadline the caller set (AbortSignal.timeout) is a slow network, not Ctrl-C.
    const reason: unknown = signal?.reason;
    const timedOut =
      reason instanceof DOMException && reason.name === "TimeoutError";
    if (signal?.aborted && !timedOut)
      throw new CliError("INTERRUPTED", {}, { cause: error });
    throw new CliError("NETWORK", {}, { cause: error });
  }
  try {
    return { status, body: JSON.parse(text) as unknown };
  } catch {
    return { status, body: undefined };
  }
}

export { requestJson };
export type { JsonAnswer };
