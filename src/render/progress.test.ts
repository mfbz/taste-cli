import { describe, expect, it } from "vitest";

import { createTheme } from "../output/theme.ts";
import { renderDone, renderProgressLine, renderStepNote } from "./progress.ts";

const plain = createTheme(0);

describe("progress", () => {
  it("is a spinner frame, the step in words and the elapsed time, short of the last column", () => {
    expect(renderProgressLine(0, "data_display", 12_000, plain, 80)).toBe(
      "⠋ Data display · 12s"
    );
    const step = "analyzing\u001b[2J_the_brand_guidelines_in_great_detail";
    const line = renderProgressLine(0, step, 125_000, plain, 30);
    expect([...line].length).toBe(29);
    expect(line).toMatch(/^⠋ Analyzing\[2J the.*… · 2m 05s$/);
  });

  it("is one note per step elsewhere, and closes with the time or cached", () => {
    expect(renderStepNote("extracting", 3_000, plain)).toBe("Extracting · 3s");
    expect(renderDone("Extracted Taste", 48_000, false, plain)).toBe(
      "✓ Extracted Taste in 48s"
    );
    expect(renderDone("Extracted Taste", 2_000, true, plain)).toBe(
      "✓ Extracted Taste (cached)"
    );
  });
});
