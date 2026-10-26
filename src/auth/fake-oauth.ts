// An in-memory OAuth server and Taste Engine identity endpoint for sign in tests, answered through an
// injected fetch, plus a scripted browser that "approves" an authorize URL by calling the real
// loopback server. It checks what the real one checks (PKCE, the exact redirect, the resource, a
// rotating refresh token), so a test passes only when the protocol is right.
import { createHash, randomBytes } from "node:crypto";

import { PROTECTED_RESOURCE_URL } from "./discovery.ts";
import type { SecretStore, StoredCredential } from "./store.ts";

type Call = { method: string; url: string; form: URLSearchParams | null };
type Grant = {
  clientId: string;
  redirectUri: string;
  challenge: string;
  resource: string | null;
};
type BrowserMode = "approve" | "deny" | "wrong-state" | "ignore";
type FakeOAuth = {
  fetch: typeof globalThis.fetch;
  calls: Call[];
  // Bodies of the two discovery documents; a test may replace either.
  documents: { resource: unknown; server: unknown };
  clients: Set<string>;
  registrations: unknown[];
  accessTokens: string[];
  refreshTokens: Set<string>;
  // Error codes the token endpoint answers with next, one per request, before answering normally.
  tokenErrors: string[];
  tokenDelayMs: number;
  browser(mode?: BrowserMode): {
    open: (url: string) => Promise<void>;
    opened: string[];
  };
};

const RESOURCE = "https://mcp.tastelabs.com/mcp";
const ISSUER = "https://auth.example.com/auth/v1";
const SERVER_METADATA_URL =
  "https://auth.example.com/.well-known/oauth-authorization-server/auth/v1";
const ENDPOINTS = {
  authorize: `${ISSUER}/oauth/authorize`,
  token: `${ISSUER}/oauth/token`,
  register: `${ISSUER}/oauth/clients/register`,
};
const ME_URL = "https://api.tastelabs.com/design/me";
const EMAIL = "person@example.com";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Built from parts at run time, so the guards never see a token-shaped literal.
function token(kind: string): string {
  return [kind, randomBytes(6).toString("hex")].join("-");
}

function fakeOAuth(): FakeOAuth {
  const grants = new Map<string, Grant>();
  const fake: FakeOAuth = {
    fetch: undefined as unknown as typeof globalThis.fetch,
    calls: [],
    documents: {
      resource: { resource: RESOURCE, authorization_servers: [ISSUER] },
      server: {
        issuer: ISSUER,
        authorization_endpoint: ENDPOINTS.authorize,
        token_endpoint: ENDPOINTS.token,
        registration_endpoint: ENDPOINTS.register,
        code_challenge_methods_supported: ["S256", "plain"],
      },
    },
    clients: new Set(),
    registrations: [],
    accessTokens: [],
    refreshTokens: new Set(),
    tokenErrors: [],
    tokenDelayMs: 0,
    browser,
  };

  function issue(): Response {
    const access = token("access");
    const refresh = token("refresh");
    fake.accessTokens.push(access);
    fake.refreshTokens.add(refresh);
    return json(200, {
      access_token: access,
      refresh_token: refresh,
      id_token: token("id"),
      token_type: "bearer",
      expires_in: 3600,
    });
  }

  async function tokenEndpoint(form: URLSearchParams): Promise<Response> {
    if (fake.tokenDelayMs > 0)
      await new Promise((resolve) => setTimeout(resolve, fake.tokenDelayMs));
    const queued = fake.tokenErrors.shift();
    if (queued)
      return json(queued === "invalid_client" ? 401 : 400, { error: queued });
    const clientId = form.get("client_id") ?? "";
    if (!fake.clients.has(clientId))
      return json(401, { error: "invalid_client" });
    if (form.get("grant_type") === "refresh_token") {
      const refresh = form.get("refresh_token") ?? "";
      if (!fake.refreshTokens.delete(refresh))
        return json(400, { error: "invalid_grant" });
      return issue();
    }
    const grant = grants.get(form.get("code") ?? "");
    grants.delete(form.get("code") ?? "");
    const verifier = form.get("code_verifier") ?? "";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    if (
      form.get("grant_type") !== "authorization_code" ||
      !grant ||
      grant.clientId !== clientId ||
      grant.redirectUri !== form.get("redirect_uri") ||
      grant.challenge !== challenge ||
      form.get("resource") !== RESOURCE
    )
      return json(400, { error: "invalid_grant" });
    return issue();
  }

  function register(body: unknown): Response {
    fake.registrations.push(body);
    const clientId = `client-${fake.registrations.length}`;
    fake.clients.add(clientId);
    const uris = (body as { redirect_uris?: unknown }).redirect_uris;
    return json(201, { client_id: clientId, redirect_uris: uris });
  }

  fake.fetch = (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString();
    const method = init?.method ?? "GET";
    const raw = typeof init?.body === "string" ? init.body : null;
    const isForm = new Headers(init?.headers)
      .get("content-type")
      ?.startsWith("application/x-www-form-urlencoded");
    const form = raw !== null && isForm ? new URLSearchParams(raw) : null;
    fake.calls.push({ method, url, form });
    if (method === "GET" && url === PROTECTED_RESOURCE_URL)
      return Promise.resolve(json(200, fake.documents.resource));
    if (method === "GET" && url === SERVER_METADATA_URL)
      return Promise.resolve(json(200, fake.documents.server));
    if (method === "POST" && url === ENDPOINTS.register)
      return Promise.resolve(register(JSON.parse(raw ?? "null")));
    if (method === "POST" && url === ENDPOINTS.token && form)
      return tokenEndpoint(form);
    if (method === "GET" && url === ME_URL) {
      const auth = new Headers(init?.headers).get("authorization") ?? "";
      const current = fake.accessTokens.at(-1);
      if (!current || auth !== `Bearer ${current}`)
        return Promise.resolve(json(401, { detail: "Not authenticated" }));
      return Promise.resolve(
        json(200, { user_id: "user-1", email: EMAIL, role: "user" })
      );
    }
    return Promise.resolve(json(404, { detail: "Not found" }));
  };

  // A browser that reads the authorize URL the way the real server would, then follows the redirect
  // to the loopback server with a real request.
  function browser(mode: BrowserMode = "approve") {
    const opened: string[] = [];
    function open(raw: string): Promise<void> {
      opened.push(raw);
      if (mode === "ignore") return Promise.resolve();
      const url = new URL(raw);
      const p = url.searchParams;
      const redirect = new URL(p.get("redirect_uri") ?? "");
      if (mode === "deny") {
        redirect.searchParams.set("error", "access_denied");
        redirect.searchParams.set("state", p.get("state") ?? "");
      } else {
        const code = token("code");
        grants.set(code, {
          clientId: p.get("client_id") ?? "",
          redirectUri: p.get("redirect_uri") ?? "",
          challenge: p.get("code_challenge") ?? "",
          resource: p.get("resource"),
        });
        redirect.searchParams.set("code", code);
        redirect.searchParams.set(
          "state",
          mode === "wrong-state" ? "not-the-state" : (p.get("state") ?? "")
        );
      }
      // Not awaited by the caller in real life: a browser runs on its own.
      void globalThis.fetch(redirect).then(
        (r) => r.text(),
        () => undefined
      );
      return Promise.resolve();
    }
    return { open, opened };
  }

  return fake;
}

// One in-memory store shared by everything given it, like the keychain shared by two processes.
function memoryStore(
  initial: StoredCredential | null = null
): SecretStore & { value: StoredCredential | null; writes: number } {
  return {
    name: "keychain",
    value: initial,
    writes: 0,
    read() {
      return Promise.resolve(this.value);
    },
    write(credential) {
      this.value = credential;
      this.writes += 1;
      return Promise.resolve();
    },
    clear() {
      this.value = null;
      return Promise.resolve();
    },
  };
}

export {
  EMAIL,
  ENDPOINTS,
  fakeOAuth,
  memoryStore,
  RESOURCE,
  SERVER_METADATA_URL,
};
export type { FakeOAuth };
