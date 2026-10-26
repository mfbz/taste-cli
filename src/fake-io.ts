// Test seams for driving a command through run(): captured output, and a Taste Engine that only knows
// /design/me, answering 200 for the keys and tokens it is told to accept and 401 otherwise.
import { run } from "./cli.ts";
import type { Io } from "./io.ts";

type Doc = {
  ok: boolean;
  data: Record<string, unknown>;
  error: {
    code: string;
    message: string;
    hint: string;
    retryable: boolean;
  };
};
type MeCall = { url: string; headers: Headers };
type FakeMe = {
  fetch: typeof globalThis.fetch;
  calls: MeCall[];
  // Header values ("x-api-key" value or "Bearer …") that /design/me accepts.
  accept: Set<string>;
};

const ME = {
  user_id: "00000000-0000-4000-8000-000000000001",
  email: "person@example.com",
  role: null,
};

function fakeMe(...accepted: string[]): FakeMe {
  const fake: FakeMe = {
    calls: [],
    accept: new Set(accepted),
    fetch: (input, init) => {
      const url = input instanceof Request ? input.url : input.toString();
      const headers = new Headers(init?.headers);
      fake.calls.push({ url, headers });
      const credential =
        headers.get("x-api-key") ?? headers.get("authorization") ?? "";
      const ok =
        new URL(url).pathname === "/design/me" && fake.accept.has(credential);
      return Promise.resolve(
        new Response(
          JSON.stringify(ok ? ME : { detail: "Not authenticated" }),
          {
            status: ok ? 200 : 401,
            headers: { "content-type": "application/json" },
          }
        )
      );
    },
  };
  return fake;
}

// The real client with a key from the environment and a network that is down: what a paid request
// that fails in flight reports, end to end.
function offline(): Partial<Io> {
  return {
    env: { TASTE_API_KEY: ["taste", "offline", "test"].join("_") },
    fetch: () => Promise.reject(new TypeError("fetch failed")),
    sleep: () => Promise.resolve(),
  };
}

async function runCli(argv: string[], seams: Partial<Io> = {}) {
  let out = "";
  let err = "";
  const code = await run(argv, {
    ...seams,
    stdout: (text) => (out += text),
    stderr: (text) => (err += text),
  });
  return { code, out, err, doc: () => JSON.parse(out) as Doc };
}

export { fakeMe, ME, offline, runCli };
export type { Doc, FakeMe };
