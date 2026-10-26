import { describe, expect, it } from "vitest";

import { ADHERENCE_VERDICT } from "../api/schemas.ts";
import { fixtures } from "../job-seams.ts";
import { createTheme } from "../output/theme.ts";
import { renderVerdict } from "./verdict.ts";

const theme = createTheme(0);
const fail = ADHERENCE_VERDICT.parse(fixtures["check-fail"]?.data.verdict);

describe("renderVerdict", () => {
  it("shows the score with a 20-cell bar, and a glyph only against a minimum", () => {
    const bar = `0.15  ${"█".repeat(3)}${"░".repeat(17)}`;
    expect(renderVerdict(fail, theme, 80)).toContain(bar);
    expect(renderVerdict(fail, theme, 80)).not.toContain("✗");
    expect(renderVerdict(fail, theme, 80, 0.8)).toContain("✗ min 0.80");
  });

  it("draws no bar for a partial verdict whose score is still null", () => {
    const text = renderVerdict({ ...fail, score: null }, theme, 80);
    expect(text).not.toMatch(/[█░]/);
  });

  it("sums the fixes by action, shows the first three, and ends with the share hint", () => {
    const text = renderVerdict(fail, theme, 200);
    expect(text).toContain("20 fixes: snap_to_token 19, align_profile_field 1");
    expect(text).toContain(
      "align_profile_field  field: brand_name, from: Stripe, to_value: Taste"
    );
    expect(text).toContain("and 17 more");
    expect(text).toContain(`taste share ${fail.job_id}`);
  });
});
