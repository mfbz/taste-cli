import { describe, expect, it } from "vitest";

import { loadFixtures } from "../src/api/fixtures.ts";
import { check, fakeId, normalise } from "./scrub-fixtures.ts";

// Built at run time, so the guards never see a token-shaped literal here.
const REAL = "7d3f2a10-5b6c-4e8f-9a0b-1c2d3e4f5a6b";
const EXTRACTION = "a1b2c3d4-0000-4e8f-9a0b-1c2d3e4f5a6b";
const JWT = ["eyJ" + "hbGciOiJIUzI1NiJ9", "eyJ" + "zdWIiOiIxIn0", "c2ln"].join(
  "."
);

describe("normalise", () => {
  it("maps the ids each recipe created to its fixed fake UUIDs, everywhere", () => {
    const docs = normalise({
      "extract-full": {
        calls: [`GET /design/submissions/${REAL} 200`],
        data: {
          accepted: { submission_id: REAL },
          result: { extraction_id: EXTRACTION },
        },
      },
      manifest: { data: { manifest: { submission_id: REAL } } },
    });
    expect(JSON.stringify(docs)).not.toContain(REAL);
    expect(JSON.stringify(docs)).not.toContain(EXTRACTION);
    expect(docs["extract-full"]).toMatchObject({
      calls: [`GET /design/submissions/${fakeId("extract-full")} 200`],
      data: { result: { extraction_id: fakeId("extract-full", 1) } },
    });
    expect(docs.manifest).toEqual({
      data: { manifest: { submission_id: fakeId("extract-full") } },
    });
  });

  it("strips the query and fragment from URLs off the Taste API", () => {
    const docs = normalise({
      manifest: {
        signed: "https://bucket.s3.amazonaws.com/a.png?X-Amz-Signature=abc#x",
        api: "https://api.tastelabs.com/design/submissions?limit=5",
      },
    });
    expect(docs.manifest).toEqual({
      signed: "https://bucket.s3.amazonaws.com/a.png",
      api: "https://api.tastelabs.com/design/submissions?limit=5",
    });
  });
});

describe("check", () => {
  it("fails on an email, a JWT and an unmapped UUID, naming file and path", () => {
    expect(
      check("kit", {
        data: {
          contact: ["maintainer", "real-domain.io"].join("@"),
          echoed: JWT,
          job: { user_id: REAL },
        },
      })
    ).toEqual([
      "kit.json:.data.contact email",
      "kit.json:.data.echoed JWT",
      "kit.json:.data.job.user_id unmapped UUID",
    ]);
  });

  it("passes normalised public content and the placeholders", () => {
    const docs = normalise({
      "extract-full": {
        data: {
          accepted: { submission_id: REAL },
          logo: "https://cdn.example.com/logo@2x.png?token=t",
          me: "user@example.com",
        },
      },
    });
    expect(check("extract-full", docs["extract-full"])).toEqual([]);
  });
});

describe("the hand-written fixtures", () => {
  const fixtures = loadFixtures();

  it("point their history at the ids the recorded recipes get", () => {
    const text = JSON.stringify(fixtures.history);
    for (const recipe of [
      "extract-full",
      "extract-full-2",
      "search-fast",
      "check-pass",
    ])
      expect(text).toContain(fakeId(recipe));
  });

  it("pass the same check as recordings", () => {
    for (const name of ["me", "history"])
      expect(check(name, fixtures[name])).toEqual([]);
  });
});
