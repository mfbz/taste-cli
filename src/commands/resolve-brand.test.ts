import { describe, expect, it } from "vitest";

import type { ListQuery } from "../api/client.ts";
import { createFakeApi } from "../api/fake-api.ts";
import type { FakeState } from "../api/fake-api.ts";
import { fixtureState } from "../api/fixtures.ts";
import type { Submission } from "../api/schemas.ts";
import { CliError, toErrorReport } from "../output/errors.ts";
import { resolveBrand } from "./resolve-brand.ts";

const TASTELABS = "00000000-0000-4000-8000-000000000100";
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
  it("passes an id through without a request", async () => {
    const { api } = seams();
    expect(await resolveBrand(api, STRIPE)).toBe(STRIPE);
    expect(api.calls).toEqual([]);
  });

  it("finds the finished full extraction of an address in one free list read", async () => {
    const { api, queries } = seams();
    expect(await resolveBrand(api, "stripe.com")).toBe(STRIPE);
    expect(api.calls).toEqual(["GET /design/submissions"]);
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

  it("treats www. and a trailing slash as the same address", async () => {
    const { api } = seams();
    expect(await resolveBrand(api, "https://tastelabs.com")).toBe(TASTELABS);
    expect(await resolveBrand(api, "www.tastelabs.com/")).toBe(TASTELABS);
  });

  it("takes the newest full extraction by when it was accepted, whatever the list's order", async () => {
    const at = (day: number) => `2026-10-${day}T10:00:00Z`;
    const { api } = seams({
      submissions: [
        extraction("sub-older-full", "https://acme.example/", {
          accepted_at: at(10),
        }),
        extraction("sub-new-selective", "https://acme.example/", {
          sections: ["colors"],
          accepted_at: at(25),
        }),
        extraction("sub-newest-full", "https://acme.example/", {
          accepted_at: at(20),
        }),
        extraction("sub-undated-full", "https://acme.example/", {
          accepted_at: null,
        }),
      ],
    });
    expect(await resolveBrand(api, "acme.example")).toBe("sub-newest-full");
  });

  it("matches over http or https, but never another port", async () => {
    const { api } = seams({
      submissions: [extraction("sub-8443", "https://acme.example:8443/")],
    });
    expect(await resolveBrand(api, "http://acme.example:8443")).toBe(
      "sub-8443"
    );
    expect((await failure(resolveBrand(api, "acme.example"))).code).toBe(
      "NOT_FOUND"
    );
  });

  it("reads further pages, up to three, before giving up", async () => {
    const other = (n: number) =>
      extraction(`sub-other-${n}`, `https://acme.example/page-${n}`);
    const many = (count: number) =>
      Array.from({ length: count }, (_, n) => other(n));
    const second = seams({
      submissions: [
        ...many(150),
        extraction("sub-home", "https://acme.example/"),
      ],
    });
    expect(await resolveBrand(second.api, "acme.example")).toBe("sub-home");
    expect(second.queries.map((q) => q.offset)).toEqual([0, 100]);
    const beyond = seams({
      submissions: [
        ...many(320),
        extraction("sub-home", "https://acme.example/"),
      ],
    });
    expect((await failure(resolveBrand(beyond.api, "acme.example"))).code).toBe(
      "NOT_FOUND"
    );
    expect(beyond.queries.map((q) => q.offset)).toEqual([0, 100, 200]);
  });

  it("refuses a bare word before any request, suggesting it as an address", async () => {
    const { api } = seams();
    const report = await failure(resolveBrand(api, "stripe"));
    expect(report.code).toBe("USAGE_INVALID_BRAND");
    expect(report.exitCode).toBe(2);
    expect(report.hint).toContain("stripe.com");
    expect(api.calls).toEqual([]);
    const odd = await failure(resolveBrand(api, "sub_1!"));
    expect(odd.hint).toContain("example.com");
  });

  it("never takes another page of the same site", async () => {
    const { api } = seams();
    const report = await failure(resolveBrand(api, "stripe.com/pricing"));
    expect(report.code).toBe("NOT_FOUND");
  });

  it("says to extract the address when there is no extraction of it", async () => {
    const { api } = seams();
    const report = await failure(resolveBrand(api, "example.org"));
    expect(report.code).toBe("NOT_FOUND");
    expect(report.hint).toContain("taste extract https://example.org/");
    expect(api.calls).toEqual(["GET /design/submissions"]);
  });

  it("says a full extraction is needed when there is only a selective one", async () => {
    const { api } = seams();
    const report = await failure(resolveBrand(api, "linear.app"));
    expect(report.code).toBe("FULL_EXTRACTION_REQUIRED");
    expect(report.hint).toContain("taste extract https://linear.app/");
    expect(report.retryable).toBe(false);
  });

  it("ignores extractions that are not finished", async () => {
    const { api } = seams({
      submissions: [
        extraction("sub-running", "https://acme.example/", {
          status: "crawling",
        }),
      ],
    });
    expect((await failure(resolveBrand(api, "acme.example"))).code).toBe(
      "NOT_FOUND"
    );
  });

  it("refuses a private address before any request", async () => {
    const { api } = seams();
    expect((await failure(resolveBrand(api, "localhost:3000"))).code).toBe(
      "PRIVATE_URL"
    );
    expect(api.calls).toEqual([]);
  });
});
