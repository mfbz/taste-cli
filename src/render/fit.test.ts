import { describe, expect, it } from "vitest";

import { fit } from "./fit.ts";

describe("fit", () => {
  it("keeps text that fits and cuts the rest with an ellipsis", () => {
    expect(fit("Stripe", 10)).toBe("Stripe");
    expect(fit("Stripe", 6)).toBe("Stripe");
    expect(fit("Stripe", 4)).toBe("Str…");
    expect(fit("Stripe", 0)).toBe("");
  });
});
