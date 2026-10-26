import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFakeApi } from "./fake-api.ts";
import { envelope, fixtureState, loadFixtures } from "./fixtures.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "taste-fixtures-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(recipe: string, data: Record<string, unknown>, steps = []) {
  writeFileSync(
    join(dir, `${recipe}.json`),
    JSON.stringify({ recipe, paid: false, calls: [], steps, data })
  );
}

const SUBMISSION = {
  submission_id: "sub-recorded",
  status: "completed",
  source_url: "https://example.com/",
  is_public: false,
  kind: "website",
};

describe("fixtures", () => {
  it("reads no fixtures from a folder that does not exist", () => {
    expect(loadFixtures(join(dir, "missing"))).toEqual({});
  });

  it("seeds the fake API with the recorded account and extraction", async () => {
    write("me", {
      me: { user_id: "u-1", email: "person@example.com", role: null },
    });
    write("extract-full", {
      submission: SUBMISSION,
      result: { ...SUBMISSION, result: { design_system: { colors: {} } } },
    });
    const api = createFakeApi(fixtureState(loadFixtures(dir)));
    expect((await api.me()).user_id).toBe("u-1");
    expect((await api.getSubmission("sub-recorded")).status).toBe("completed");
    const result = await api.getResult("sub-recorded");
    expect(result).toMatchObject({ result: { design_system: { colors: {} } } });
  });

  it("keeps a refusal's status and raw envelope", () => {
    write("error-404", {
      error: { status: 404, body: { detail: { error: "NOT_FOUND" } } },
    });
    expect(envelope(loadFixtures(dir), "error-404", "error")).toEqual({
      status: 404,
      body: { detail: { error: "NOT_FOUND" } },
    });
  });

  it("refuses a fixture whose response does not match the API schema", () => {
    write("me", { me: { email: "person@example.com" } });
    expect(() => fixtureState(loadFixtures(dir))).toThrow();
  });

  it("every committed fixture matches the API schemas", () => {
    expect(() => fixtureState(loadFixtures())).not.toThrow();
  });
});
