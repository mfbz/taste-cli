import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { checkFile, findSecrets } from "../tools/checks/guards.ts";
import { scrubFiles, scrubFixture } from "./scrub-fixtures.ts";

// Every secret is built at run time from parts, so the guards never see one in this file.
const KEY = ["taste", "live", "A1b2C3d4E5f6G7h8I9j0"].join("_");
const JWT = [
  "eyJ" + "hbGciOiJSUzI1NiJ9",
  "eyJ" + "zdWIiOiIxMjM0NTY3ODkwIn0",
  "c2lnbmF0dXJlLXBhcnQtaGVyZQ",
].join(".");
const USER_ID = "7d3f2a10-5b6c-4e8f-9a0b-1c2d3e4f5a6b";
const EMAIL = ["maintainer", "real-domain.io"].join("@");

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "taste-scrub-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function raw(data: Record<string, unknown>) {
  return {
    recipe: "sample",
    paid: true,
    calls: [`GET /design/submissions?q=${EMAIL} 200`],
    steps: [
      { status: "queued", current_step: null },
      { status: "crawling", current_step: "crawl" },
      { status: "extracting", current_step: "extract" },
      { status: "extracting", current_step: "assets" },
      { status: "extracting", current_step: "layout" },
      { status: "completed", current_step: null },
    ],
    data,
  };
}

const SAMPLE = raw({
  me: { user_id: USER_ID, email: EMAIL, role: null },
  job: { user_id: USER_ID, api_key_id: "key_7f9a8b", api_key_name: "laptop" },
  echoed: { header: `Bearer ${JWT}`, note: `key ${KEY} was used` },
  contact: `Write to ${EMAIL} or press@stripe.com`,
  logo: "https://cdn.example.com/logo@2x.png",
  design_system: {
    layout: Array.from({ length: 40 }, (_, i) => ({ i })),
    brand_assets: Array.from({ length: 12 }, (_, i) => `asset-${i}`),
    colors: { primary: "#635bff" },
  },
});

describe("scrubFixture", () => {
  it("replaces emails, user ids and the key id, and removes keys and tokens", () => {
    const text = JSON.stringify(scrubFixture(SAMPLE));
    expect(text).not.toContain(EMAIL);
    expect(text).not.toContain(USER_ID);
    expect(text).not.toContain("key_7f9a8b");
    expect(text).not.toContain("laptop");
    expect(text).not.toContain("press@stripe.com");
    expect(findSecrets(text)).toEqual([]);
    expect(text).toContain("person@example.com");
    expect(text).toContain("00000000-0000-4000-8000-000000000001");
    expect(text).toContain('"api_key_id":"key_example"');
    expect(text).toContain("[removed]");
  });

  it("leaves a file name with an @ alone", () => {
    const out = scrubFixture(SAMPLE) as { data: { logo: string } };
    expect(out.data.logo).toBe("https://cdn.example.com/logo@2x.png");
  });

  it("trims layout and asset lists to five items, but never the steps", () => {
    const out = scrubFixture(SAMPLE) as {
      steps: unknown[];
      data: { design_system: { layout: unknown[]; brand_assets: unknown[] } };
    };
    expect(out.data.design_system.layout).toHaveLength(5);
    expect(out.data.design_system.brand_assets).toHaveLength(5);
    expect(out.steps).toHaveLength(6);
  });

  it("gives the same output for the same input", () => {
    expect(JSON.stringify(scrubFixture(SAMPLE))).toBe(
      JSON.stringify(scrubFixture(structuredClone(SAMPLE)))
    );
  });

  it("caps long strings", () => {
    const out = scrubFixture(raw({ html: "x".repeat(50_000) }), {
      array: 50,
      string: 100,
    }) as { data: { html: string } };
    expect(out.data.html.length).toBeLessThanOrEqual(101);
  });
});

describe("scrubFixture, past the obvious fields", () => {
  it("replaces a user id, key name and batch values wherever else they appear, calls included", () => {
    const doc = raw({
      me: { user_id: USER_ID },
      job: {
        api_key_name: "maintainer-laptop",
        batch_id: "b-91f2",
        batch_label: "launch week",
        credit_ref_id: "cr-77aa",
      },
      artifact: `https://cdn.example.com/u/${USER_ID}/shot.png`,
      note: "made with maintainer-laptop",
    });
    doc.calls.push(`GET /design/submissions?user=${USER_ID} 200`);
    const text = JSON.stringify(scrubFixture(doc));
    for (const value of [
      USER_ID,
      "maintainer-laptop",
      "b-91f2",
      "launch week",
      "cr-77aa",
    ])
      expect(text).not.toContain(value);
    expect(text).toContain("/u/00000000-0000-4000-8000-000000000001/shot.png");
  });

  it("strips the query and fragment from URLs off the Taste API, so signatures go", () => {
    const signed =
      "https://bucket.s3.amazonaws.com/a/b.png?X-Amz-Signature=abc123&X-Amz-Credential=me#top";
    const google =
      "https://storage.googleapis.com/x/y.css?X-Goog-Signature=9f&token=t1";
    const out = scrubFixture(
      raw({
        url: signed,
        text: `see ${google} now`,
        api: "https://api.tastelabs.com/design/submissions?limit=5",
      })
    ) as { data: Record<string, string> };
    expect(out.data.url).toBe("https://bucket.s3.amazonaws.com/a/b.png");
    expect(out.data.text).toBe(
      "see https://storage.googleapis.com/x/y.css now"
    );
    expect(out.data.api).toBe(
      "https://api.tastelabs.com/design/submissions?limit=5"
    );
  });

  it("scrubs a percent-encoded email", () => {
    const encoded = EMAIL.replace("@", "%40");
    const text = JSON.stringify(
      scrubFixture(
        raw({ link: `https://example.com/?to=${encoded}` }),
        undefined
      )
    );
    expect(text).not.toContain(encoded);
    expect(text).not.toContain("maintainer");
  });
});

describe("scrubFiles", () => {
  function setup(files: Record<string, unknown>) {
    const from = join(dir, "tmp-fixtures");
    const to = join(dir, "fixtures");
    mkdirSync(from);
    for (const [name, doc] of Object.entries(files))
      writeFileSync(join(from, `${name}.json`), JSON.stringify(doc));
    return { from, to };
  }

  it("writes clean, formatted fixtures under 200 KB that pass every guard", async () => {
    const big = raw({
      html: "<div>".repeat(100_000),
      rows: Array.from({ length: 2000 }, (_, i) => ({
        i,
        text: "y".repeat(300),
      })),
    });
    const { from, to } = setup({ sample: SAMPLE, big });
    const written = await scrubFiles({ from, to, home: homedir() });
    expect(written.map((w) => w.name)).toEqual(["big", "sample"]);
    expect(readdirSync(to).sort()).toEqual(["big.json", "sample.json"]);
    for (const file of readdirSync(to)) {
      const bytes = readFileSync(join(to, file));
      expect(bytes.length).toBeLessThan(200 * 1024);
      expect(checkFile(file, bytes, homedir())).toEqual([]);
      expect(bytes.toString("utf8").endsWith("}\n")).toBe(true);
    }
  });

  it("refuses to write anything when a scrubbed file still trips a guard", async () => {
    const npm = ["npm", "A".repeat(36)].join("_");
    const { from, to } = setup({ sample: SAMPLE, leaky: raw({ token: npm }) });
    await expect(scrubFiles({ from, to, home: homedir() })).rejects.toThrow(
      /leaky\.json: npm token/
    );
    expect(() => readdirSync(to)).toThrow();
  });

  it("refuses a file that is not a recorded fixture", async () => {
    const { from, to } = setup({ odd: { hello: "world" } });
    await expect(scrubFiles({ from, to, home: homedir() })).rejects.toThrow(
      /odd\.json/
    );
  });

  it("keeps only the history entries a recorded recipe created, and recounts the totals", async () => {
    const extraction = {
      ...raw({ accepted: { submission_id: "sub-mine" } }),
      recipe: "extract-full",
    };
    const search = {
      ...raw({ results: { search_id: "s-mine" } }),
      recipe: "search-fast",
    };
    const entry = (id: string, url: string) => ({
      submission_id: id,
      status: "completed",
      source_url: url,
      is_public: false,
    });
    const history = {
      ...raw({
        submissions: {
          submissions: [
            entry("sub-mine", "https://www.tastelabs.com/"),
            entry("sub-private", "https://secret-client.example/roadmap"),
          ],
          total: 312,
          limit: 20,
          offset: 0,
          totals: { completed: 300, failed: 12, in_progress: 0 },
        },
        searches: {
          submissions: [
            {
              id: "s-mine",
              kind: "search",
              query: "dark brutalist developer tools",
              status: "completed",
            },
            {
              id: "s-private",
              kind: "search",
              query: "competitor teardown",
              status: "completed",
            },
          ],
          total: 40,
          total_by_status: { completed: 40 },
        },
        adherence: {
          jobs: [
            {
              job_id: "j-private",
              reference_url: "https://a.example/",
              candidate_url: "https://b.example/",
            },
          ],
          total: 9,
        },
      }),
      recipe: "history",
    };
    const { from, to } = setup({
      "extract-full": extraction,
      "search-fast": search,
      history,
    });
    await scrubFiles({ from, to, home: homedir(), names: ["history"] });
    const text = readFileSync(join(to, "history.json"), "utf8");
    for (const gone of [
      "sub-private",
      "secret-client",
      "s-private",
      "competitor",
      "j-private",
      "a.example",
      "312",
    ])
      expect(text).not.toContain(gone);
    const out = JSON.parse(text) as {
      data: Record<string, Record<string, unknown>>;
    };
    expect(out.data.submissions).toMatchObject({
      total: 1,
      totals: { completed: 1, failed: 0, in_progress: 0 },
    });
    expect(out.data.searches).toMatchObject({
      total: 1,
      total_by_status: { completed: 1 },
    });
    expect(out.data.adherence).toMatchObject({ jobs: [], total: 0 });
  });

  it("scrubs only the recipes it is given", async () => {
    const { from, to } = setup({ sample: SAMPLE, other: SAMPLE });
    await scrubFiles({ from, to, home: homedir(), names: ["other"] });
    expect(readdirSync(to)).toEqual(["other.json"]);
  });
});
