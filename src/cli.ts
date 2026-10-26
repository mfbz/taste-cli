import { Command } from "@commander-js/extra-typings";

import pkg from "../package.json" with { type: "json" };
import { CliError } from "./output/errors.ts";
import type { ErrorCode } from "./output/errors.ts";
import { createOutput } from "./output/output.ts";
import type { Output, Writer } from "./output/output.ts";

// Everything taste touches outside itself comes through here, so tests run it without a process.
type Io = {
  stdout: Writer;
  stderr: Writer;
};
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
};
const OPTION_NAME = /'(--?[a-z][a-z0-9-]{0,30})/;

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
  // The option's name only (never what follows "="), and only if it looks like an option name.
  const option = OPTION_NAME.exec(message)?.[1] ?? "…";
  return new CliError(code, { option });
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
  return program;
}

async function run(argv: string[], io: Io): Promise<number> {
  // Read before parsing, because a usage error must already come out in the right format.
  const json = argv.includes("--json");
  const debug = argv.includes("--debug");
  const output = createOutput({
    json,
    debug,
    stdout: io.stdout,
    stderr: io.stderr,
  });
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
