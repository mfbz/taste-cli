import { describe, expect, it } from "vitest";

import type { BrandSearchRequest } from "../api/schemas.ts";
import { offline, runCli } from "../fake-io.ts";
import { fixtures, jobSeams } from "../job-seams.ts";

const ANSI = /\u001b\[/;
const recordedFast = fixtures["search-fast"]?.data.results;

function seams(...args: Parameters<typeof jobSeams>) {
  const { api, io } = jobSeams(...args);
  const sent: BrandSearchRequest[] = [];
  const search = api.search.bind(api);
  api.search = (body) => {
    sent.push(body);
    return search(body);
  };
  return { api, io, sent };
}

describe("taste search", () => {
  it("sends one fast search and shows the recorded brands as cards", async () => {
    const { api, io, sent } = seams();
    const { code, out, err } = await runCli(
      ["search", "dark brutalist developer tools"],
      io
    );
    expect(code).toBe(0);
    expect(api.calls).toEqual(["POST /search"]);
    expect(sent).toEqual([
      { query: "dark brutalist developer tools", depth: "fast" },
    ]);
    expect(out).toMatch(/^ *1 {2}daily {2}good/m);
    expect(out).toContain("https://daily.co/pricing");
    expect(out + err).not.toMatch(ANSI);
  });

  it("passes the recorded answer through under --json, as one document", async () => {
    const { io } = seams();
    const { out, doc } = await runCli(
      ["search", "dark brutalist developer tools", "--json"],
      io
    );
    expect(out.trim().split("\n")).toHaveLength(1);
    expect(doc()).toEqual({ ok: true, data: recordedFast });
  });

  it("sends --deep, --top and the filters as the API's fields", async () => {
    const { io, sent } = seams();
    const flags = "--deep --top 12 --industry fintech --page-type pricing";
    await runCli(["search", "  calm fintech  ", ...flags.split(" ")], io);
    expect(sent).toEqual([
      {
        query: "calm fintech",
        depth: "deep",
        top_k: 12,
        filters: { industry: "fintech", page_type: "pricing" },
      },
    ]);
  });

  it.each([
    [["calm fintech", "--industry", "nope"], "USAGE_INVALID_INDUSTRY"],
    [["calm fintech", "--page-type", "nope"], "USAGE_INVALID_PAGE_TYPE"],
    [["calm fintech", "--top", "0"], "USAGE_INVALID_VALUE"],
    [["calm fintech", "--top", "31"], "USAGE_INVALID_VALUE"],
    [[" x "], "USAGE_INVALID_QUERY"],
    [["y".repeat(401)], "USAGE_INVALID_QUERY"],
  ])("refuses %j with exit 2 and no request", async (args, code) => {
    const { api, io } = seams();
    const result = await runCli(["search", ...args, "--json"], io);
    expect(result.code).toBe(2);
    expect(result.doc().error.code).toBe(code);
    expect(result.out).not.toContain("nope");
    expect(api.calls).toEqual([]);
  });

  it("names a few valid industries when one is unknown", async () => {
    const { err } = await runCli(
      ["search", "calm fintech", "--industry", "nope"],
      seams().io
    );
    for (const industry of ["saas", "fintech", "developer_tools"])
      expect(err).toContain(industry);
  });

  it("tells the hard stop a paid request is in flight, then that nothing is", async () => {
    const seen: Record<string, string>[] = [];
    const { io } = seams(
      {},
      { inFlight: (params) => seen.push({ ...params }) }
    );
    await runCli(["search", "calm fintech", "--json"], io);
    expect(seen).toEqual([{ paid: "search" }, {}]);
  });

  it("never offers a blind retry after a network failure in flight", async () => {
    const { doc } = await runCli(
      ["search", "calm fintech", "--json"],
      offline()
    );
    expect(doc().error).toMatchObject({
      code: "NETWORK",
      hint: "It may have reached Taste and been charged. Check taste history searches before you run it again, so you don't pay twice.",
      retryable: false,
    });
  });

  it("says in its help that it spends credits, and lists the filters' values", async () => {
    const { out } = await runCli(["search", "--help"]);
    expect(out).toContain("spends credits");
    expect(out).toContain("developer_tools");
    expect(out).toContain("landing_page");
  });
});
