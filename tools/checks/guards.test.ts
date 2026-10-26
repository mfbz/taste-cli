import { describe, expect, it } from "vitest";

import {
  checkFile,
  checkMessage,
  findAttribution,
  findHomePath,
  findSecrets,
} from "./guards.ts";

// Secret-shaped samples are assembled at run time, so this file never contains one.
const sample = (...parts: string[]) => parts.join("");

describe("the secret guard", () => {
  it("finds keys and tokens, and reports only their start", () => {
    const cases = [
      sample("-----BEGIN ", "EC PRIVATE KEY-----"),
      sample("sk-", "ant-", "b2".repeat(20)),
      sample("gh", "p_", "c".repeat(36)),
      sample("github", "_pat_", "d".repeat(50)),
      sample("AK", "IA", "ABCDEFGHIJKLMNOP"),
      sample("npm", "_", "e".repeat(36)),
      sample("xo", "xb-", "1234567890-abc"),
      sample("AI", "za", "f".repeat(35)),
    ];
    for (const secret of cases) {
      const found = findSecrets(`const key = "${secret}";`);
      expect(found, secret.slice(0, 6)).toHaveLength(1);
      expect(found[0]?.match).not.toContain(secret.slice(10));
    }
  });

  it("finds a Taste API key and a signed-in session's token", () => {
    const jwtPart = (json: string) => Buffer.from(json).toString("base64url");
    for (const secret of [
      sample("tas", "te_", "Ab3_d-".repeat(5)),
      [
        jwtPart('{"alg":"HS256","typ":"JWT"}'),
        jwtPart('{"sub":"someone","aud":"authenticated"}'),
        "s1gn4tur3-".repeat(3),
      ].join("."),
    ]) {
      const found = findSecrets(`TASTE_API_KEY=${secret}`);
      expect(found, secret.slice(0, 6)).toHaveLength(1);
      expect(found[0]?.match).not.toContain(secret.slice(10));
    }
  });

  it("leaves names, placeholders and short ids alone", () => {
    expect(findSecrets("TASTE_API_KEY=")).toEqual([]);
    expect(findSecrets("taste_cli and taste_key")).toEqual([]);
    expect(findSecrets('apiKey: "taste_…" from TASTE_API_KEY')).toEqual([]);
    expect(findSecrets("a header.payload.signature placeholder")).toEqual([]);
  });
});

describe("scanning large files", () => {
  it("stays linear on a megabyte of word characters, whitespace or key-like starts", () => {
    for (const filler of ["x", "a", " ", "key ", "taste_ ", "eyJ0."]) {
      const text = filler.repeat(Math.ceil(1_000_000 / filler.length));
      const start = performance.now();
      findSecrets(text);
      findAttribution(text);
      expect(performance.now() - start, JSON.stringify(filler)).toBeLessThan(
        500
      );
    }
  });
});

describe("the authorship guard", () => {
  it("finds AI attribution trailers and lines", () => {
    for (const author of [
      "Claude <noreply@example.com>",
      "GitHub Copilot <copilot@example.com>",
      "Cursor Agent <cursoragent@example.com>",
      "Codex <codex@example.com>",
      "Gemini <gemini@example.com>",
      "some-bot[bot] <bot@example.com>",
    ]) {
      expect(
        findAttribution(sample("Co-Authored", "-By: ", author)),
        author
      ).toHaveLength(1);
    }
    expect(findAttribution(sample("noreply@", "anthropic.com"))).toHaveLength(
      1
    );
    expect(
      findAttribution(sample("Generated with ", "[Claude Code]"))
    ).toHaveLength(1);
  });

  it("lets people credit each other as co-authors", () => {
    expect(
      findAttribution(sample("Co-authored", "-by: Alice <alice@example.com>"))
    ).toEqual([]);
  });

  it("allows the rule that forbids them", () => {
    expect(
      findAttribution("no `Co-Authored-By` trailers for coding agents")
    ).toEqual([]);
  });
});

describe("the personal path guard", () => {
  it("finds the home folder of whoever runs it", () => {
    expect(
      findHomePath("--key /Users/someone/k.txt", "/Users/someone")
    ).toHaveLength(1);
    expect(findHomePath("--key ./k.txt", "/Users/someone")).toEqual([]);
  });
});

describe("one file about to be committed", () => {
  it("is refused when over 1 MB, and binary content is not scanned for text", () => {
    expect(checkFile("big.txt", Buffer.alloc(1_100_000, 120), "/h")).toEqual([
      "big.txt: over 1 MB",
    ]);
    const binary = Buffer.concat([
      Buffer.from([0]),
      Buffer.from(sample("gh", "p_", "c".repeat(36))),
    ]);
    expect(checkFile("logo.png", binary, "/h")).toEqual([]);
  });
});

describe("commit messages", () => {
  it("are checked for attribution and secrets", () => {
    expect(
      checkMessage(
        "feat: extract\n\n" + sample("Co-Authored", "-By: Claude <x@y.z>")
      )
    ).toHaveLength(1);
    expect(checkMessage("fix: wait redraw")).toEqual([]);
  });
});
