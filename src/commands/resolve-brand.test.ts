import { describe, expect, it } from "vitest";

import type { ListQuery } from "../api/client.ts";
import { createFakeApi } from "../api/fake-api.ts";
import type { FakeState } from "../api/fake-api.ts";
import { fixtureState } from "../api/fixtures.ts";
import type { Submission } from "../api/schemas.ts";
import { CliError, toErrorReport } from "../output/errors.ts";
import { resolveBrand } from "./resolve-brand.ts";

const STRIPE = "00000000-0000-4000-8000-000000000200";

function seams(state: Partial<FakeState> = {}) {
  const api = createFakeApi({ ...fixtureState(), ...state });
  const queries: ListQuery[] = [];
  const list = api.listSubmissions.bind(api);
  api.listSubmissions = (q) => {
    queries.push(q);
    return list(q);
  };
  return { api, queries };
}

function extraction(
  id: string,
  url: string,
  extra: Partial<Submission> = {}
): Submission {
  return {
    submission_id: id,
    status: "completed",
    source_url: url,
    is_public: false,
    kind: "website",
    accepted_at: "2026-10-26T10:00:00Z",
    ...extra,
  };
}

async function failure(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e
  );
  expect(error).toBeInstanceOf(CliError);
  return toErrorReport(error);
}

describe("resolveBrand", () => {
  it("passes an id through, and refuses a bare word or a private address, all without a request", async () => {
    const { api } = seams();
    expect(await resolveBrand(api, STRIPE)).toBe(STRIPE);
    const word = await failure(resolveBrand(api, "stripe"));
    expect(word).toMatchObject({ code: "USAGE_INVALID_BRAND", exitCode: 2 });
    expect(word.hint).toContain("stripe.com");
    expect((await failure(resolveBrand(api, "localhost:3000"))).code).toBe(
      "PRIVATE_URL"
    );
    expect(api.calls).toEqual([]);
  });

  it("finds the finished full extraction of an address in one free list read", async () => {
    const { api, queries } = seams();
    expect(await resolveBrand(api, "stripe.com")).toBe(STRIPE);
    expect(queries).toEqual([
      {
        q: "stripe.com",
        status: "completed",
        kind: "website",
        limit: 100,
        offset: 0,
      },
    ]);
  });

  it("ignores www., a trailing slash and the scheme, but never a port or another page", async () => {
    const { api } = seams({
      submissions: [
        extraction("sub-home", "https://www.acme.example/"),
        extraction("sub-8443", "https://acme.example:8443/"),
      ],
    });
    expect(await resolveBrand(api, "http://acme.example")).toBe("sub-home");
    expect(await resolveBrand(api, "acme.example:8443/")).toBe("sub-8443");
    expect(
      (await failure(resolveBrand(api, "acme.example/pricing"))).code
    ).toBe("NOT_FOUND");
  });

  it("takes the newest finished full extraction by when it was accepted, whatever the list's order", async () => {
    const at = (day: number) => `2026-10-${day}T10:00:00Z`;
    const { api } = seams({
      submissions: [
        extraction("sub-older", "https://acme.example/", {
          accepted_at: at(10),
        }),
        extraction("sub-selective", "https://acme.example/", {
          sections: ["colors"],
          accepted_at: at(25),
        }),
        extraction("sub-running", "https://acme.example/", {
          status: "crawling",
          accepted_at: at(26),
        }),
        extraction("sub-newest", "https://acme.example/", {
          accepted_at: at(20),
        }),
        extraction("sub-undated", "https://acme.example/", {
          accepted_at: null,
        }),
      ],
    });
    expect(await resolveBrand(api, "acme.example")).toBe("sub-newest");
  });

  it("reads further pages, up to three, before giving up", async () => {
    const many = (count: number) =>
      Array.from({ length: count }, (_, n) =>
        extraction(`sub-${n}`, `https://acme.example/page-${n}`)
      );
    const home = extraction("sub-home", "https://acme.example/");
    const second = seams({ submissions: [...many(150), home] });
    expect(await resolveBrand(second.api, "acme.example")).toBe("sub-home");
    const beyond = seams({ submissions: [...many(320), home] });
    expect((await failure(resolveBrand(beyond.api, "acme.example"))).code).toBe(
      "NOT_FOUND"
    );
    expect(beyond.queries.map((q) => q.offset)).toEqual([0, 100, 200]);
  });

  it("says to extract an address with no extraction, or only a selective one", async () => {
    const { api } = seams();
    const missing = await failure(resolveBrand(api, "example.org"));
    expect(missing.code).toBe("NOT_FOUND");
    expect(missing.hint).toContain("taste extract https://example.org/");
    const selective = await failure(resolveBrand(api, "linear.app"));
    expect(selective.code).toBe("FULL_EXTRACTION_REQUIRED");
    expect(selective.hint).toContain("taste extract https://linear.app/");
  });
});
