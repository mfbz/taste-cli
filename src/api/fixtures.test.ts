import { describe, expect, it } from "vitest";

import { createFakeApi } from "./fake-api.ts";
import { fixtureState, loadFixtures } from "./fixtures.ts";

describe("fixtures", () => {
  it("every committed fixture parses and seeds the fake API", async () => {
    const api = createFakeApi(fixtureState(loadFixtures()));
    expect((await api.me()).email).toBe("user@example.com");
    expect((await api.listSubmissions({})).submissions.length).toBeGreaterThan(
      0
    );
  });
});
