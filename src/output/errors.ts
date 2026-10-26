// Every message taste-cli shows comes from this catalogue. Nothing else is ever printed as an error:
// not a library's message, not the Taste Engine's text, not what was typed. Agents branch on `code`;
// `message` and `hint` are ours, so they are safe to show to a person and to put in an agent's context.

type ExitCode = 1 | 2 | 130;
type Entry = {
  exit: ExitCode;
  retryable: boolean;
  message: string;
  hint: string;
};
type Params = Readonly<Record<string, string>>;
type ErrorReport = {
  code: string;
  message: string;
  hint: string;
  retryable: boolean;
};
type DebugInfo = { className: string; frames: string[] };
type FullReport = ErrorReport & { exitCode: ExitCode; debug?: DebugInfo };

const entry = (
  exit: ExitCode,
  message: string,
  hint: string,
  retryable = false
): Entry => ({ exit, retryable, message, hint });

const CATALOGUE = {
  USAGE: entry(2, "That command isn't valid.", "See taste --help."),
  USAGE_UNKNOWN_COMMAND: entry(
    2,
    "There is no command {command}.",
    "See taste --help for the commands."
  ),
  USAGE_UNKNOWN_OPTION: entry(
    2,
    "There is no option {option} here.",
    "See taste --help, or --help after the command."
  ),
  USAGE_MISSING_ARGUMENT: entry(
    2,
    "Something this command needs is missing.",
    "See --help after the command."
  ),
  USAGE_INVALID_VALUE: entry(
    2,
    "The value for {option} isn't valid.",
    "See --help after the command."
  ),
  INTERRUPTED: entry(
    130,
    "Interrupted.",
    "Run the command again when you are ready."
  ),
  INTERNAL: entry(
    1,
    "Something went wrong inside taste-cli.",
    "Run again with --debug and report it with that output at github.com/mfbz/taste-cli/issues."
  ),
} satisfies Record<string, Entry>;

type ErrorCode = keyof typeof CATALOGUE;

// What a filled-in parameter may look like: a name, a path, a word. Anything else becomes "…", so a
// typed value or a token can never ride into a message.
const SAFE_PARAM = /^[A-Za-z0-9 _.,:/~@+=-]{1,80}$/;

class CliError extends Error {
  readonly code: ErrorCode;
  readonly params: Params;

  constructor(
    code: ErrorCode,
    params: Params = {},
    options?: { cause?: unknown }
  ) {
    // The message is ours and contains no parameters, so it is safe wherever it ends up.
    super(CATALOGUE[code].message, options);
    this.name = "CliError";
    this.code = code;
    this.params = params;
  }
}

function fill(template: string, params: Params): string {
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = params[name] ?? "";
    return SAFE_PARAM.test(value) ? value : "…";
  });
}

function report(code: ErrorCode, params: Params = {}): FullReport {
  const { exit, retryable, message, hint } = CATALOGUE[code];
  return {
    code,
    message: fill(message, params),
    hint: fill(hint, params),
    retryable,
    exitCode: exit,
  };
}

// Class name and stack frames only: frames hold file names and line numbers, never values.
function debugInfo(error: unknown): DebugInfo {
  const className =
    error instanceof Error ? error.constructor.name : typeof error;
  const frames =
    error instanceof Error && error.stack
      ? error.stack
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.startsWith("at "))
          .slice(0, 12)
      : [];
  return { className, frames };
}

function toErrorReport(error: unknown): FullReport {
  if (error instanceof CliError) return report(error.code, error.params);
  return { ...report("INTERNAL"), debug: debugInfo(error) };
}

export { CATALOGUE, CliError, toErrorReport };
export type { DebugInfo, ErrorCode, ErrorReport, ExitCode };
