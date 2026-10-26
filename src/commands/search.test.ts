import { describe, expect, it } from "vitest";

import { TasteApiError } from "../api/client.ts";
import type { BrandSearchRequest } from "../api/schemas.ts";
import { runCli } from "../fake-io.ts";
import { fixtures, jobSeams } from "../job-seams.ts";
import { CliError } from "../output/errors.ts";

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
    expect(out).toContain("taste extract <url>");
    expect(out + err).not.toMatch(ANSI);
  });

  it("passes the recorded answer through under --json", async () => {
    const { io } = seams();
    const { code, out, doc } = await runCli(
      ["search", "dark brutalist developer tools", "--json"],
      io
    );
    expect(code).toBe(0);
    expect(out.trim().split("\n")).toHaveLength(1);
    expect(doc()).toEqual({ ok: true, data: recordedFast });
  });

  it("sends --deep, --top and the filters as the API's fields", async () => {
    const { io, sent } = seams();
    const { code } = await runCli(
      [
        "search",
        "  calm fintech  ",
        "--deep",
        "--top",
        "12",
        "--industry",
        "fintech",
        "--page-type",
        "pricing",
      ],
      io
    );
    expect(code).toBe(0);
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
    [["--industry", "nope"], "USAGE_INVALID_INDUSTRY"],
    [["--page-type", "nope"], "USAGE_INVALID_PAGE_TYPE"],
    [["--top", "0"], "USAGE_INVALID_VALUE"],
    [["--top", "31"], "USAGE_INVALID_VALUE"],
  ])("refuses %j with exit 2 and no request", async (flags, code) => {
    const { api, io } = seams();
    const result = await runCli(
      ["search", "calm fintech", ...flags, "--json"],
      io
    );
    expect(result.code).toBe(2);
    expect(result.doc().error.code).toBe(code);
    expect(result.out).not.toContain("nope");
    expect(api.calls).toEqual([]);
  });

  it("lists a few valid industries when one is unknown", async () => {
    const { io } = seams();
    const { code, err } = await runCli(
      ["search", "calm fintech", "--industry", "nope"],
      io
    );
    expect(code).toBe(2);
    for (const industry of ["saas", "fintech", "developer_tools"])
      expect(err).toContain(industry);
  });

  it.each(["x", " x ", "y".repeat(401)])(
    "refuses a query that is not 2 to 400 characters (%#)",
    async (query) => {
      const { api, io } = seams();
      const { code, doc } = await runCli(["search", query, "--json"], io);
      expect(code).toBe(2);
      expect(doc().error.code).toBe("USAGE_INVALID_QUERY");
      expect(api.calls).toEqual([]);
    }
  );

  it("accepts a query of exactly 400 characters", async () => {
    const { io } = seams();
    const { code } = await runCli(["search", "y".repeat(400), "--json"], io);
    expect(code).toBe(0);
  });

  it("says no brands were found for an empty answer", async () => {
    const { io } = seams({ searchResults: { results: [] } });
    const { code, out } = await runCli(["search", "calm fintech"], io);
    expect(code).toBe(0);
    expect(out).toBe("No brands found.\n");
  });

  it("tells the hard stop a paid request is in flight, then that nothing is", async () => {
    const seen: Record<string, string>[] = [];
    const { io } = seams(
      {},
      { inFlight: (params) => seen.push({ ...params }) }
    );
    await runCli(["search", "calm fintech", "--json"], io);
    expect(seen).toEqual([{ paid: "yes" }, {}]);
  });

  it("never offers a blind retry after a network failure in flight", async () => {
    const { io } = seams({
      errors: { search: new CliError("NETWORK", { paid: "yes" }) },
    });
    const { code, doc } = await runCli(
      ["search", "calm fintech", "--json"],
      io
    );
    expect(code).toBe(1);
    expect(doc().error.code).toBe("NETWORK");
    expect(doc().error.hint).toContain("taste history");
    expect(doc().error.retryable).toBe(false);
  });

  it("stops on a 402 with the balance", async () => {
    const { io } = seams({ balance: 0 });
    const { code, doc } = await runCli(
      ["search", "calm fintech", "--json"],
      io
    );
    expect(code).toBe(1);
    expect(doc().error.code).toBe("INSUFFICIENT_CREDITS");
  });

  it("says search is busy, retryable, on a 503", async () => {
    const { io } = seams({ errors: { search: new CliError("SEARCH_BUSY") } });
    const { doc } = await runCli(["search", "calm fintech", "--json"], io);
    expect(doc().error).toMatchObject({ code: "SEARCH_BUSY", retryable: true });
  });

  it("says in its help that it spends credits", async () => {
    const { out } = await runCli(["search", "--help"]);
    expect(out).toContain("spends credits");
    expect(out).toContain("developer_tools");
    expect(out).toContain("landing_page");
  });

  it("maps a refused request to the catalogue, never the server's words", async () => {
    const { io } = seams({
      errors: {
        search: new TasteApiError(422, { serverMessage: "server words" }),
      },
    });
    const { out } = await runCli(["search", "calm fintech", "--json"], io);
    expect(out).not.toContain("server words");
  });
});
