import { describe, expect, it, vi } from "vitest";

import pkg from "../../package.json" with { type: "json" };
import { CliError, toErrorReport } from "../output/errors.ts";
import { createTasteApi, TasteApiError } from "./client.ts";
import type { AuthProvider } from "./client.ts";

type Reply = {
  status: number;
  body?: unknown;
  text?: string;
  headers?: Record<string, string>;
};
type Call = { method: string; url: URL; headers: Headers; body: unknown };

const BASE = "https://api.test";
// Built from parts at run time: the guards keep key-shaped literals out of the repo.
const KEY = ["taste", "test", "0000"].join("_");
const SUBMISSION = {
  submission_id: "sub-1",
  status: "completed",
  source_url: "https://stripe.com/",
  is_public: false,
};
const ACCEPTED = {
  submission_id: "sub-1",
  status: "accepted",
  source_url: "https://stripe.com/",
  accepted_at: "2026-10-26T10:00:00Z",
};
const NOT_READY = { detail: { error: "NOT_READY", message: "Not ready." } };

function reply({ status, body, text, headers = {} }: Reply): Response {
  const payload = text ?? (body === undefined ? "" : JSON.stringify(body));
  return new Response(status === 204 ? null : payload, { status, headers });
}

// A fetch that answers from a script, one reply (or thrown error) per call, and records each request.
function fakeFetch(...script: (Reply | Error)[]) {
  const calls: Call[] = [];
  const fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const raw: unknown = init?.body;
    calls.push({
      method: init?.method ?? "GET",
      url: new URL(input instanceof Request ? input.url : input.toString()),
      headers: new Headers(init?.headers),
      body: typeof raw === "string" ? JSON.parse(raw) : raw,
    });
    const next = script.shift();
    if (!next) throw new Error("no scripted reply left");
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(reply(next));
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

function keyAuth(key = KEY): AuthProvider {
  return {
    header: () => Promise.resolve({ "x-api-key": key }),
    onUnauthorized: () => Promise.resolve(false),
  };
}

function setup(
  script: (Reply | Error)[],
  auth: AuthProvider = keyAuth(),
  signal?: AbortSignal
): {
  api: ReturnType<typeof createTasteApi>;
  calls: Call[];
  fetch: typeof globalThis.fetch;
  slept: number[];
} {
  const { fetch, calls } = fakeFetch(...script);
  const slept: number[] = [];
  const sleep = (ms: number) => {
    slept.push(ms);
    return Promise.resolve();
  };
  const api = createTasteApi({ fetch, baseUrl: BASE, auth, sleep, signal });
  return { api, calls, fetch, slept };
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

describe("createTasteApi requests", () => {
  it("sends the header from auth.header() and an unofficial user agent", async () => {
    const { api, calls } = setup([
      { status: 200, body: { user_id: "u-1", email: null, role: null } },
    ]);
    await api.me();
    expect(calls[0]?.url.href).toBe(`${BASE}/design/me`);
    expect(calls[0]?.headers.get("x-api-key")).toBe(KEY);
    expect(calls[0]?.headers.get("user-agent")).toBe(
      `taste-cli/${pkg.version} (unofficial)`
    );
  });

  it("sends a bearer header just the same", async () => {
    const auth: AuthProvider = {
      header: () => Promise.resolve({ authorization: "Bearer abc" }),
      onUnauthorized: () => Promise.resolve(false),
    };
    const { api, calls } = setup(
      [{ status: 200, body: { user_id: "u-1" } }],
      auth
    );
    await api.me();
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer abc");
    expect(calls[0]?.headers.get("x-api-key")).toBeNull();
  });

  it("posts a submission as JSON with map and max_urls in the query", async () => {
    const { api, calls } = setup([{ status: 202, body: ACCEPTED }]);
    const accepted = await api.createSubmission(
      { url: "https://stripe.com/", sections: ["colors"] },
      { map: true, maxUrls: 20 }
    );
    expect(accepted.submission_id).toBe("sub-1");
    const call = calls[0];
    expect(call?.method).toBe("POST");
    expect(call?.url.pathname).toBe("/design/submissions");
    expect(call?.url.searchParams.get("map")).toBe("true");
    expect(call?.url.searchParams.get("max_urls")).toBe("20");
    expect(call?.headers.get("content-type")).toBe("application/json");
    expect(call?.body).toEqual({
      url: "https://stripe.com/",
      sections: ["colors"],
    });
  });

  it("asks for result sections as one comma-separated parameter", async () => {
    const { api, calls } = setup([
      { status: 200, body: { ...SUBMISSION, result: {} } },
    ]);
    await api.getResult("sub-1", ["colors", "typography"]);
    expect(calls[0]?.url.pathname).toBe("/design/submissions/sub-1/result");
    expect(calls[0]?.url.searchParams.getAll("sections")).toEqual([
      "colors,typography",
    ]);
  });

  it("escapes an id inside the path", async () => {
    const { api, calls } = setup([{ status: 200, body: SUBMISSION }]);
    await api.getSubmission("a/../b?c");
    expect(calls[0]?.url.pathname).toBe("/design/submissions/a%2F..%2Fb%3Fc");
  });

  it("leaves unset list filters out of the query", async () => {
    const { api, calls } = setup([
      { status: 200, body: { submissions: [], total: 0, limit: 5, offset: 0 } },
    ]);
    await api.listSubmissions({ limit: 5, kind: "website" });
    expect(calls[0]?.url.search).toBe("?limit=5&kind=website");
  });

  it("uploads a brand kit as multipart with the PDF under file", async () => {
    const { api, calls } = setup([{ status: 202, body: ACCEPTED }]);
    await api.createBrandKit({
      name: "kit.pdf",
      bytes: new Uint8Array([37, 80, 68, 70]),
    });
    const body = calls[0]?.body;
    expect(body).toBeInstanceOf(FormData);
    const file = (body as FormData).get("file");
    expect(file).toBeInstanceOf(Blob);
    expect((file as File).name).toBe("kit.pdf");
    expect((file as File).type).toBe("application/pdf");
    expect(calls[0]?.headers.get("content-type")).toBeNull();
  });

  it("sets visibility with a PATCH", async () => {
    const { api, calls } = setup([
      { status: 200, body: { ...SUBMISSION, is_public: true } },
    ]);
    const updated = await api.setSubmissionVisibility("sub-1", true);
    expect(updated.is_public).toBe(true);
    expect(calls[0]?.method).toBe("PATCH");
    expect(calls[0]?.body).toEqual({ is_public: true });
  });

  it("asks for similar brands by submission id and top_k", async () => {
    const { api, calls } = setup([{ status: 200, body: { results: [] } }]);
    await api.similar("sub-1", 5);
    expect(calls[0]?.url.search).toBe("?submission_id=sub-1&top_k=5");
  });
});

describe("createTasteApi results", () => {
  it("reads a 409 on getResult as not_ready", async () => {
    const { api } = setup([{ status: 409, body: NOT_READY }]);
    expect(await api.getResult("sub-1")).toBe("not_ready");
  });

  it("reads a 409 on getVerdict as not_ready", async () => {
    const { api } = setup([{ status: 409, body: NOT_READY }]);
    expect(await api.getVerdict("job-1")).toBe("not_ready");
  });

  it("treats a 424 on the verdict as final", async () => {
    const { api } = setup([
      {
        status: 424,
        body: {
          detail: { error: "BRAND_ADHERENCE_FAILED", message: "failed" },
        },
      },
    ]);
    const error = await caught(api.getVerdict("job-1"));
    expect(error).toMatchObject({ status: 424 });
    expect(toErrorReport(error).code).toBe("ADHERENCE_FAILED");
  });

  it("rejects a response missing submission_id as INTERNAL", async () => {
    const { api } = setup([
      { status: 202, body: { ...ACCEPTED, submission_id: undefined } },
    ]);
    const error = await caught(
      api.createSubmission({ url: "https://stripe.com/" })
    );
    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).code).toBe("INTERNAL");
  });

  it("rejects a body that is not JSON as INTERNAL", async () => {
    const { api } = setup([{ status: 200, text: "<html>" }]);
    const error = await caught(api.me());
    expect((error as CliError).code).toBe("INTERNAL");
  });

  it("keeps fields the server adds later", async () => {
    const { api } = setup([
      { status: 200, body: { ...SUBMISSION, brand_new_field: 1 } },
    ]);
    expect(await api.getSubmission("sub-1")).toMatchObject({
      brand_new_field: 1,
    });
  });
});

describe("createTasteApi errors", () => {
  it("lifts a 402's code, balance and required", async () => {
    const { api, fetch } = setup([
      {
        status: 402,
        body: {
          detail: {
            error: "INSUFFICIENT_CREDITS",
            message: "Not enough credits.",
            balance: 0,
            required: 1,
          },
        },
      },
    ]);
    const error = await caught(
      api.createSubmission({ url: "https://stripe.com/" })
    );
    expect(error).toBeInstanceOf(TasteApiError);
    expect(error).toMatchObject({
      status: 402,
      code: "INSUFFICIENT_CREDITS",
      balance: 0,
      required: 1,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(toErrorReport(error).message).toBe(
      "Not enough credits: you have 0 and this needs 1."
    );
  });

  it("keeps the server's words off the error message", async () => {
    const { api } = setup([
      {
        status: 403,
        body: { detail: { error: "FORBIDDEN", message: "secret words" } },
      },
    ]);
    const error = (await caught(api.me())) as TasteApiError;
    expect(error.message).not.toContain("secret words");
    expect(error.serverMessage).toBe("secret words");
  });

  it("reads a 422 validation list and keeps its first msg", async () => {
    const { api } = setup([
      {
        status: 422,
        body: {
          detail: [
            { loc: ["body", "url"], msg: "first problem", type: "value_error" },
            { loc: ["body", "x"], msg: "second", type: "value_error" },
          ],
        },
      },
    ]);
    const error = await caught(
      api.createSubmission({ url: "https://stripe.com/" })
    );
    expect(error).toBeInstanceOf(TasteApiError);
    expect(error).toMatchObject({
      status: 422,
      serverMessage: "first problem",
    });
    expect((error as TasteApiError).code).toBeUndefined();
  });

  it("reads a plain string detail", async () => {
    const { api } = setup([{ status: 502, body: { detail: "bad gateway" } }]);
    const error = await caught(api.search({ query: "calm fintech" }));
    expect(error).toMatchObject({ status: 502, serverMessage: "bad gateway" });
  });

  it("reads a plain text 500", async () => {
    const { api } = setup([
      { status: 500, text: "Internal Server Error" },
      { status: 500, text: "Internal Server Error" },
      { status: 500, text: "Internal Server Error" },
    ]);
    const error = await caught(api.me());
    expect(error).toMatchObject({ status: 500 });
    expect(toErrorReport(error).code).toBe("UPSTREAM");
  });

  it("carries Retry-After on the error", async () => {
    const { api } = setup([
      { status: 429, body: {}, headers: { "retry-after": "7" } },
    ]);
    const error = await caught(api.me());
    expect(error).toMatchObject({ status: 429, retryAfterMs: 7000 });
  });
});

describe("createTasteApi retries", () => {
  it("waits out Retry-After on a busy search, then gives up with SEARCH_BUSY", async () => {
    const busy: Reply = {
      status: 503,
      body: { detail: "busy" },
      headers: { "retry-after": "2" },
    };
    const { api, fetch, slept } = setup([busy, busy, busy]);
    const error = await caught(api.search({ query: "calm fintech" }));
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(slept).toEqual([2000, 2000]);
    expect((error as CliError).code).toBe("SEARCH_BUSY");
  });

  it("returns a search that succeeds after one busy reply", async () => {
    const { api, slept } = setup([
      {
        status: 503,
        body: { detail: "busy" },
        headers: { "retry-after": "2" },
      },
      { status: 200, body: { search_id: "s-1", results: [] } },
    ]);
    expect((await api.search({ query: "calm fintech" })).search_id).toBe("s-1");
    expect(slept).toEqual([2000]);
  });

  it("caps Retry-After at 30 seconds", async () => {
    const { api, slept } = setup([
      { status: 503, body: {}, headers: { "retry-after": "600" } },
      { status: 200, body: { results: [] } },
    ]);
    await api.search({ query: "calm fintech" });
    expect(slept).toEqual([30_000]);
  });

  it("never retries a 500 on a POST that spends credits", async () => {
    const { api, fetch } = setup([{ status: 500, text: "boom" }]);
    const error = await caught(
      api.createSubmission({ url: "https://stripe.com/" })
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(toErrorReport(error).code).toBe("UPSTREAM");
  });

  it("never retries a network failure on a POST that spends credits", async () => {
    const { api, fetch } = setup([new TypeError("fetch failed")]);
    const error = await caught(
      api.createAdherence({
        reference_url: "https://a.com/",
        candidate_url: "https://b.com/",
      })
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((error as CliError).code).toBe("NETWORK");
  });

  it("retries a GET on 5xx with backoff and returns the answer", async () => {
    const { api, fetch, slept } = setup([
      { status: 502, text: "bad gateway" },
      { status: 500, text: "boom" },
      { status: 200, body: SUBMISSION },
    ]);
    expect((await api.getSubmission("sub-1")).status).toBe("completed");
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(slept).toEqual([500, 1000]);
  });

  it("turns a GET's repeated network failure into NETWORK", async () => {
    const { api, fetch } = setup([
      new TypeError("fetch failed"),
      new TypeError("fetch failed"),
      new TypeError("fetch failed"),
    ]);
    const error = await caught(api.getSubmission("sub-1"));
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).code).toBe("NETWORK");
  });

  it("does not retry a 4xx", async () => {
    const { api, fetch } = setup([
      { status: 404, body: { detail: { error: "NOT_FOUND", message: "x" } } },
    ]);
    await caught(api.getSubmission("sub-1"));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("on a 401 asks auth once and retries with the new header", async () => {
    let key = "old";
    const onUnauthorized = vi.fn(() => {
      key = "new";
      return Promise.resolve(true);
    });
    const auth: AuthProvider = {
      header: () => Promise.resolve({ authorization: `Bearer ${key}` }),
      onUnauthorized,
    };
    const { api, calls } = setup(
      [
        {
          status: 401,
          body: { detail: { error: "UNAUTHORIZED", message: "" } },
        },
        { status: 202, body: ACCEPTED },
      ],
      auth
    );
    await api.createSubmission({ url: "https://stripe.com/" });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(calls.map((c) => c.headers.get("authorization"))).toEqual([
      "Bearer old",
      "Bearer new",
    ]);
  });

  it("gives up on a second 401 without asking auth again", async () => {
    const onUnauthorized = vi.fn(() => Promise.resolve(true));
    const auth: AuthProvider = {
      header: () => Promise.resolve({ authorization: "Bearer x" }),
      onUnauthorized,
    };
    const unauthorized: Reply = {
      status: 401,
      body: { detail: { error: "UNAUTHORIZED", message: "" } },
    };
    const { api, fetch } = setup([unauthorized, unauthorized], auth);
    const error = await caught(api.me());
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(error).toMatchObject({ status: 401, code: "UNAUTHORIZED" });
  });

  it("does not retry a 401 when auth has nothing new", async () => {
    const { api, fetch } = setup([
      { status: 401, body: { detail: { error: "UNAUTHORIZED", message: "" } } },
    ]);
    await caught(api.me());
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("passes a credential failure through untouched and unretried", async () => {
    const failure = new Error("keychain locked");
    const auth: AuthProvider = {
      header: () => Promise.reject(failure),
      onUnauthorized: () => Promise.resolve(false),
    };
    const { api, fetch } = setup([], auth);
    expect(await caught(api.getSubmission("sub-1"))).toBe(failure);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sets a timeout on every request and refuses redirects", async () => {
    const { api, fetch } = setup([{ status: 200, body: { user_id: "u-1" } }]);
    await api.me();
    const init = vi.mocked(fetch).mock.calls[0]?.[1];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.redirect).toBe("error");
  });

  it("waits up to two minutes for enhance, which writes with a model", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const { api } = setup([
      { status: 200, body: { enhanced_prompt: "p", submission_id: "s" } },
    ]);
    await api.enhance({ submission_id: "s", prompt: "p" }).catch(() => {});
    expect(timeout).toHaveBeenCalledWith(120_000);
    timeout.mockRestore();
  });
});

describe("createTasteApi download", () => {
  it("fetches an https asset without the auth header", async () => {
    const { api, calls } = setup([{ status: 200, text: "png-bytes" }]);
    const bytes = await api.download("https://cdn.test/a.png");
    expect(new TextDecoder().decode(bytes)).toBe("png-bytes");
    expect(calls[0]?.headers.get("x-api-key")).toBeNull();
    expect(calls[0]?.headers.get("authorization")).toBeNull();
  });

  it("refuses an address that is not https", async () => {
    const { api, fetch } = setup([]);
    for (const url of ["http://cdn.test/a.png", "file:///etc/passwd", "nope"])
      expect(((await caught(api.download(url))) as CliError).code).toBe(
        "INVALID_URL"
      );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses a private or loopback asset address before fetching", async () => {
    const { api, fetch } = setup([]);
    for (const url of [
      "https://localhost/a.png",
      "https://127.0.0.1/a.png",
      "https://10.0.0.5/a.png",
      "https://[::1]/a.png",
    ])
      expect(((await caught(api.download(url))) as CliError).code).toBe(
        "PRIVATE_URL"
      );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("follows a redirect to another public https host", async () => {
    const { api, calls, fetch } = setup([
      { status: 302, headers: { location: "https://cdn2.test/b.png" } },
      { status: 200, text: "png" },
    ]);
    await api.download("https://cdn.test/a.png");
    expect(calls.map((c) => c.url.href)).toEqual([
      "https://cdn.test/a.png",
      "https://cdn2.test/b.png",
    ]);
    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.redirect).toBe("manual");
  });

  it("never follows a redirect to a private host or to plain http", async () => {
    for (const [location, code] of [
      ["https://169.254.169.254/latest", "PRIVATE_URL"],
      ["https://localhost/x", "PRIVATE_URL"],
      ["http://cdn.test/a.png", "INVALID_URL"],
    ] as const) {
      const { api, calls } = setup([{ status: 302, headers: { location } }]);
      const error = await caught(api.download("https://cdn.test/a.png"));
      expect((error as CliError).code, location).toBe(code);
      expect(calls).toHaveLength(1);
    }
  });

  it("gives up after too many redirects", async () => {
    const hop: Reply = {
      status: 302,
      headers: { location: "https://cdn.test/loop" },
    };
    const { api, calls } = setup(Array<Reply>(10).fill(hop));
    const error = (await caught(
      api.download("https://cdn.test/a.png")
    )) as CliError;
    expect(error.code).toBe("DOWNLOAD_FAILED");
    expect(calls.length).toBeLessThanOrEqual(6);
  });

  it("reports a failed asset fetch as DOWNLOAD_FAILED with its status, not as an API error", async () => {
    for (const status of [401, 403, 404, 503]) {
      const replies: Reply[] = Array<Reply>(3).fill({ status, text: "no" });
      const { api } = setup(replies);
      const error = await caught(api.download("https://cdn.test/dir/logo.png"));
      expect(error).toBeInstanceOf(CliError);
      expect((error as CliError).code).toBe("DOWNLOAD_FAILED");
      expect(toErrorReport(error).message).toBe(
        `Couldn't download logo.png (${status}).`
      );
    }
  });

  it("reports a network failure while downloading as DOWNLOAD_FAILED", async () => {
    const failure = new TypeError("fetch failed");
    const { api } = setup([failure, failure, failure]);
    const error = (await caught(
      api.download("https://cdn.test/logo.png")
    )) as CliError;
    expect(error.code).toBe("DOWNLOAD_FAILED");
    expect(toErrorReport(error).message).toBe(
      "Couldn't download logo.png (network)."
    );
  });
});

describe("createTasteApi interrupt", () => {
  it("passes the interrupt signal to fetch alongside the timeout", async () => {
    const controller = new AbortController();
    const { api, fetch } = setup(
      [{ status: 200, body: { user_id: "u-1" } }],
      keyAuth(),
      controller.signal
    );
    await api.me();
    const signal = vi.mocked(fetch).mock.calls[0]?.[1]?.signal;
    expect(signal?.aborted).toBe(false);
    controller.abort();
    expect(signal?.aborted).toBe(true);
  });

  it("turns an aborted request into INTERRUPTED without retrying", async () => {
    const controller = new AbortController();
    controller.abort();
    const { api, fetch } = setup(
      [new DOMException("aborted", "AbortError")],
      keyAuth(),
      controller.signal
    );
    const error = (await caught(api.getSubmission("sub-1"))) as CliError;
    expect(error.code).toBe("INTERRUPTED");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("hands the signal to the retry sleep and stops when it fires", async () => {
    const controller = new AbortController();
    const { fetch } = fakeFetch({ status: 502, text: "bad" });
    const signals: (AbortSignal | undefined)[] = [];
    const api = createTasteApi({
      fetch,
      baseUrl: BASE,
      auth: keyAuth(),
      signal: controller.signal,
      sleep: (_ms, signal) => {
        signals.push(signal);
        controller.abort();
        return Promise.reject(new Error("sleep aborted"));
      },
    });
    const error = (await caught(api.getSubmission("sub-1"))) as CliError;
    expect(signals).toEqual([controller.signal]);
    expect(error.code).toBe("INTERRUPTED");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
