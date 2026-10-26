import { describe, expect, it } from "vitest";

import {
  cliSurface,
  parseFrontmatter,
  validateSkill,
  unknownCommands,
  unknownFlags,
} from "./skills.ts";

function skill(frontmatter: string, body = "Do the thing.\n"): string {
  return `---\n${frontmatter}\n---\n\n${body}`;
}

describe("validateSkill", () => {
  it("accepts a minimal skill, a quoted or folded description included", () => {
    for (const description of [
      '"Use when: things happen"',
      ">-\n  First line\n  second line",
    ])
      expect(
        validateSkill("demo", skill(`name: demo\ndescription: ${description}`))
      ).toEqual([]);
    expect(
      parseFrontmatter(skill("name: demo\ndescription: >-\n  a\n  b"))?.data
        .description
    ).toBe("a b");
  });

  it("names every rule a skill breaks", () => {
    expect(
      validateSkill(
        "demo",
        skill(
          `name: Other_1\ndescription: ${"x".repeat(1025)}\nuser-invocable: true`,
          ""
        )
      )
    ).toEqual(
      expect.arrayContaining([
        'name "Other_1" must match the folder "demo"',
        "description is 1025 characters; the limit is 1024",
        'unknown frontmatter key "user-invocable"',
        "the skill body is empty",
      ])
    );
  });
});

describe("checking a skill against the CLI", () => {
  const source = `
    program.option("--json", "x").option("-y, --yes", "x").option("--top <n>", "x")
      .option(
        "--no-wait", "x")
    program.command("extract").option("--out <dir>", "x");
    const history = program.command("history");
    history.command("checks");
  `;

  it("flags a misspelled flag, command or subcommand, in code spans and fenced blocks", () => {
    const surface = cliSurface(source);
    expect([...surface.commands.keys()].sort()).toEqual(["extract", "history"]);
    expect(
      unknownFlags("use --no, --json and --no-wait, never --yess", surface)
    ).toEqual(["--no", "--yess"]);
    const text = [
      "Run `taste history checks` and `taste extarct`; the taste command line is fine.",
      "```sh",
      "taste --json history checks",
      "taste --top 3 history check",
      "```",
    ].join("\n");
    expect(unknownCommands(text, surface).sort()).toEqual([
      "taste extarct",
      "taste history check",
    ]);
  });
});
