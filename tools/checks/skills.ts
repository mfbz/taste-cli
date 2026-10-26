import { parse } from "yaml";

type Frontmatter = { data: Record<string, unknown>; body: string };
// Top-level commands, each with its subcommands (empty for a command that isn't a group).
type CliSurface = {
  flags: Set<string>;
  valueFlags: Set<string>;
  commands: Map<string, Set<string>>;
};

// The portable subset of the Agent Skills standard; tool-specific keys would hide skills from other agents.
const ALLOWED_KEYS = new Set([
  "name",
  "description",
  "license",
  "compatibility",
  "metadata",
  "allowed-tools",
]);
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_NAME = 64;
const MAX_DESCRIPTION = 1024;
// An option's definition string: "--json", "-y, --yes", "--top <n>".
const OPTION_DEFINITION = /"(?:-[a-z], )?(--[a-z][a-z-]*)( <[^>]+>)?"/g;
// `program.command("history")`, then `history.command("checks")`: a group's variable is its name.
const COMMAND_DEFINITION = /\b([a-z]+)\s*\.command\("([a-z]+)"/g;
const FENCED = /```[^\n]*\n([\s\S]*?)```/g;
const FLAG_USE = /(?<![\w-])--[a-z][a-z-]*/g;
const CODE_SPAN = /`([^`]+)`/g;
// An error code or an environment variable in a code span: `NOT_FOUND`, `TASTE_API_KEY`.
const CONSTANT = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;
const BLOCK = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function parseFrontmatter(text: string): Frontmatter | null {
  const match = BLOCK.exec(text);
  if (!match) return null;
  const data: unknown = parse(match[1] ?? "");
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return null;
  }
  return { data: data as Record<string, unknown>, body: match[2] ?? "" };
}

function validateSkill(folder: string, text: string): string[] {
  const parsed = parseFrontmatter(text);
  if (!parsed) return ["missing or invalid YAML frontmatter block"];
  const problems: string[] = [];
  const { data, body } = parsed;
  const { name, description } = data;
  if (typeof name !== "string" || name.length === 0) {
    problems.push("name is required");
  } else {
    if (!NAME.test(name) || name.length > MAX_NAME) {
      problems.push(
        `name "${name}" must be lowercase letters, digits and single hyphens`
      );
    }
    if (name !== folder) {
      problems.push(`name "${name}" must match the folder "${folder}"`);
    }
  }
  if (typeof description !== "string" || description.trim().length === 0) {
    problems.push("description is required");
  } else if (description.length > MAX_DESCRIPTION) {
    problems.push(
      `description is ${description.length} characters; the limit is ${MAX_DESCRIPTION}`
    );
  }
  for (const key of Object.keys(data)) {
    if (!ALLOWED_KEYS.has(key)) {
      problems.push(`unknown frontmatter key "${key}"`);
    }
  }
  if (body.trim().length === 0) problems.push("the skill body is empty");
  return problems;
}

/** The flags and command names a CLI's source defines, for checking docs against it. */
function cliSurface(source: string): CliSurface {
  const options = [...source.matchAll(OPTION_DEFINITION)];
  const commands = new Map<string, Set<string>>();
  for (const [, parent = "", name = ""] of source.matchAll(
    COMMAND_DEFINITION
  )) {
    if (parent === "program") {
      if (!commands.has(name)) commands.set(name, new Set());
    } else {
      const children = commands.get(parent) ?? new Set<string>();
      children.add(name);
      commands.set(parent, children);
    }
  }
  return {
    flags: new Set(options.map((m) => m[1] ?? "")),
    valueFlags: new Set(options.filter((m) => m[2]).map((m) => m[1] ?? "")),
    commands,
  };
}

function unknownFlags(text: string, surface: CliSurface): string[] {
  return [...text.matchAll(FLAG_USE)]
    .map((m) => m[0])
    .filter((flag) => !surface.flags.has(flag));
}

// Command lines: every line of a fenced block, and inline code spans outside them. Prose says "the
// taste command line" without meaning a command, so it isn't checked.
function commandLines(text: string): string[] {
  const fenced = [...text.matchAll(FENCED)].flatMap(([, block = ""]) =>
    block.split("\n")
  );
  const inline = [...text.replace(FENCED, "").matchAll(CODE_SPAN)].map(
    ([, span = ""]) => span
  );
  return [...fenced, ...inline];
}

// The words after `taste` that aren't global flags or their values.
function positionals(words: readonly string[], surface: CliSurface): string[] {
  const found: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i] ?? "";
    if (surface.valueFlags.has(word)) i++;
    else if (!word.startsWith("-")) found.push(word);
  }
  return found;
}

function unknownCommands(text: string, surface: CliSurface): string[] {
  const wrong: string[] = [];
  for (const line of commandLines(text)) {
    const words = (line.split("#")[0] ?? "").trim().split(/\s+/);
    if (words[0] !== "taste") continue;
    const [first, second] = positionals(words.slice(1), surface);
    if (first === undefined) continue;
    const children = surface.commands.get(first);
    if (!children) wrong.push(`taste ${first}`);
    // `history extractions|checks` names two subcommands at once.
    else if (
      children.size > 0 &&
      !(second ?? "").split(/\\?\|/).every((name) => children.has(name))
    )
      wrong.push(`taste ${first} ${second ?? ""}`.trim());
  }
  return wrong;
}

// Inline code spans that look like an error code but aren't one taste has (or a variable it reads).
function unknownCodes(text: string, known: ReadonlySet<string>): string[] {
  return [...text.replace(FENCED, "").matchAll(CODE_SPAN)]
    .map(([, span = ""]) => span)
    .filter((span) => CONSTANT.test(span) && !known.has(span));
}

export {
  cliSurface,
  parseFrontmatter,
  unknownCodes,
  unknownCommands,
  unknownFlags,
  validateSkill,
};
export type { CliSurface, Frontmatter };
