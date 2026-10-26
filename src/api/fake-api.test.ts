import { describe, expect, it } from "vitest";

import { createFakeApi } from "./fake-api.ts";

describe("createFakeApi", () => {
  it("walks a new submission to its result, recording each call", async () => {
    const api = createFakeApi();
    const { submission_id: id } = await api.createSubmission({
      url: "https://stripe.com/",
    });
    expect(await api.getResult(id)).toBe("not_ready");
    while ((await api.getSubmission(id)).status !== "completed");
    expect(await api.getResult(id)).toMatchObject({ submission_id: id });
    expect(api.calls.slice(0, 2)).toEqual([
      "POST /design/submissions",
      `GET /design/submissions/${id}/result`,
    ]);
  });
});
