import { describe, expect, it, vi } from "vitest";

import pkg from "../../package.json" with { type: "json" };
import { CliError, toErrorReport } from "../output/errors.ts";
import { createTasteApi } from "./client.ts";
import type { AuthProvider, TasteApi } from "./client.ts";

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
const ACCEPTED = { submission_id: "sub-1", status: "accepted" };
const MB = 1024 * 1024;

// A fetch that answers from a script, one reply (or thrown error) per call, and records each request.
function setup(
  script: (Reply | Error)[],
  auth: AuthProvider = {
    header: () => Promise.resolve({ "x-api-key": KEY }),
    onUnauthorized: () => Promise.resolve(false),
  },
  signal?: AbortSignal
) {
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
    const { status, body, text, headers = {} } = next;
    const payload = text ?? (body === undefined ? "" : JSON.stringify(body));
    return Promise.resolve(new Response(payload, { status, headers }));
  });
  const slept: number[] = [];
  const api = createTasteApi({
    fetch,
    baseUrl: BASE,
    auth,
    sleep: (ms) => {
      slept.push(ms);
      return Promise.resolve();
    },
    signal,
  });
  return { api, calls, fetch, slept };
}

async function caught(promise: Promise<unknown>): Promise<CliError> {
  try {
    await promise;
  } catch (error) {
    return error as CliError;
  }
  throw new Error("expected a rejection");
}

// A body that never ends, one chunk at a time, noting when the reader gives up on it.
function endless(onCancel: () => void): ReadableStream<Uint8Array> {
  return new ReadableStream({
    pull: (controller) => controller.enqueue(new Uint8Array(MB)),
    cancel: onCancel,
  });
}

describe("createTasteApi", () => {
  it("sends the credential, an unofficial user agent and JSON, and refuses redirects", async () => {
    const { api, calls, fetch } = setup([{ status: 202, body: ACCEPTED }]);
    await api.createSubmission(
      { url: "https://stripe.com/" },
      { map: true, maxUrls: 20 }
    );
    const call = calls[0];
    expect(call?.url.href).toBe(
      `${BASE}/design/submissions?map=true&max_urls=20`
    );
    expect(call?.headers.get("x-api-key")).toBe(KEY);
    expect(call?.headers.get("user-agent")).toBe(
      `taste-cli/${pkg.version} (unofficial)`
    );
    expect(call?.body).toEqual({ url: "https://stripe.com/" });
    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.redirect).toBe("error");
  });

  it("escapes an id inside the path", async () => {
    const { api, calls } = setup([{ status: 200, body: SUBMISSION }]);
    await api.getSubmission("a/../b?c");
    expect(calls[0]?.url.pathname).toBe("/design/submissions/a%2F..%2Fb%3Fc");
  });

  it("uploads a brand kit as multipart with the PDF under file", async () => {
    const { api, calls } = setup([{ status: 202, body: ACCEPTED }]);
    await api.createBrandKit({ name: "kit.pdf", bytes: new Uint8Array(4) });
    const file = (calls[0]?.body as FormData).get("file") as File;
    expect(file.name).toBe("kit.pdf");
    expect(file.type).toBe("application/pdf");
  });

  it("reads a 409 on a result as not ready, and an answer that isn't JSON as INTERNAL", async () => {
    const notReady = { detail: { error: "NOT_READY", message: "Not ready." } };
    const { api } = setup([
      { status: 409, body: notReady },
      { status: 200, text: "<html>" },
    ]);
    expect(await api.getResult("sub-1")).toBe("not_ready");
    expect((await caught(api.me())).code).toBe("INTERNAL");
  });

  it("maps Taste's errors to ours and keeps the server's words off the message", async () => {
    const cases: [Reply, string][] = [
      [
        {
          status: 402,
          body: { detail: { error: "INSUFFICIENT_CREDITS", balance: 0 } },
        },
        "INSUFFICIENT_CREDITS",
      ],
      [{ status: 403, body: { detail: "secret words" } }, "FORBIDDEN"],
      [
        { status: 429, body: {}, headers: { "retry-after": "7" } },
        "RATE_LIMITED",
      ],
      [{ status: 500, text: "secret words" }, "UPSTREAM"],
    ];
    for (const [reply, code] of cases) {
      const { api } = setup([reply]);
      const report = toErrorReport(
        await caught(api.createSubmission({ url: "https://stripe.com/" }))
      );
      expect(report.code).toBe(code);
      expect(JSON.stringify(report)).not.toContain("secret words");
    }
  });

  it("retries a free read on 5xx and a network failure, with backoff", async () => {
    const { api, fetch, slept } = setup([
      { status: 502, text: "bad gateway" },
      new TypeError("fetch failed"),
      { status: 200, body: SUBMISSION },
    ]);
    expect((await api.getSubmission("sub-1")).status).toBe("completed");
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(slept).toEqual([500, 1000]);
  });

  it("tells a timeout from a network failure", async () => {
    const timeout = () => new DOMException("timed out", "TimeoutError");
    const { api } = setup([timeout(), timeout(), timeout()]);
    const report = toErrorReport(await caught(api.getSubmission("sub-1")));
    expect(report.code).toBe("TIMEOUT");
    expect(report.message).toBe("The Taste Engine didn't answer in time.");
  });

  it("on a 401 asks auth once and retries with the new credential", async () => {
    let token = "old";
    const onUnauthorized = vi.fn(() => {
      token = "new";
      return Promise.resolve(true);
    });
    const unauthorized: Reply = { status: 401, body: {} };
    const { api, calls } = setup([unauthorized, unauthorized], {
      header: () => Promise.resolve({ authorization: `Bearer ${token}` }),
      onUnauthorized,
    });
    expect(await caught(api.me())).toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(calls.map((c) => c.headers.get("authorization"))).toEqual([
      "Bearer old",
      "Bearer new",
    ]);
  });
});

describe("createTasteApi paid requests", () => {
  const sends: [string, (api: TasteApi) => Promise<unknown>, string][] = [
    [
      "job",
      (api) => api.createSubmission({ url: "https://stripe.com/" }),
      "Check taste history before",
    ],
    [
      "check",
      (api) =>
        api.createAdherence({
          reference_url: "https://a.com/",
          candidate_url: "https://b.com/",
        }),
      "Check taste history checks",
    ],
    [
      "search",
      (api) => api.search({ query: "calm fintech" }),
      "Check taste history searches",
    ],
    ["similar", (api) => api.similar("sub-1"), "Check taste history searches"],
    [
      "enhance",
      (api) => api.enhance({ submission_id: "sub-1", prompt: "p" }),
      "check your credits in your Taste account",
    ],
  ];

  it("never retries one, and says where to look before running it again", async () => {
    for (const [name, send, hint] of sends)
      for (const failure of [
        new TypeError("fetch failed"),
        new DOMException("timed out", "TimeoutError"),
        { status: 502, text: "bad gateway" },
      ]) {
        const { api, fetch } = setup([failure]);
        const report = toErrorReport(await caught(send(api)));
        expect(fetch, name).toHaveBeenCalledTimes(1);
        expect(report.retryable, name).toBe(false);
        expect(report.hint, name).toContain(hint);
      }
  });

  it("gives the same hint when Ctrl-C lands during one", async () => {
    const controller = new AbortController();
    controller.abort();
    const { api, fetch } = setup(
      [new DOMException("aborted", "AbortError")],
      undefined,
      controller.signal
    );
    const report = toErrorReport(
      await caught(
        api.createBrandKit({ name: "a.pdf", bytes: new Uint8Array(1) })
      )
    );
    expect(report.code).toBe("INTERRUPTED");
    expect(report.hint).toContain("taste history");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("retries only a busy search, which Taste refunds, then gives up with SEARCH_BUSY", async () => {
    const busy: Reply = {
      status: 503,
      body: { detail: "busy" },
      headers: { "retry-after": "600" },
    };
    const { api, fetch, slept } = setup([busy, busy, busy]);
    const error = await caught(api.search({ query: "calm fintech" }));
    expect(error.code).toBe("SEARCH_BUSY");
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(slept).toEqual([30_000, 30_000]);
  });

  it("caps an answer at 8 MB, never retried", async () => {
    let cancelled = false;
    const { api, fetch } = setup([]);
    vi.mocked(fetch).mockImplementation(() =>
      Promise.resolve(
        new Response(
          endless(() => (cancelled = true)),
          { status: 200 }
        )
      )
    );
    const report = toErrorReport(
      await caught(api.createSubmission({ url: "https://stripe.com/" }))
    );
    expect(report.code).toBe("RESPONSE_TOO_LARGE");
    expect(report.retryable).toBe(false);
    expect(report.hint).toContain("taste history");
    expect(cancelled).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("createTasteApi download", () => {
  it("fetches an https asset without the Taste credential", async () => {
    const { api, calls } = setup([{ status: 200, text: "png-bytes" }]);
    const bytes = await api.download("https://cdn.test/a.png");
    expect(new TextDecoder().decode(bytes)).toBe("png-bytes");
    expect(calls[0]?.headers.get("x-api-key")).toBeNull();
  });

  it("refuses an address that isn't public https, before fetching", async () => {
    const { api, fetch } = setup([]);
    for (const [url, code] of [
      ["http://cdn.test/a.png", "INVALID_URL"],
      ["file:///etc/passwd", "INVALID_URL"],
      ["https://127.0.0.1/a.png", "PRIVATE_URL"],
      ["https://[::1]/a.png", "PRIVATE_URL"],
    ] as const)
      expect((await caught(api.download(url))).code, url).toBe(code);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("checks every redirect hop the same way, and stops after five", async () => {
    const hop = (location: string): Reply => ({
      status: 302,
      headers: { location },
    });
    const ok = setup([
      hop("https://cdn2.test/b.png"),
      { status: 200, text: "" },
    ]);
    await ok.api.download("https://cdn.test/a.png");
    expect(ok.calls[1]?.url.href).toBe("https://cdn2.test/b.png");

    const metadata = setup([hop("https://169.254.169.254/latest")]);
    const error = await caught(metadata.api.download("https://cdn.test/a.png"));
    expect(error.code).toBe("PRIVATE_URL");
    expect(metadata.calls).toHaveLength(1);

    const loop = setup(Array<Reply>(10).fill(hop("https://cdn.test/loop")));
    expect(
      (await caught(loop.api.download("https://cdn.test/a.png"))).code
    ).toBe("DOWNLOAD_FAILED");
    expect(loop.calls.length).toBeLessThanOrEqual(6);
  });

  it("reports a failed fetch as DOWNLOAD_FAILED, naming the file and the status", async () => {
    const { api } = setup([{ status: 403, text: "no" }]);
    const report = toErrorReport(
      await caught(api.download("https://cdn.test/dir/logo.png"))
    );
    expect(report.message).toBe("Couldn't download logo.png (403).");
  });

  it("refuses an asset over 100 MB by its Content-Length, and cuts off an endless one once", async () => {
    const big = setup([
      {
        status: 200,
        text: "x",
        headers: { "content-length": String(101 * MB) },
      },
    ]);
    const error = await caught(big.api.download("https://cdn.test/big.webm"));
    expect(error.code).toBe("DOWNLOAD_TOO_LARGE");
    expect(error.params.file).toBe("big.webm");

    let cancelled = false;
    const { api, fetch } = setup([]);
    vi.mocked(fetch).mockImplementation(() =>
      Promise.resolve(
        new Response(
          endless(() => (cancelled = true)),
          { status: 200 }
        )
      )
    );
    expect(
      (await caught(api.download("https://cdn.test/loop.webm"))).code
    ).toBe("DOWNLOAD_TOO_LARGE");
    expect(cancelled).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
