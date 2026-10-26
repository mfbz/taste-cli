import { Command, Option } from "@commander-js/extra-typings";

import pkg from "../package.json" with { type: "json" };
import { login } from "./commands/login.ts";
import { logout } from "./commands/logout.ts";
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
// A Taste key or a JWT, as a whole argument or an option's value. Checked before parsing, so no
// command, error or usage message ever sees it.
const KEY_ARG =
  /(?:^|=)(?:taste_[A-Za-z0-9_-]{12,}|eyJ[\w-]{8,}\.eyJ[\w-]{8,})/;

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
