import { describe, expect, it } from "vitest";

import { CliError } from "../output/errors.ts";
import { discover, PROTECTED_RESOURCE_URL } from "./discovery.ts";
import {
  ENDPOINTS,
  fakeOAuth,
  RESOURCE,
  SERVER_METADATA_URL,
} from "./fake-oauth.ts";

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CliError) return error.code;
    throw error;
  }
  throw new Error("expected a rejection");
}

describe("discover", () => {
  it("reads the resource and the server's endpoints from the two documents", async () => {
    const fake = fakeOAuth();
    await expect(discover(fake.fetch)).resolves.toEqual({
      resource: RESOURCE,
      authorize: ENDPOINTS.authorize,
      token: ENDPOINTS.token,
      register: ENDPOINTS.register,
    });
    expect(fake.calls.map((c) => c.url)).toEqual([
      PROTECTED_RESOURCE_URL,
      SERVER_METADATA_URL,
    ]);
  });

  it("refuses an endpoint that isn't https", async () => {
    const fake = fakeOAuth();
    fake.documents.server = {
      ...(fake.documents.server as object),
      token_endpoint: "http://auth.example.com/auth/v1/oauth/token",
    };
    expect(await code(discover(fake.fetch))).toBe("LOGIN_FAILED");
  });

  it("refuses an authorization server that isn't https", async () => {
    const fake = fakeOAuth();
    fake.documents.resource = {
      resource: RESOURCE,
      authorization_servers: ["http://auth.example.com/auth/v1"],
    };
    expect(await code(discover(fake.fetch))).toBe("LOGIN_FAILED");
  });

  it("refuses a document for some other resource", async () => {
    const fake = fakeOAuth();
    fake.documents.resource = {
      resource: "https://elsewhere.example.com/mcp",
      authorization_servers: ["https://auth.example.com/auth/v1"],
    };
    expect(await code(discover(fake.fetch))).toBe("LOGIN_FAILED");
  });

  it("refuses server metadata issued by another server", async () => {
    const fake = fakeOAuth();
    fake.documents.server = {
      ...(fake.documents.server as object),
      issuer: "https://elsewhere.example.com/auth/v1",
    };
    expect(await code(discover(fake.fetch))).toBe("LOGIN_FAILED");
  });

  it("refuses a server without PKCE S256", async () => {
    const fake = fakeOAuth();
    fake.documents.server = {
      ...(fake.documents.server as object),
      code_challenge_methods_supported: ["plain"],
    };
    expect(await code(discover(fake.fetch))).toBe("LOGIN_FAILED");
  });

  it("refuses a document that isn't one", async () => {
    const fake = fakeOAuth();
    fake.documents.resource = "<html>";
    expect(await code(discover(fake.fetch))).toBe("LOGIN_FAILED");
  });

  it("reports a network failure as NETWORK", async () => {
    const failing = (() =>
      Promise.reject(new TypeError("fetch failed"))) as typeof fetch;
    expect(await code(discover(failing))).toBe("NETWORK");
  });

  it("reports Ctrl-C as INTERRUPTED", async () => {
    const controller = new AbortController();
    controller.abort();
    const failing = (() =>
      Promise.reject(
        new DOMException("aborted", "AbortError")
      )) as typeof fetch;
    expect(await code(discover(failing, controller.signal))).toBe(
      "INTERRUPTED"
    );
  });
});
