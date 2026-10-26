import {
  Command,
  InvalidArgumentError,
  Option,
} from "@commander-js/extra-typings";

import pkg from "../package.json" with { type: "json" };
import { extract } from "./commands/extract.ts";
import { kit } from "./commands/kit.ts";
import { login } from "./commands/login.ts";
import { logout } from "./commands/logout.ts";
import { DEFAULT_TIMEOUT_S, FORMATS, wait } from "./commands/wait.ts";
import { whoami } from "./commands/whoami.ts";
import { createContext } from "./context.ts";
import type { Context } from "./context.ts";
import type { Io } from "./io.ts";
import { CliError } from "./output/errors.ts";
import type { ErrorCode } from "./output/errors.ts";
import { createOutput } from "./output/output.ts";
import type { Output } from "./output/output.ts";
import { createTheme } from "./output/theme.ts";

type Captured = { text: string };

const FOOTER =
  "\ntaste is unofficial, not affiliated with Taste Labs, built on the Taste Engine API.";
const TIMEOUT_HELP = "stop waiting after this many seconds; the job carries on";
const CREDITS_NOTE =
  "\nSpends credits from your Taste account; a failed job is refunded. Ctrl-C stops waiting, not the job: taste wait <id> picks it up for free.";
// Commander's own outcomes that aren't failures.
const CLEAN_EXITS = new Set([
  "commander.helpDisplayed",
  "commander.version",
  "commander.help",
]);
// Commander's usage errors, in our words. Only an option-shaped name is ever shown back; values never.
const USAGE_CODES: Readonly<Record<string, ErrorCode>> = {
  "commander.unknownOption": "USAGE_UNKNOWN_OPTION",
  "commander.unknownCommand": "USAGE_UNKNOWN_COMMAND",
  "commander.missingArgument": "USAGE_MISSING_ARGUMENT",
  "commander.optionMissingArgument": "USAGE_MISSING_ARGUMENT",
  "commander.missingMandatoryOptionValue": "USAGE_MISSING_ARGUMENT",
  "commander.invalidArgument": "USAGE_INVALID_VALUE",
  "commander.conflictingOption": "USAGE_CONFLICTING_OPTIONS",
};
// The whole option as typed, up to "=" or the closing quote; errors.ts decides whether it may be shown.
const OPTION_NAME = /'(-[^'=\s]*)/;
// A Taste key or a JWT, as a whole argument or a whole option value, so a file name or a query that
// merely starts with taste_ still gets through. Checked before parsing, so no command, error or usage
// message ever sees it.
// A key's body is long random text: a 16-character run without underscores, or 32 characters in all.
// Words joined by underscores (taste_engine_reviews) are neither.
const KEY_ARG =
  /(?:^|=)(?:taste_(?:[A-Za-z0-9_-]*[A-Za-z0-9-]{16}[A-Za-z0-9_-]*|[A-Za-z0-9_-]{32,})|eyJ[\w-]{8,}\.eyJ[\w-]{8,}(?:\.[\w-]*)?)$/;

// Commander turns this into commander.invalidArgument, which names the option and never the value.
function integer(min: number, max: number) {
  return (text: string): number => {
    const value = Number(text);
    if (!/^\d+$/.test(text.trim()) || value < min || value > max)
      throw new InvalidArgumentError("out of range");
    return value;
  };
}

const seconds = integer(1, 86_400);

// How a job command shows its result.
function formatOption() {
  return new Option("--format <format>", "summary or json")
    .choices(FORMATS)
    .default("summary" as const);
}

function isCommanderError(error: unknown): error is { code: string } {
  const code: unknown =
    typeof error === "object" && error !== null
      ? (error as { code?: unknown }).code
      : undefined;
  return typeof code === "string" && code.startsWith("commander.");
}

function usageError(error: { code: string; message?: unknown }): CliError {
  const code = USAGE_CODES[error.code] ?? "USAGE";
  const message = typeof error.message === "string" ? error.message : "";
  // The option's name only (never what follows "="); the catalogue shows it only if it looks like one.
  const option = OPTION_NAME.exec(message)?.[1] ?? "…";
  return new CliError(code, { option });
}

// Each command gets a fresh context; a final 401 is explained by the credential that was sent.
function withContext<A extends unknown[]>(
  io: Io,
  output: Output,
  command: (ctx: Context, ...args: A) => Promise<void>
) {
  return async (...args: A) => {
    const ctx = createContext(io, output);
    try {
      await command(ctx, ...args);
    } catch (error) {
      throw ctx.auth.explain(error);
    }
  };
}

function buildProgram(io: Io, output: Output, captured: Captured) {
  const program = new Command("taste")
    .description("A command line for the Taste Engine, Taste Labs' design API.")
    .usage("[options] [command]")
    .version(pkg.version, "-v, --version", "print the version")
    .helpOption("-h, --help", "print this help")
    .option("--json", "machine output: one JSON document on stdout")
    .option(
      "--debug",
      "on failure, add the error's class and stack frames (stderr)"
    )
    .argument("[command]")
    .addHelpText("after", FOOTER)
    .exitOverride()
    .configureOutput({
      // Under --json, help and version become the one document instead of text.
      writeOut: (text) => {
        if (output.json) captured.text += text;
        else io.stdout(text);
      },
      writeErr: (text) => {
        if (output.json) captured.text += text;
        else io.stdout(text);
      },
      // Usage errors come out through output.fail, in our words.
      outputError: () => {},
    })
    .action((command) => {
      if (command !== undefined)
        throw new CliError("USAGE_UNKNOWN_COMMAND", { command });
      // The same text as --help, footer included.
      const help = `${program.helpInformation()}${FOOTER}`;
      output.result({ help: `${help}\n` }, () => help);
    });

  program
    .command("login")
    .description("sign in with your browser, or save an API key")
    .addOption(
      new Option("--api-key", "type an API key at a hidden prompt").conflicts(
        "withApiKey"
      )
    )
    .option("--with-api-key", "read an API key from stdin")
    .addHelpText(
      "after",
      "\nA key is never taken as an argument. TASTE_API_KEY, when set, is used instead of any saved sign in."
    )
    .action(withContext(io, output, (ctx, options) => login(ctx, options)));
  program
    .command("logout")
    .description("forget the saved sign in")
    .action(withContext(io, output, (ctx) => logout(ctx)));
  program
    .command("whoami")
    .description("show which account taste is signed in to")
    .action(withContext(io, output, (ctx) => whoami(ctx)));
  program
    .command("extract")
    .description("extract a brand from a website (spends credits)")
    .argument("<url>", "the site, such as stripe.com")
    .option("--sections <names>", "only these sections, separated by commas")
    .addOption(
      new Option("--deep", "run Taste's slower, deeper analysis").conflicts(
        "sections"
      )
    )
    .option("--force", "extract again even if Taste has a recent result")
    .option("--map", "find the site's pages and extract them too")
    .option(
      "--max-urls <n>",
      "with --map, the most pages to find (1 to 200)",
      integer(1, 200)
    )
    .addOption(formatOption())
    .option("--no-wait", "print the job's id and return at once")
    .option("--timeout <seconds>", TIMEOUT_HELP, seconds, DEFAULT_TIMEOUT_S)
    .addHelpText("after", CREDITS_NOTE)
    .action(
      withContext(io, output, (ctx, url, options) => extract(ctx, url, options))
    );
  program
    .command("kit")
    .description(
      "extract a brand kit from a brand guidelines PDF (spends credits)"
    )
    .argument("<file>", "the PDF, at most 50 MB")
    .addOption(formatOption())
    .option("--no-wait", "print the job's id and return at once")
    .option("--timeout <seconds>", TIMEOUT_HELP, seconds, DEFAULT_TIMEOUT_S)
    .addHelpText("after", CREDITS_NOTE)
    .action(
      withContext(io, output, (ctx, file, options) => kit(ctx, file, options))
    );
  program
    .command("wait")
    .description("pick up a job started earlier and show its result (free)")
    .argument("<id>", "the id extract or kit printed")
    .addOption(formatOption())
    .option("--timeout <seconds>", TIMEOUT_HELP, seconds, DEFAULT_TIMEOUT_S)
    .action(
      withContext(io, output, (ctx, id, options) => wait(ctx, id, options))
    );
  for (const command of program.commands) command.addHelpText("after", FOOTER);
  return program;
}

async function run(argv: string[], io: Io): Promise<number> {
  // Read before parsing, because a usage error must already come out in the right format.
  const json = argv.includes("--json");
  const debug = argv.includes("--debug");
  const output = createOutput({
    json,
    debug,
    theme: createTheme(io.terminal?.colorLevel ?? 0),
    stdout: io.stdout,
    stderr: io.stderr,
  });
  // A key in argv is already in shell history; say so, and never parse or echo it.
  if (argv.some((arg) => KEY_ARG.test(arg)))
    return output.fail(new CliError("KEY_IN_ARGV"));
  const captured: Captured = { text: "" };
  try {
    await buildProgram(io, output, captured).parseAsync(argv, {
      from: "user",
    });
    return 0;
  } catch (error) {
    if (isCommanderError(error)) {
      if (CLEAN_EXITS.has(error.code)) {
        if (json) {
          const data =
            error.code === "commander.version"
              ? { version: pkg.version }
              : { help: captured.text };
          output.result(data, () => "");
        }
        return 0;
      }
      return output.fail(usageError(error));
    }
    return output.fail(error);
  }
}

export { run };
export type { Io };
