import { describe, expect, it } from "vitest";

import { runCli } from "../fake-io.ts";
import { jobSeams } from "../job-seams.ts";

const SUBMISSION = "00000000-0000-4000-8000-000000000200";
const CHECK = "00000000-0000-4000-8000-000000000900";

describe("taste share", () => {
  it("makes an extraction public at its result address on TASTE_API_URL, and private again", async () => {
    const { api, io } = jobSeams(
      {},
      { env: { TASTE_API_URL: "http://127.0.0.1:4010" } }
    );
    const shared = await runCli(["share", SUBMISSION, "--json"], io);
    expect(shared.doc().data).toEqual({
      id: SUBMISSION,
      public: true,
      url: `http://127.0.0.1:4010/design/submissions/${SUBMISSION}/result`,
    });
    expect(api.calls).toEqual([
      `PATCH /design/submissions/${SUBMISSION}/visibility`,
    ]);
    const hidden = await runCli(
      ["share", SUBMISSION, "--private", "--json"],
      io
    );
    expect(hidden.doc().data).toEqual({
      id: SUBMISSION,
      public: false,
      url: null,
    });
    expect((await api.getSubmission(SUBMISSION)).is_public).toBe(false);
  });

  it("routes a check's id to the check, as wait does, and an unknown one is NOT_FOUND", async () => {
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
    const unknown = await runCli(["share", "nope-1", "--json"], io);
    expect(unknown.doc().error.code).toBe("NOT_FOUND");
  });

  it("fails clearly when Taste's answer doesn't say whether it is public", async () => {
    const { api, io } = jobSeams();
    const silent = { ...(await api.getAdherence(CHECK)), is_public: undefined };
    const quiet = {
      ...api,
      setAdherenceVisibility: () => Promise.resolve(silent),
    };
    const { code, doc } = await runCli(["share", CHECK, "--json"], {
      ...io,
      api: quiet,
    });
    expect(code).toBe(1);
    expect(doc().error).toMatchObject({
      code: "VISIBILITY_UNKNOWN",
      retryable: true,
    });
  });
});
