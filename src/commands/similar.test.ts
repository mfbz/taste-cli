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
  it("shows the recorded similar brands of an extraction's id as cards, and --json as recorded", async () => {
    const { api, io, sent } = seams();
    const { code, out } = await runCli(["similar", TASTELABS], io);
    expect(code).toBe(0);
    expect(api.calls).toEqual(["GET /search/similar"]);
    expect(sent).toEqual([[TASTELABS, undefined]]);
    expect(out).toMatch(/^ *1 {2}runway {2}strong/m);
    const json = await runCli(["similar", TASTELABS, "--json"], io);
    expect(json.doc()).toEqual({ ok: true, data: recorded });
  });

  it("finds the extraction of an address first, for free, and sends --top", async () => {
    const { api, io, sent } = seams();
    await runCli(["similar", "tastelabs.com", "--top", "5", "--json"], io);
    expect(api.calls).toEqual([
      "GET /design/submissions",
      "GET /search/similar",
    ]);
    expect(sent).toEqual([[TASTELABS, 5]]);
  });

  it("spends nothing on an address with no full extraction, and maps a selective id's 422", async () => {
    for (const [brand, code] of [
      ["example.org", "NOT_FOUND"],
      ["linear.app", "FULL_EXTRACTION_REQUIRED"],
      [LINEAR_SELECTIVE, "FULL_EXTRACTION_REQUIRED"],
    ] as const) {
      const { io } = seams();
      const run = await runCli(["similar", brand, "--json"], io);
      expect(run.code).toBe(1);
      expect(run.doc().error.code, brand).toBe(code);
      expect(run.doc().error.hint).toContain("taste extract");
    }
  });

  it("refuses a bare word or a --top out of range with exit 2, and sends nothing", async () => {
    const { api, io } = seams();
    for (const argv of [
      ["similar", "stripe"],
      ["similar", TASTELABS, "--top", "0"],
      ["similar", TASTELABS, "--top", "31"],
      ["similar", TASTELABS, "--top", "two"],
    ])
      expect((await runCli(argv, io)).code).toBe(2);
    expect(api.calls).toEqual([]);
  });

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
    const { doc } = await runCli(["similar", TASTELABS, "--json"], offline());
    expect(doc().error).toMatchObject({
      code: "NETWORK",
      hint: "It may have reached Taste and been charged. Check taste history searches before you run it again, so you don't pay twice.",
      retryable: false,
    });
  });

  it("says in its help that it spends credits", async () => {
    const { out } = await runCli(["similar", "--help"]);
    expect(out).toContain("spends credits");
  });
});
