import { describe, expect, it } from "vitest";

import { loadFixtures } from "../src/api/fixtures.ts";
import {
  check,
  FAKE_USER,
  fakeId,
  missingNeeds,
  normalise,
} from "./scrub-fixtures.ts";

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

  it("maps only whole UUIDs, so short ids and names stay and nothing is corrupted", () => {
    const doc = {
      data: {
        accepted: { submission_id: REAL },
        design_system: { components: [{ id: "1" }, { id: "button" }] },
        text: "button 1 at 10px, see job 1",
      },
    };
    const out = normalise({ "extract-full": doc })["extract-full"];
    expect(out).toEqual({
      data: {
        accepted: { submission_id: fakeId("extract-full") },
        design_system: { components: [{ id: "1" }, { id: "button" }] },
        text: "button 1 at 10px, see job 1",
      },
    });
  });

  it("maps any other UUID too, after the recipe's own ids, the same one to the same fake", () => {
    const ASSET = "5d76aea7-a0b9-410d-9cf5-dc12cba42bb8";
    const url = `https://cdn.example/artifacts/${EXTRACTION}/x/${ASSET}.jpg`;
    const docs = normalise({
      "extract-full": {
        data: {
          accepted: { submission_id: REAL },
          assets: [{ url }, { url }],
        },
      },
    });
    const fake = `https://cdn.example/artifacts/${fakeId("extract-full", 1)}/x/${fakeId("extract-full", 2)}.jpg`;
    expect(docs["extract-full"]).toEqual({
      data: {
        accepted: { submission_id: fakeId("extract-full") },
        assets: [{ url: fake }, { url: fake }],
      },
    });
    expect(check("extract-full", docs["extract-full"])).toEqual([]);
  });

  it("sets the account metadata keys to fixed values at any depth", () => {
    const out = normalise({
      "check-pass": {
        data: {
          job: {
            user_id: REAL,
            api_key_name: "maintainer-laptop",
            credit_ref_id: "cr-1",
            batch_id: "b-1",
            batch_label: "launch",
          },
        },
      },
    });
    expect(out["check-pass"]).toEqual({
      data: {
        job: {
          user_id: FAKE_USER,
          api_key_name: "example",
          credit_ref_id: null,
          batch_id: null,
          batch_label: null,
        },
      },
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

  it("catches encoded and non-ASCII emails, glued UUIDs and credential params on any host", () => {
    const found = (value: string) =>
      check("x", { value }).map((p) => p.split(" ").slice(1).join(" "));
    expect(
      found(`https://example.org/?to=${["me", "real.io"].join("%40")}`)
    ).toEqual(["email"]);
    expect(found(["josé", "real.io"].join("@"))).toEqual(["email"]);
    expect(found(`${REAL}_logo.png`)).toEqual(["unmapped UUID"]);
    expect(found(`job${REAL}`)).toEqual(["unmapped UUID"]);
    expect(found("https://api.tastelabs.com/f?X-Amz-Credential=a")).toEqual([
      "credential in a URL",
    ]);
    expect(
      found("https://cdn.example.org/a?client_secret=s&auth_code=c")
    ).toEqual(["credential in a URL"]);
    expect(
      found(
        `https://api.tastelabs.com/design/submissions/${fakeId("kit")}?limit=5`
      )
    ).toEqual([]);
  });

  it("asks for the recording a recipe builds on, so fake numbering stays stable", () => {
    expect(missingNeeds({ manifest: {} })).toEqual([
      "manifest.json: record extract-full too, its ids come first",
    ]);
    expect(missingNeeds({ manifest: {}, "extract-full": {} })).toEqual([]);
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

describe("the committed fixtures", () => {
  // A later hand edit, or a hand-written fixture (me, history), must not slip anything personal past npm test.
  it("all pass the check", () => {
    for (const [name, doc] of Object.entries(loadFixtures()))
      expect(check(name, doc)).toEqual([]);
  });
});
