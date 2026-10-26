import { describe, expect, it } from "vitest";

import { createTheme } from "../output/theme.ts";
import {
  formatElapsed,
  humanizeStep,
  renderDone,
  renderProgressLine,
  renderStepNote,
} from "./progress.ts";

const plain = createTheme(0);

describe("humanizeStep", () => {
  it("turns an API step into words", () => {
    expect(humanizeStep("crawling")).toBe("Crawling");
    expect(humanizeStep("data_display")).toBe("Data display");
    expect(humanizeStep("")).toBe("Working");
  });

  it("strips control characters from the server's step", () => {
    expect(humanizeStep("render\u001b[2Jing")).toBe("Render[2Jing");
  });
});

describe("formatElapsed", () => {
  it("shows seconds, then minutes and seconds", () => {
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(12_400)).toBe("12s");
    expect(formatElapsed(65_000)).toBe("1m 05s");
  });
});

describe("renderProgressLine", () => {
  it("is a spinner frame, the step and the elapsed time", () => {
    expect(renderProgressLine(0, "crawling", 12_000, plain)).toBe(
      "⠋ Crawling · 12s"
    );
    expect(renderProgressLine(11, "crawling", 0, plain)).toBe(
      "⠙ Crawling · 0s"
    );
  });
});

describe("renderStepNote", () => {
  it("is the step and the elapsed time, without a spinner", () => {
    expect(renderStepNote("extracting", 3_000, plain)).toBe("Extracting · 3s");
  });
});

describe("renderDone", () => {
  it("says what was done and how long it took", () => {
    expect(renderDone("Extracted Taste", 48_000, false, plain)).toBe(
      "✓ Extracted Taste in 48s"
    );
  });

  it("says cached instead of a time for a cache hit", () => {
    expect(renderDone("Extracted Taste", 2_000, true, plain)).toBe(
      "✓ Extracted Taste (cached)"
    );
  });
});
