// Where to sign in, read from the Taste Engine's OAuth metadata rather than written into the code:
// the protected resource document names the resource and its authorization server (RFC 9728), whose
// own document names the endpoints (RFC 8414). Both are checked, and every endpoint must be https.
import { z } from "zod";

import { CliError } from "../output/errors.ts";
import { requestJson } from "./http.ts";

type OAuthEndpoints = {
  resource: string;
  authorize: string;
  token: string;
  register: string;
};

const PROTECTED_RESOURCE_URL =
  "https://mcp.tastelabs.com/.well-known/oauth-protected-resource/mcp";
const RESOURCE_WELL_KNOWN = "/.well-known/oauth-protected-resource";
const SERVER_WELL_KNOWN = "/.well-known/oauth-authorization-server";
const HTTPS_URL = z.string().refine((text) => {
  const url = URL.parse(text);
  return url?.protocol === "https:" && !url.username && !url.password;
});
const RESOURCE_DOCUMENT = z.looseObject({
  resource: HTTPS_URL,
  authorization_servers: z.array(HTTPS_URL).min(1),
});
const SERVER_DOCUMENT = z.looseObject({
  issuer: HTTPS_URL,
  authorization_endpoint: HTTPS_URL,
  token_endpoint: HTTPS_URL,
  registration_endpoint: HTTPS_URL,
  code_challenge_methods_supported: z.array(z.string()).optional(),
});

function failed(cause?: unknown): CliError {
  return new CliError("LOGIN_FAILED", {}, { cause });
}

// RFC 9728: the document for https://host/path lives at https://host/.well-known/…/path, and its
// resource must be that very URL, so a document can't speak for another resource.
function expectedResource(): string {
  const url = new URL(PROTECTED_RESOURCE_URL);
  return `${url.origin}${url.pathname.slice(RESOURCE_WELL_KNOWN.length)}`;
}

// RFC 8414: the well-known segment goes between the host and the issuer's path.
function serverMetadataUrl(issuer: string): string {
  const url = new URL(issuer);
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
  return `${url.origin}${SERVER_WELL_KNOWN}${path}`;
}

async function fetchDocument<T>(
  fetch: typeof globalThis.fetch,
  url: string,
  schema: z.ZodType<T>,
  signal?: AbortSignal
): Promise<T> {
  const { status, body } = await requestJson(fetch, url, { signal });
  if (status !== 200) throw failed();
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw failed(parsed.error);
  return parsed.data;
}

async function discover(
  fetch: typeof globalThis.fetch,
  signal?: AbortSignal
): Promise<OAuthEndpoints> {
  const resource = await fetchDocument(
    fetch,
    PROTECTED_RESOURCE_URL,
    RESOURCE_DOCUMENT,
    signal
  );
  if (resource.resource !== expectedResource()) throw failed();
  // Length checked by the schema.
  const issuer = resource.authorization_servers[0] ?? "";
  const server = await fetchDocument(
    fetch,
    serverMetadataUrl(issuer),
    SERVER_DOCUMENT,
    signal
  );
  if (server.issuer !== issuer) throw failed();
  const methods = server.code_challenge_methods_supported;
  if (methods && !methods.includes("S256")) throw failed();
  return {
    resource: resource.resource,
    authorize: server.authorization_endpoint,
    token: server.token_endpoint,
    register: server.registration_endpoint,
  };
}

export { discover, PROTECTED_RESOURCE_URL };
export type { OAuthEndpoints };
