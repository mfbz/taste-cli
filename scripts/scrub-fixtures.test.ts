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

  it("scrubs only the recipes it is given", async () => {
    const { from, to } = setup({ sample: SAMPLE, other: SAMPLE });
    await scrubFiles({ from, to, home: homedir(), names: ["other"] });
    expect(readdirSync(to)).toEqual(["other.json"]);
  });
});
