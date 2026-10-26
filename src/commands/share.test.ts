import { describe, expect, it } from "vitest";

import { runCli } from "../fake-io.ts";
import { jobSeams } from "../job-seams.ts";

const SUBMISSION = "00000000-0000-4000-8000-000000000200";
const CHECK = "00000000-0000-4000-8000-000000000900";

describe("taste share", () => {
  it("makes an extraction public and gives its public result address", async () => {
    const { api, io } = jobSeams();
    const { code, doc } = await runCli(["share", SUBMISSION, "--json"], io);
    expect(code).toBe(0);
    expect(doc().data).toEqual({
      id: SUBMISSION,
      public: true,
      url: `https://api.tastelabs.com/design/submissions/${SUBMISSION}/result`,
    });
    expect(api.calls).toEqual([
      `PATCH /design/submissions/${SUBMISSION}/visibility`,
    ]);
    expect((await api.getSubmission(SUBMISSION)).is_public).toBe(true);
  });

  it("makes it private again with --private", async () => {
    const { api, io } = jobSeams();
    await runCli(["share", SUBMISSION], io);
    const { code, out, doc } = await runCli(
      ["share", SUBMISSION, "--private", "--json"],
      io
    );
    expect(code).toBe(0);
    expect(doc().data).toEqual({ id: SUBMISSION, public: false, url: null });
    expect(out).not.toContain("/result");
    expect((await api.getSubmission(SUBMISSION)).is_public).toBe(false);
  });

  it("routes a check's id to the check, as wait does", async () => {
    const { api, io } = jobSeams();
    const { code, out } = await runCli(["share", CHECK], io);
    expect(code).toBe(0);
    expect(api.calls).toEqual([
      `PATCH /design/submissions/${CHECK}/visibility`,
      `PATCH /judge/brand-adherence/${CHECK}/visibility`,
    ]);
    expect(out).toContain(
      `https://api.tastelabs.com/judge/brand-adherence/${CHECK}/result`
    );
    expect(out).toContain("Anyone with this address");
  });

  it("uses TASTE_API_URL for the address", async () => {
    const { io } = jobSeams(
      {},
      { env: { TASTE_API_URL: "http://127.0.0.1:4010" } }
    );
    const { doc } = await runCli(["share", SUBMISSION, "--json"], io);
    expect(doc().data.url).toBe(
      `http://127.0.0.1:4010/design/submissions/${SUBMISSION}/result`
    );
  });

  it("says Taste has nothing with an id it doesn't know", async () => {
    const { io } = jobSeams();
    const { code, doc } = await runCli(["share", "nope-1", "--json"], io);
    expect(code).toBe(1);
    expect(doc().error.code).toBe("NOT_FOUND");
  });

  it("is free, and says so nowhere as spending", async () => {
    const { out } = await runCli(["share", "--help"]);
    expect(out).not.toMatch(/spends credits/i);
  });
});
