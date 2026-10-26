import { describe, expect, it } from "vitest";

import {
  ADHERENCE_JOB,
  ADHERENCE_VERDICT,
  BRAND_SEARCH_RESULTS,
  SEARCH_SUBMISSION_LIST,
  SUBMISSION,
  SUBMISSION_LIST,
  SUBMISSION_STATUS,
} from "./schemas.ts";

const SUBMISSION_BODY = {
  submission_id: "sub-1",
  status: "completed",
  source_url: "https://stripe.com/",
  is_public: false,
};
const VERDICT_BODY = {
  job_id: "job-1",
  status: "completed",
  reference_url: "https://a.com/",
  candidate_url: "https://b.com/",
  accepted_at: "2026-10-26T10:00:00Z",
  score: 0.5,
  recommendations: [],
  fixes: [],
};

describe("response schemas", () => {
  it("accept a submission status and kind the server adds later", () => {
    const parsed = SUBMISSION.parse({
      ...SUBMISSION_BODY,
      status: "verifying",
      kind: "mobile_app",
    });
    expect(parsed.status).toBe("verifying");
    expect(parsed.kind).toBe("mobile_app");
  });

  it("keep a whole list page when one row has a new status", () => {
    const parsed = SUBMISSION_LIST.parse({
      submissions: [SUBMISSION_BODY, { ...SUBMISSION_BODY, status: "new" }],
      total: 2,
      limit: 50,
      offset: 0,
    });
    expect(parsed.submissions).toHaveLength(2);
  });

  it("accept an adherence status the server adds later", () => {
    expect(
      ADHERENCE_JOB.parse({ ...VERDICT_BODY, status: "rendering" }).status
    ).toBe("rendering");
  });

  it("accept a new match tier and depth on a paid search", () => {
    const parsed = BRAND_SEARCH_RESULTS.parse({
      depth: "deepest",
      results: [
        { url: "https://x.com/", identity_paragraph: "x", match: "perfect" },
      ],
    });
    expect(parsed.results[0]?.match).toBe("perfect");
    expect(parsed.depth).toBe("deepest");
  });

  it("accept a new kind in search history", () => {
    expect(
      SEARCH_SUBMISSION_LIST.parse({
        submissions: [{ id: "s-1", kind: "visual", depth: "deepest" }],
      }).submissions[0]?.kind
    ).toBe("visual");
  });

  it("accept a verdict score outside 0 to 1, and a null one", () => {
    expect(ADHERENCE_VERDICT.parse({ ...VERDICT_BODY, score: 87 }).score).toBe(
      87
    );
    expect(
      ADHERENCE_VERDICT.parse({ ...VERDICT_BODY, score: null }).score
    ).toBeNull();
  });

  it("keep the strict enums for validating what a person types", () => {
    expect(SUBMISSION_STATUS.safeParse("verifying").success).toBe(false);
    expect(SUBMISSION_STATUS.safeParse("crawling").success).toBe(true);
  });
});
