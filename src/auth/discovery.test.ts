import { describe, expect, it } from "vitest";

import { CliError } from "../output/errors.ts";
import { discover, PROTECTED_RESOURCE_URL } from "./discovery.ts";
import {
  ENDPOINTS,
  fakeOAuth,
  RESOURCE,
  SERVER_METADATA_URL,
} from "./fake-oauth.ts";
import type { FakeOAuth } from "./fake-oauth.ts";

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

  it("refuses plain http, another resource or issuer, no PKCE S256, and a document that isn't one", async () => {
    const auth = "https://auth.example.com/auth/v1";
    const resource = (value: unknown) => (fake: FakeOAuth) => {
      fake.documents.resource = value;
    };
    const server = (change: object) => (fake: FakeOAuth) => {
      fake.documents.server = {
        ...(fake.documents.server as object),
        ...change,
      };
    };
    for (const spoil of [
      server({ token_endpoint: "http://auth.example.com/auth/v1/oauth/token" }),
      server({ issuer: "https://elsewhere.example.com/auth/v1" }),
      server({ code_challenge_methods_supported: ["plain"] }),
      resource({
        resource: RESOURCE,
        authorization_servers: ["http://auth.example.com/auth/v1"],
      }),
      resource({
        resource: "https://elsewhere.example.com/mcp",
        authorization_servers: [auth],
      }),
      resource("<html>"),
    ]) {
      const fake = fakeOAuth();
      spoil(fake);
      expect(await code(discover(fake.fetch))).toBe("LOGIN_FAILED");
    }
  });

  it("reports a network failure as NETWORK", async () => {
    const failing = (() =>
      Promise.reject(new TypeError("fetch failed"))) as typeof fetch;
    expect(await code(discover(failing))).toBe("NETWORK");
  });
});
