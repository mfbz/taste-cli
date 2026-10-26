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

describe("parseFrontmatter", () => {
  it("parses a description that contains a colon when quoted", () => {
    const parsed = parseFrontmatter(
      skill('name: demo\ndescription: "Use when: things happen"')
    );
    expect(parsed?.data.description).toBe("Use when: things happen");
  });

  it("parses a folded multi-line description", () => {
    const parsed = parseFrontmatter(
      skill("name: demo\ndescription: >-\n  First line\n  second line")
    );
    expect(parsed?.data.description).toBe("First line second line");
  });

  it("returns null without a frontmatter block", () => {
    expect(parseFrontmatter("# just markdown")).toBeNull();
  });
});

describe("validateSkill", () => {
  it("accepts a minimal valid skill", () => {
    expect(
      validateSkill("demo", skill("name: demo\ndescription: Use when testing."))
    ).toEqual([]);
  });

  it("requires the name to match the folder", () => {
    expect(
      validateSkill(
        "demo",
        skill("name: other\ndescription: Use when testing.")
      )
    ).toContain('name "other" must match the folder "demo"');
  });

  it("rejects names that are not lowercase-hyphenated", () => {
    expect(
      validateSkill("Demo_1", skill("name: Demo_1\ndescription: x"))
    ).toContain(
      'name "Demo_1" must be lowercase letters, digits and single hyphens'
    );
  });

  it("requires a description", () => {
    expect(validateSkill("demo", skill("name: demo"))).toContain(
      "description is required"
    );
  });

  it("rejects a description over 1024 characters", () => {
    expect(
      validateSkill(
        "demo",
        skill(`name: demo\ndescription: ${"x".repeat(1025)}`)
      )
    ).toContain("description is 1025 characters; the limit is 1024");
  });

  it("rejects keys outside the Agent Skills standard", () => {
    expect(
      validateSkill(
        "demo",
        skill("name: demo\ndescription: x\nuser-invocable: true")
      )
    ).toContain('unknown frontmatter key "user-invocable"');
  });

  it("requires a body", () => {
    expect(
      validateSkill("demo", skill("name: demo\ndescription: x", ""))
    ).toContain("the skill body is empty");
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

  it("reads the CLI's flags and commands from its source", () => {
    const surface = cliSurface(source);
    expect([...surface.flags].sort()).toEqual([
      "--json",
      "--no-wait",
      "--out",
      "--top",
      "--yes",
    ]);
    expect([...surface.commands.keys()].sort()).toEqual(["extract", "history"]);
    expect([...(surface.commands.get("history") ?? [])]).toEqual(["checks"]);
  });

  it("flags a truncated or misspelled flag, not only a missing one", () => {
    const surface = cliSurface(source);
    expect(
      unknownFlags("use --no, --json and --no-wait, never --yess", surface)
    ).toEqual(["--no", "--yess"]);
  });

  it("flags a command or subcommand that doesn't exist, in code spans only", () => {
    const surface = cliSurface(source);
    expect(
      unknownCommands(
        "Run `taste extract stripe.com`, `taste history checks`, `taste history chekcs` and `taste extarct`; the taste command line is fine.",
        surface
      )
    ).toEqual(["taste history chekcs", "taste extarct"]);
  });

  it("checks fenced blocks too, after global flags, and each subcommand under its own group", () => {
    const surface = cliSurface(source);
    const text = [
      "```sh",
      "taste extract stripe.com   # fine",
      "taste --json history checks",
      "taste --top 3 history check",
      "taste extract checks",
      "taste checks",
      "```",
    ].join("\n");
    expect(unknownCommands(text, surface)).toEqual([
      "taste history check",
      "taste checks",
    ]);
  });
});
