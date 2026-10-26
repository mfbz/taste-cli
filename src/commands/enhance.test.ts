import { describe, expect, it } from "vitest";

import { ENHANCE_RESPONSE } from "../api/schemas.ts";
import { runCli } from "../fake-io.ts";
import { fixtures, jobSeams } from "../job-seams.ts";

const TASTELABS = "00000000-0000-4000-8000-000000000100";
const LINEAR_SELECTIVE = "00000000-0000-4000-8000-000000000300";
const recorded = ENHANCE_RESPONSE.parse(fixtures["enhance"]?.data.enhanced);

function seams(...args: Parameters<typeof jobSeams>) {
  const { api, io } = jobSeams(...args);
  const sent: { submission_id: string; prompt: string }[] = [];
  const enhance = api.enhance.bind(api);
  api.enhance = (body) => {
    sent.push(body);
    return enhance(body);
  };
  return { api, io, sent };
}

describe("taste enhance", () => {
  it("prints the enhanced prompt alone on stdout, exactly, and the brand on stderr", async () => {
    const { api, io, sent } = seams();
    const { code, out, err } = await runCli(
      ["enhance", "Design a pricing page", "--brand", TASTELABS],
      io
    );
    expect(code).toBe(0);
    expect(api.calls).toEqual(["POST /design/prompts/enhance"]);
    expect(sent).toEqual([
      { submission_id: TASTELABS, prompt: "Design a pricing page" },
    ]);
    expect(recorded.enhanced_prompt.endsWith("\n")).toBe(false);
    expect(out).toBe(`${recorded.enhanced_prompt}\n`);
    // The recorded answer names no brand, so the line names what was given.
    expect(recorded.brand_name).toBe("");
    expect(err).toContain(`Enhanced for ${TASTELABS}`);
  });

  it("adds no second newline to a prompt that ends with one", async () => {
    const { io } = seams({
      enhanced: { enhanced_prompt: "Line one.\nLine two.\n" },
    });
    const { out } = await runCli(
      ["enhance", "a pricing page", "--brand", TASTELABS],
      io
    );
    expect(out).toBe("Line one.\nLine two.\n");
  });

  it("strips control characters but keeps newlines and tabs", async () => {
    const { io } = seams({
      enhanced: { enhanced_prompt: "A\u001b]0;x\u0007 page.\n\tTabbed." },
    });
    const { out } = await runCli(
      ["enhance", "a pricing page", "--brand", TASTELABS],
      io
    );
    expect(out).toBe("A]0;x page.\n\tTabbed.\n");
  });

  it("passes the recorded answer through under --json", async () => {
    const { io } = seams();
    const { code, out, err, doc } = await runCli(
      ["enhance", "Design a pricing page", "--brand", TASTELABS, "--json"],
      io
    );
    expect(code).toBe(0);
    expect(err).toBe("");
    expect(out.trim().split("\n")).toHaveLength(1);
    expect(doc()).toEqual({ ok: true, data: recorded });
  });

  it("finds the brand's extraction by address first, for free", async () => {
    const { api, io, sent } = seams();
    const { code, err } = await runCli(
      ["enhance", "a pricing page", "--brand", "https://www.tastelabs.com/"],
      io
    );
    expect(code).toBe(0);
    expect(api.calls).toEqual([
      "GET /design/submissions",
      "POST /design/prompts/enhance",
    ]);
    expect(sent[0]?.submission_id).toBe(TASTELABS);
    expect(err).toContain("Enhanced for www.tastelabs.com");
  });

  it("asks for a full extraction for a selective id or address", async () => {
    const { io } = seams();
    for (const brand of [LINEAR_SELECTIVE, "linear.app"]) {
      const { code, doc } = await runCli(
        ["enhance", "a pricing page", "--brand", brand, "--json"],
        io
      );
      expect(code, brand).toBe(1);
      expect(doc().error.code, brand).toBe("FULL_EXTRACTION_REQUIRED");
    }
  });

  it("needs --brand, and a prompt that isn't blank, before any request", async () => {
    const { api, io } = seams();
    const missing = await runCli(["enhance", "a pricing page", "--json"], io);
    expect(missing.code).toBe(2);
    expect(missing.doc().error.code).toBe("USAGE_MISSING_ARGUMENT");
    const blank = await runCli(
      ["enhance", "   ", "--brand", TASTELABS, "--json"],
      io
    );
    expect(blank.code).toBe(2);
    expect(blank.doc().error.code).toBe("USAGE_INVALID_PROMPT");
    expect(api.calls).toEqual([]);
  });

  it("tells the hard stop only the paid request is in flight", async () => {
    const seen: Record<string, string>[] = [];
    const { io } = seams(
      {},
      { inFlight: (params) => seen.push({ ...params }) }
    );
    await runCli(["enhance", "a page", "--brand", TASTELABS, "--json"], io);
    expect(seen).toEqual([{ paid: "yes" }, {}]);
  });

  it("says in its help that it spends credits", async () => {
    const { out } = await runCli(["enhance", "--help"]);
    expect(out).toContain("spends credits");
  });
});
