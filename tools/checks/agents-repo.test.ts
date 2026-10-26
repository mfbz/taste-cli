import { existsSync, readdirSync, readlinkSync } from "node:fs";

import { describe, expect, it } from "vitest";

import pkg from "../../package.json" with { type: "json" };
import { CATALOGUE } from "../../src/output/errors.ts";
import { readRepoFile, repoPath } from "./repo.ts";
import {
  cliSurface,
  unknownCodes,
  unknownCommands,
  unknownFlags,
  validateSkill,
} from "./skills.ts";

const MAX_AGENTS_LINES = 150;
const scripts = Object.keys(pkg.scripts);
const skillFolders = existsSync(repoPath(".agents", "skills"))
  ? readdirSync(repoPath(".agents", "skills"))
  : [];

describe("agent instructions", () => {
  it(`keeps AGENTS.md at ${MAX_AGENTS_LINES} lines or fewer (every agent loads it every session)`, () => {
    expect(readRepoFile("AGENTS.md").split("\n").length).toBeLessThanOrEqual(
      MAX_AGENTS_LINES
    );
  });

  it("CLAUDE.md imports AGENTS.md on its first line", () => {
    expect(readRepoFile("CLAUDE.md").split("\n")[0]).toBe("@AGENTS.md");
  });

  it.each(["AGENTS.md", "CONTRIBUTING.md", "README.md"])(
    "%s names only npm scripts that exist",
    (file) => {
      const named = [...readRepoFile(file).matchAll(/npm run ([a-z:-]+)/g)]
        .map((match) => match[1] ?? "")
        .filter((name) => !scripts.includes(name));
      expect(named).toEqual([]);
    }
  );
});

describe("skills", () => {
  it("has the skills AGENTS.md points at", () => {
    expect(skillFolders).toEqual(
      expect.arrayContaining(["taste-cli-conventions", "taste-cli-workflow"])
    );
  });

  it.each(skillFolders)(
    ".agents/skills/%s is a valid Agent Skill",
    (folder) => {
      expect(
        validateSkill(
          folder,
          readRepoFile(".agents", "skills", folder, "SKILL.md")
        )
      ).toEqual([]);
    }
  );

  it(".claude/skills points at .agents/skills (on Windows: git config core.symlinks true, then clone again)", () => {
    expect(readlinkSync(repoPath(".claude", "skills"))).toBe(
      "../.agents/skills"
    );
  });
});

// The README is what people copy from: every flag and command it names has to exist.
describe("the README", () => {
  it("names only flags and commands taste has, exactly", () => {
    const surface = cliSurface(readRepoFile("src", "cli.ts"));
    const readme = readRepoFile("README.md");
    expect(unknownFlags(readme, surface)).toEqual([]);
    expect(unknownCommands(readme, surface)).toEqual([]);
  });
});

// The skill people install for their own agents: an agent runs what it names, and branches on its codes.
describe("the taste skill", () => {
  const skill = readRepoFile("skills", "taste", "SKILL.md");
  // The error codes, and the variables the skill sends a person to.
  const known = new Set([
    ...Object.keys(CATALOGUE),
    "TASTE_API_KEY",
    "TASTE_API_URL",
  ]);

  it("is a valid Agent Skill", () => {
    expect(validateSkill("taste", skill)).toEqual([]);
  });

  it("names only flags, commands and error codes taste has", () => {
    const surface = cliSurface(readRepoFile("src", "cli.ts"));
    expect(unknownFlags(skill, surface)).toEqual([]);
    expect(unknownCommands(skill, surface)).toEqual([]);
    expect(unknownCodes(skill, known)).toEqual([]);
  });
});
