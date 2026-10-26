import { describe, expect, it } from "vitest";

import { toErrorReport } from "../output/errors.ts";
import { createFakeApi } from "./fake-api.ts";

describe("createFakeApi", () => {
  it("records each call as method and path", async () => {
    const api = createFakeApi();
    await api.me();
    const { submission_id } = await api.createSubmission({
      url: "https://stripe.com/",
    });
    await api.getSubmission(submission_id);
    expect(api.calls).toEqual([
      "GET /design/me",
      "POST /design/submissions",
      `GET /design/submissions/${submission_id}`,
    ]);
  });

  it("walks a new submission through its steps to a result", async () => {
    const api = createFakeApi();
    const { submission_id: id } = await api.createSubmission({
      url: "https://stripe.com/",
    });
    expect(await api.getResult(id)).toBe("not_ready");
    const seen: string[] = [];
    for (;;) {
      const submission = await api.getSubmission(id);
      seen.push(submission.status);
      if (submission.status === "completed") break;
    }
    expect(seen).toEqual(["queued", "crawling", "extracting", "completed"]);
    const result = await api.getResult(id);
    expect(result).not.toBe("not_ready");
  });

  it("charges credits and answers 402 when they run out", async () => {
    const api = createFakeApi({ balance: 1 });
    await api.search({ query: "calm fintech" });
    const error = await api
      .search({ query: "calm fintech" })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({
      status: 402,
      code: "INSUFFICIENT_CREDITS",
      balance: 0,
      required: 1,
    });
    expect(toErrorReport(error).code).toBe("INSUFFICIENT_CREDITS");
  });

  it("answers 404 for an unknown id", async () => {
    const api = createFakeApi();
    const error = await api.getSubmission("missing").catch((e: unknown) => e);
    expect(toErrorReport(error).code).toBe("NOT_FOUND");
  });

  it("walks an adherence job to a verdict", async () => {
    const api = createFakeApi();
    const { job_id: id } = await api.createAdherence({
      reference_url: "https://a.com/",
      candidate_url: "https://b.com/",
    });
    expect(await api.getVerdict(id)).toBe("not_ready");
    while ((await api.getAdherence(id)).status !== "completed");
    const verdict = await api.getVerdict(id);
    expect(verdict).toMatchObject({ job_id: id, status: "completed" });
  });

  it("throws an injected error for one method", async () => {
    const boom = Object.assign(new Error("x"), { status: 500 });
    const api = createFakeApi({ errors: { me: boom } });
    await expect(api.me()).rejects.toBe(boom);
  });

  it("lists, filters and pages submissions", async () => {
    const api = createFakeApi();
    for (const url of ["https://a.com/", "https://b.com/", "https://c.com/"])
      await api.createSubmission({ url });
    const page = await api.listSubmissions({ limit: 2, offset: 1 });
    expect(page.total).toBe(3);
    expect(page.submissions.map((s) => s.source_url)).toEqual([
      "https://b.com/",
      "https://a.com/",
    ]);
    const found = await api.listSubmissions({ q: "c.com" });
    expect(found.submissions).toHaveLength(1);
  });

  it("serves downloads only for known asset URLs", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const api = createFakeApi({
      downloads: { "https://cdn.test/a.png": bytes },
    });
    expect(await api.download("https://cdn.test/a.png")).toEqual(bytes);
    await expect(api.download("https://cdn.test/b.png")).rejects.toMatchObject({
      status: 404,
    });
  });
});
