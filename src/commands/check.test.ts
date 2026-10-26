import { describe, expect, it } from "vitest";

import { ADHERENCE_VERDICT } from "../api/schemas.ts";
import type { AdherenceVerdict } from "../api/schemas.ts";
import { offline, runCli } from "../fake-io.ts";
import { fixtures, jobSeams } from "../job-seams.ts";

const failed = ADHERENCE_VERDICT.parse(fixtures["check-fail"]?.data.verdict);
const passed = ADHERENCE_VERDICT.parse(fixtures["check-pass"]?.data.verdict);

// The fake hands out job-1 for the first check; seed it with a recorded verdict.
async function check(verdict: AdherenceVerdict, ...flags: string[]) {
  const { io } = jobSeams({
    verdicts: { "job-1": { ...verdict, job_id: "job-1" } },
  });
  return runCli(
    ["check", "preview.acme.com", "--against", "acme.com", ...flags],
    io
  );
}

describe("taste check", () => {
  it("shows the verdict", async () => {
    const { code, out } = await check(passed);
    expect(code).toBe(0);
    expect(out).toContain("0.90");
    expect(out).toContain("1. Tighten the inter-section vertical gaps");
    expect(out).toContain("taste share job-1");
  });

  it("fails below --min with BELOW_THRESHOLD and the verdict in details", async () => {
    const { code, doc } = await check(failed, "--min", "0.8", "--json");
    expect(code).toBe(1);
    expect(doc().error).toMatchObject({
      code: "BELOW_THRESHOLD",
      details: { id: "job-1", score: 0.15, passed: false, min: 0.8 },
    });
  });

  it("passes at or above --min", async () => {
    const { code, doc } = await check(passed, "--min", "0.8", "--json");
    expect(code).toBe(0);
    expect(doc().data).toMatchObject({ score: 0.9, passed: true, min: 0.8 });
  });

  it("exits 0 without --min, with passed and min null", async () => {
    const { code, doc } = await check(failed, "--json");
    expect(code).toBe(0);
    expect(doc().data).toMatchObject({ score: 0.15, passed: null, min: null });
  });

  it("refuses --min outside 0 to 1 as a usage error", async () => {
    const { code } = await check(passed, "--min", "2", "--json");
    expect(code).toBe(2);
  });

  it("points a network failure during the paid request at taste history checks", async () => {
    const { doc } = await runCli(
      ["check", "a.com", "--against", "b.com", "--json"],
      offline()
    );
    expect(doc().error.hint).toContain("taste history checks");
  });
});
