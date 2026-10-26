import { describe, expect, it } from "vitest";

import { offline, runCli } from "../fake-io.ts";
import { fixtures, jobSeams } from "../job-seams.ts";

const TASTELABS = "00000000-0000-4000-8000-000000000100";
const LINEAR_SELECTIVE = "00000000-0000-4000-8000-000000000300";
const recorded = fixtures["similar"]?.data.results;

function seams(...args: Parameters<typeof jobSeams>) {
  const { api, io } = jobSeams(...args);
  const sent: [string, number | undefined][] = [];
  const similar = api.similar.bind(api);
  api.similar = (id, topK) => {
    sent.push([id, topK]);
    return similar(id, topK);
  };
  return { api, io, sent };
}

describe("taste similar", () => {
  it("shows the recorded similar brands of an extraction's id as cards", async () => {
    const { api, io, sent } = seams();
    const { code, out } = await runCli(["similar", TASTELABS], io);
    expect(code).toBe(0);
    expect(api.calls).toEqual(["GET /search/similar"]);
    expect(sent).toEqual([[TASTELABS, undefined]]);
    expect(out).toMatch(/^ *1 {2}runway {2}strong/m);
    expect(out).toContain("taste extract <url>");
  });

  it("passes the recorded answer through under --json", async () => {
    const { io } = seams();
    const { code, doc } = await runCli(["similar", TASTELABS, "--json"], io);
    expect(code).toBe(0);
    expect(doc()).toEqual({ ok: true, data: recorded });
  });

  it("finds the extraction of an address first, for free, and sends --top", async () => {
    const { api, io, sent } = seams();
    const { code } = await runCli(
      ["similar", "tastelabs.com", "--top", "5", "--json"],
      io
    );
    expect(code).toBe(0);
    expect(api.calls).toEqual([
      "GET /design/submissions",
      "GET /search/similar",
    ]);
    expect(sent).toEqual([[TASTELABS, 5]]);
  });

  it("says to extract an address it has no extraction of, and spends nothing", async () => {
    const { api, io } = seams();
    const { code, doc } = await runCli(
      ["similar", "example.org", "--json"],
      io
    );
    expect(code).toBe(1);
    expect(doc().error.code).toBe("NOT_FOUND");
    expect(doc().error.hint).toContain("taste extract https://example.org/");
    expect(api.calls).toEqual(["GET /design/submissions"]);
  });

  it("asks for a full extraction when the address has only a selective one", async () => {
    const { api, io } = seams();
    const { code, doc } = await runCli(["similar", "linear.app", "--json"], io);
    expect(code).toBe(1);
    expect(doc().error.code).toBe("FULL_EXTRACTION_REQUIRED");
    expect(doc().error.hint).toContain("taste extract https://linear.app/");
    expect(api.calls).toEqual(["GET /design/submissions"]);
  });

  it("maps the API's 422 for a selective extraction's id to the same code", async () => {
    const { io } = seams();
    const { code, doc } = await runCli(
      ["similar", LINEAR_SELECTIVE, "--json"],
      io
    );
    expect(code).toBe(1);
    expect(doc().error.code).toBe("FULL_EXTRACTION_REQUIRED");
    expect(doc().error.hint).toContain("taste extract");
  });

  it("is NOT_FOUND for an unknown id", async () => {
    const { io } = seams();
    const { doc } = await runCli(
      ["similar", "00000000-0000-4000-8000-00000000dead", "--json"],
      io
    );
    expect(doc().error.code).toBe("NOT_FOUND");
  });

  it("refuses a bare word with exit 2, suggesting the address, and sends nothing", async () => {
    const { api, io } = seams();
    const { code, err } = await runCli(["similar", "stripe"], io);
    expect(code).toBe(2);
    expect(err).toContain("stripe.com");
    expect(api.calls).toEqual([]);
  });

  it.each(["0", "31", "two"])(
    "refuses --top %s with no request",
    async (top) => {
      const { api, io } = seams();
      const { code } = await runCli(["similar", TASTELABS, "--top", top], io);
      expect(code).toBe(2);
      expect(api.calls).toEqual([]);
    }
  );

  it("tells the hard stop only the paid request is in flight", async () => {
    const seen: Record<string, string>[] = [];
    const { io } = seams(
      {},
      { inFlight: (params) => seen.push({ ...params }) }
    );
    await runCli(["similar", "tastelabs.com", "--json"], io);
    expect(seen).toEqual([{ paid: "search" }, {}]);
  });

  it("never offers a blind retry after a network failure in flight", async () => {
    const { code, doc } = await runCli(
      ["similar", TASTELABS, "--json"],
      offline()
    );
    expect(code).toBe(1);
    expect(doc().error.code).toBe("NETWORK");
    expect(doc().error.hint).toBe(
      "It may have reached Taste and been charged. Check taste history searches before you run it again, so you don't pay twice."
    );
    expect(doc().error.retryable).toBe(false);
  });

  it("says in its help that it spends credits", async () => {
    const { out } = await runCli(["similar", "--help"]);
    expect(out).toContain("spends credits");
  });
});
