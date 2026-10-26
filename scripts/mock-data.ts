// What the local mock answers with: the recorded fixtures when they exist, else synthetic data in the
// same shapes. A job's template is everything a job of its kind goes through: its steps, the 409 it
// answers before the first checkpoint, a partial result and the final one.
import { envelope } from "../src/api/fixtures.ts";
import type { Envelope, Fixtures, Step } from "../src/api/fixtures.ts";

type Template = {
  steps: readonly Step[];
  notReady: Envelope;
  partial: Record<string, unknown>;
  final: Record<string, unknown>;
};
type Library = {
  me: unknown;
  extraction(url: string, selective: boolean): Template;
  kit: Template;
  check(pass: boolean): Template;
  failedExtraction: Template;
  failedCheck: Template;
  manifest: Record<string, unknown>;
  search(depth: string): unknown;
  similar: unknown;
  enhanced: unknown;
  notFound: Envelope;
  invalidUrl: Envelope;
  fullExtractionRequired: Envelope;
};

const PERSON = {
  user_id: "00000000-0000-4000-8000-000000000001",
  email: "person@example.com",
  role: null,
};
const DESIGN_SYSTEM = {
  profile: { brand_name: "Example", tagline: "Calm tools for careful teams." },
  colors: {
    primary: { hex: "#1f1d1a", role: "text and primary actions" },
    accent: { hex: "#ff5a1f", role: "links and highlights" },
    background: { hex: "#faf8f5", role: "page background" },
  },
  typography: {
    heading: { family: "Inter", weight: 600 },
    body: { family: "Inter", weight: 400 },
    mono: { family: "JetBrains Mono", weight: 400 },
  },
};
const QUEUED: Step = { status: "queued", current_step: "queued" };
const CRAWLING: Step = { status: "crawling", current_step: "crawl_pages" };
const WAITING: Step = {
  status: "extracting",
  current_step: "waiting_for_extractions",
};
const EXTRACTION_STEPS: readonly Step[] = [
  QUEUED,
  CRAWLING,
  { status: "extracting", current_step: "extract_design_system" },
  { status: "extracting", current_step: "write_guidelines" },
  { status: "completed", current_step: null },
];
const CHECK_STEPS: readonly Step[] = [
  WAITING,
  { status: "judging", current_step: "judging_scene" },
  { status: "completed", current_step: null },
];
const NOT_READY: Envelope = {
  status: 409,
  body: { detail: { error: "NOT_READY", message: "Result is not ready yet." } },
};
const CARD = {
  url: "https://example.com/",
  brand_name: "Example",
  identity_paragraph:
    "A calm, precise brand: warm off-white surfaces, near-black type and one orange accent.",
  match: "strong",
  tags: ["developer tools", "minimal"],
  palette: { primary: "#1f1d1a", accent: "#ff5a1f" },
  typography: { heading: "Inter", body: "Inter" },
};

function refusal(status: number, error: string, message: string): Envelope {
  return { status, body: { detail: { error, message } } };
}

function synthetic(): Library {
  const extraction: Template = {
    steps: EXTRACTION_STEPS,
    notReady: NOT_READY,
    partial: { result: { design_system: { profile: DESIGN_SYSTEM.profile } } },
    final: { result: { design_system: DESIGN_SYSTEM, artifacts: {} } },
  };
  const check = (pass: boolean): Template => ({
    steps: CHECK_STEPS,
    notReady: NOT_READY,
    partial: { score: null, recommendations: [], fixes: [] },
    final: pass
      ? {
          score: 0.86,
          recommendations: ["Keep the accent for links only."],
          fixes: [],
        }
      : {
          score: 0.31,
          recommendations: [
            "Use the reference's near-black for body text.",
            "Replace the purple gradient with the flat accent.",
          ],
          fixes: [
            {
              selector: "a.button-primary",
              property: "background-color",
              from: "#635bff",
              to: "#ff5a1f",
            },
          ],
        },
  });
  return {
    me: PERSON,
    extraction: () => extraction,
    kit: extraction,
    check,
    failedExtraction: {
      ...extraction,
      steps: [QUEUED, CRAWLING, { status: "failed" }],
    },
    failedCheck: {
      ...check(false),
      steps: [WAITING, { status: "failed" }],
    },
    manifest: {
      files: [
        {
          path: "DESIGN.md",
          url: null,
          content: "# Example\n\nCalm tools for careful teams.\n",
        },
        { path: "guidelines.json", url: null, content: "{}" },
      ],
    },
    search: (depth) => ({ search_id: "search-mock", depth, results: [CARD] }),
    similar: { results: [CARD] },
    enhanced: {
      enhanced_prompt:
        "Design a pricing page in Example's style: warm off-white surfaces, near-black Inter headings, one orange accent for the call to action.",
      brand_name: "Example",
    },
    notFound: refusal(404, "NOT_FOUND", "Submission not found"),
    invalidUrl: {
      status: 422,
      body: {
        detail: [
          {
            loc: ["body", "url"],
            msg: "Input should be a valid URL",
            type: "url_parsing",
          },
        ],
      },
    },
    fullExtractionRequired: refusal(
      422,
      "FULL_EXTRACTION_REQUIRED",
      "This operation requires a full extraction. Submit the URL without sections."
    ),
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function host(url: unknown): string | undefined {
  return typeof url === "string"
    ? URL.parse(url)?.hostname.replace(/^www\./, "")
    : undefined;
}

// The recorded manifest made hermetic: every file inline, with a small placeholder where Taste sent a
// signed asset URL, so the mock never sends taste to a real host (the recorded URLs are Taste's own
// storage, with their signatures stripped).
function hermetic(
  manifest: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!manifest || !Array.isArray(manifest.files)) return undefined;
  const files = manifest.files.map((entry: unknown) => {
    const file = record(entry) ?? {};
    return {
      path: file.path,
      url: null,
      content:
        typeof file.content === "string"
          ? file.content
          : `mock placeholder for ${String(file.path)}\n`,
    };
  });
  return { ...manifest, files };
}

// A recorded job turned into a template; undefined without a final answer to give.
function recorded(
  fixtures: Fixtures,
  recipe: string,
  fallback: Template,
  finalKey: string
): Template | undefined {
  const fixture = fixtures[recipe];
  const final = record(fixture?.data[finalKey]);
  if (!fixture || !final) return undefined;
  return {
    steps: fixture.steps.length ? fixture.steps : fallback.steps,
    notReady: envelope(fixtures, recipe, "not_ready") ?? fallback.notReady,
    partial:
      record(envelope(fixtures, recipe, "partial")?.body) ?? fallback.partial,
    final,
  };
}

function createLibrary(fixtures: Fixtures): Library {
  const base = synthetic();
  const fallback = base.extraction("", false);
  const extractions = ["extract-full", "extract-full-2"].flatMap((recipe) => {
    const template = recorded(fixtures, recipe, fallback, "result");
    const source = record(fixtures[recipe]?.data.submission)?.source_url;
    return template ? [{ host: host(source), template }] : [];
  });
  const selective = recorded(fixtures, "extract-selective", fallback, "result");
  const pass = recorded(fixtures, "check-pass", base.check(true), "verdict");
  const fail = recorded(fixtures, "check-fail", base.check(false), "verdict");
  const data = (recipe: string, key: string) => fixtures[recipe]?.data[key];
  return {
    ...base,
    me: data("me", "me") ?? base.me,
    extraction(url, isSelective) {
      if (isSelective && selective) return selective;
      const match = extractions.find((e) => e.host === host(url));
      return (match ?? extractions[0])?.template ?? fallback;
    },
    kit: recorded(fixtures, "kit", fallback, "result") ?? base.kit,
    check: (isPass) => (isPass ? pass : fail) ?? base.check(isPass),
    manifest: hermetic(record(data("manifest", "manifest"))) ?? base.manifest,
    search: (depth) =>
      data(depth === "deep" ? "search-deep" : "search-fast", "results") ??
      base.search(depth),
    similar: data("similar", "results") ?? base.similar,
    enhanced: data("enhance", "enhanced") ?? base.enhanced,
    notFound: envelope(fixtures, "error-404", "error") ?? base.notFound,
    invalidUrl: envelope(fixtures, "error-422", "error") ?? base.invalidUrl,
    fullExtractionRequired:
      envelope(fixtures, "similar-selective", "error") ??
      base.fullExtractionRequired,
  };
}

export { createLibrary };
export type { Library, Template };
