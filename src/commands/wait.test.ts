import { describe, expect, it } from "vitest";

import { runCli } from "../fake-io.ts";
import { fixtures, jobSeams, recorded } from "./job-seams.ts";

const SUBMISSION = "00000000-0000-4000-8000-000000000200";
const CHECK = "00000000-0000-4000-8000-000000000900";
const verdict = fixtures["check-pass"]?.data.verdict;

describe("taste wait", () => {
  it("picks up an extraction and shows it as extract would", async () => {
    const { api, io } = jobSeams();
    const { code, out } = await runCli(["wait", SUBMISSION], io);
    expect(code).toBe(0);
    expect(out).toContain("Stripe");
    expect(out).toContain("#533AFD");
    expect(api.calls.at(-1)).toBe(
      `GET /design/submissions/${SUBMISSION}/result`
    );
    const json = await runCli(["wait", SUBMISSION, "--json"], io);
    expect(json.doc().data).toEqual(recorded("extract-full-2"));
  });

  it("routes an adherence job's id to its verdict", async () => {
    const { api, io } = jobSeams();
    const { code, out, err } = await runCli(["wait", CHECK], io);
    expect(code).toBe(0);
    expect(api.calls).toEqual([
      `GET /design/submissions/${CHECK}`,
      `GET /judge/brand-adherence/${CHECK}`,
      `GET /judge/brand-adherence/${CHECK}/result`,
    ]);
    expect(out).toContain("0.90");
    expect(out).toContain("https://tastelabs.com/");
    expect(out).toContain("Tighten the inter-section vertical gaps");
    expect(err).toContain("✓ Checked tastelabs.com");
    const json = await runCli(["wait", CHECK, "--json"], io);
    expect(json.doc()).toEqual({ ok: true, data: verdict });
  });

  it("follows a running adherence job to its verdict", async () => {
    const { api, io } = jobSeams();
    const job = await api.createAdherence({
      reference_url: "https://stripe.com/",
      candidate_url: "https://example.com/",
    });
    const { code, err, doc } = await runCli(["wait", job.job_id, "--json"], io);
    expect(code).toBe(0);
    expect(err).toBe("");
    expect(doc().data).toMatchObject({ job_id: job.job_id, score: 0.82 });
  });

  it("says Taste has nothing with an id it doesn't know", async () => {
    const { io } = jobSeams();
    const { code, doc } = await runCli(["wait", "nope-1", "--json"], io);
    expect(code).toBe(1);
    expect(doc().error.code).toBe("NOT_FOUND");
  });

  it("ends Ctrl-C with the same id to wait on again", async () => {
    const interrupt = new AbortController();
    const { api, io } = jobSeams(
      {},
      {
        signal: interrupt.signal,
        sleep: () => {
          interrupt.abort();
          return Promise.resolve();
        },
      }
    );
    const job = await api.createSubmission({ url: "https://stripe.com/" });
    const { code, doc } = await runCli(
      ["wait", job.submission_id, "--json"],
      io
    );
    expect(code).toBe(130);
    expect(doc().error.hint).toContain(`taste wait ${job.submission_id}`);
  });

  it("is free, and says so nowhere as spending", async () => {
    const { out } = await runCli(["wait", "--help"]);
    expect(out).not.toMatch(/spends credits/i);
  });
});
