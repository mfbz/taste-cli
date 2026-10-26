// Every message taste-cli shows comes from this catalogue. Nothing else is ever printed as an error:
// not a library's message, not what was typed, not the Taste Engine's error text. The one exception is
// a failed job's own reason ({reason}), which is shortened and has key-shaped tokens redacted. Agents
// branch on `code`; `message` and `hint` are ours, so they are safe to show to a person and to put in
// an agent's context.

type ExitCode = 1 | 2 | 130;
type Entry = {
  exit: ExitCode;
  retryable: boolean;
  message: string;
  hint: string;
};
type Params = Readonly<Record<string, string | number>>;
type ErrorReport = {
  code: string;
  message: string;
  hint: string;
  retryable: boolean;
  // Structured data for agents, only where a code carries some: the id of a job to wait for.
  details?: { id: string };
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
  KEY_IN_ARGV: entry(
    2,
    "That looks like a Taste key or token on the command line. taste never takes one that way.",
    "It may be in your shell history: remove it there and rotate the key. To sign in, run taste login."
  ),
  INVALID_URL: entry(
    2,
    "That isn't a web address taste can use.",
    "Give an http or https address, such as stripe.com or https://stripe.com."
  ),
  PRIVATE_URL: entry(
    2,
    "That address points at this computer or a private network.",
    "Taste can only read public websites. Use a public address."
  ),
  NOT_SIGNED_IN: entry(
    1,
    "You are not signed in.",
    "Run taste login to sign in with your browser."
  ),
  SESSION_EXPIRED: entry(
    1,
    "Your session has ended.",
    "Run taste login to sign in again."
  ),
  INVALID_API_KEY: entry(
    1,
    "Taste did not accept that API key.",
    "Check the key, or run taste login to sign in with your browser."
  ),
  LOGIN_TIMEOUT: entry(
    1,
    "The sign in was not finished in time.",
    "Run taste login again and finish it in the browser."
  ),
  LOGIN_DENIED: entry(
    1,
    "The sign in was cancelled in the browser.",
    "Run taste login again when you are ready."
  ),
  LOGIN_PORTS_BUSY: entry(
    1,
    "No local port was free to finish the sign in.",
    "Close what is using ports on this computer and run taste login again."
  ),
  LOGIN_NOT_INTERACTIVE: entry(
    1,
    "Signing in with a browser needs a terminal.",
    "Run taste login in a terminal, or give a key with --api-key or --with-api-key."
  ),
  INSUFFICIENT_CREDITS: entry(
    1,
    "Not enough credits: you have {balance} and this needs {required}.",
    "Add credits to your Taste account, then run the command again."
  ),
  FORBIDDEN: entry(
    1,
    "Your account can't do that.",
    "Check that you are signed in to the right account with taste whoami."
  ),
  NOT_FOUND: entry(
    1,
    "Taste has nothing with that id.",
    "Check the id. taste history lists yours."
  ),
  FULL_EXTRACTION_REQUIRED: entry(
    1,
    "This needs a full extraction of the brand first.",
    "Run taste extract on the brand, then try again."
  ),
  FILE_TOO_LARGE: entry(
    1,
    "That file is too large. The limit is 50 MB.",
    "Use a smaller file."
  ),
  INVALID_FILE: entry(
    1,
    "That file can't be used.",
    "Use a PDF that is not empty."
  ),
  JOB_FAILED: entry(
    1,
    "The job failed: {reason}",
    "Check the address or file and try again. Failed jobs are refunded. Fix the input and run it again."
  ),
  ADHERENCE_FAILED: entry(
    1,
    "Taste could not compare those two.",
    "Check that both can be read, then try again."
  ),
  BELOW_THRESHOLD: entry(
    1,
    "The score is below the minimum you asked for.",
    "Look at the findings, or lower --min."
  ),
  SEARCH_BUSY: entry(
    1,
    "Taste search is busy right now.",
    "Try again in a minute.",
    true
  ),
  SELECTIVE_MAP_UNSUPPORTED: entry(
    2,
    "That combination of options isn't supported.",
    "Drop --sections or --map and run it again."
  ),
  REQUEST_REJECTED: entry(
    1,
    "The Taste Engine rejected the request ({status}).",
    "Check the inputs, or run again with --debug."
  ),
  RATE_LIMITED: entry(
    1,
    "Too many requests. Wait a moment and try again.",
    "Run the command again in a minute.",
    true
  ),
  UPSTREAM: entry(
    1,
    "The Taste Engine had a problem on its side.",
    "Try again in a minute.",
    true
  ),
  NETWORK: entry(
    1,
    "Couldn't reach the Taste Engine.",
    "Check your connection and try again.",
    true
  ),
  WAIT_TIMEOUT: entry(
    1,
    "Still working after the time you allowed.",
    "The job keeps running. Run taste wait {id} to pick it up.",
    true
  ),
  BUNDLE_PATH_UNSAFE: entry(
    1,
    "The download names a file outside the output folder.",
    "Nothing was written. Try again, and report it if it keeps happening."
  ),
  // An asset from a manifest: its host is a CDN, not the Taste Engine, so API codes would mislead.
  DOWNLOAD_FAILED: entry(
    1,
    "Couldn't download {file} ({status}).",
    "Run the command again. Each run gets fresh download links.",
    true
  ),
  OUTPUT_EXISTS: entry(
    1,
    "That output folder already has files in it.",
    "Choose another folder with --out, or empty this one."
  ),
  // Ctrl-C while a paid job runs: the job carries on server side, so say how to pick it up.
  INTERRUPTED: entry(
    130,
    "Interrupted.",
    "If a job was running it carries on. Run taste wait {id} to pick it up.",
    true
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
// A command or option name is echoed from what was typed, so it is held to the shape of a real one:
// at most four short lowercase words. Anything longer, or starting like a known key, is never shown.
const NAME_PARAMS = new Set(["command", "option"]);
const NAME = /^(?:--?)?[a-z][a-z0-9]{0,15}(?:-[a-z0-9]{1,16}){0,3}$/;
const KEY_PREFIX = /^(?:--?)?(?:sk-|gh[pousr]-|npm-|xox|akia|asia|aiza)/;
// A job's own error is free text: shortened, with key-shaped tokens redacted one by one so the rest
// stays readable. The output layer strips control characters before a person sees it.
const TEXT_PARAMS = new Set(["reason"]);
const TEXT_LIMIT = 120;
const KEY_TOKEN =
  /\btaste_\S+|\bsk-[A-Za-z0-9_-]{8,}|\beyJ[\w-]+\.[\w-]+(?:\.[\w-]+)?/g;
// A job id: a UUID or a short simple id, never something shaped like a key.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIMPLE_ID = /^[A-Za-z0-9_-]{1,40}$/;
// Key- and token-shaped text anywhere in any other parameter: Taste keys, provider keys, JWTs, long runs.
const KEY_SHAPED = /taste_|sk-|eyJ|[A-Za-z0-9_-]{24,}/;

function isJobId(value: string): boolean {
  return (
    UUID.test(value) ||
    (SIMPLE_ID.test(value) &&
      !KEY_PREFIX.test(value) &&
      !/^(?:taste_|eyJ)/.test(value))
  );
}

const DETAIL_CODES = new Set<ErrorCode>([
  "INTERRUPTED",
  "WAIT_TIMEOUT",
  "JOB_FAILED",
]);

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
    const value = String(params[name] ?? "");
    if (name === "id") return isJobId(value) ? value : "…";
    if (TEXT_PARAMS.has(name)) {
      const text = value.trim().slice(0, TEXT_LIMIT).replace(KEY_TOKEN, "…");
      return text === "" ? "…" : text;
    }
    if (KEY_SHAPED.test(value)) return "…";
    const safe = NAME_PARAMS.has(name)
      ? NAME.test(value) && !KEY_PREFIX.test(value)
      : SAFE_PARAM.test(value);
    return safe ? value : "…";
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
    ...(DETAIL_CODES.has(code) && isJobId(String(params.id ?? ""))
      ? { details: { id: String(params.id) } }
      : {}),
  };
}

// The Taste API client's error, by shape so this module needn't import the client. Only the status and
// the API's own code and figures are read; its message is never shown.
type UpstreamError = Error & {
  status: number;
  code?: string;
  balance?: number;
  required?: number;
};

function isUpstreamError(value: unknown): value is UpstreamError {
  return (
    value instanceof Error &&
    !(value instanceof CliError) &&
    Number.isInteger((value as { status?: unknown }).status)
  );
}

function upstreamReport({ status, code, balance, required }: UpstreamError) {
  if (status === 402)
    return report("INSUFFICIENT_CREDITS", {
      balance: balance ?? "unknown",
      required: required ?? "unknown",
    });
  if (status === 422 && code === "FULL_EXTRACTION_REQUIRED")
    return report("FULL_EXTRACTION_REQUIRED");
  if (status === 422 && (code === "INVALID_FILE_TYPE" || code === "EMPTY_FILE"))
    return report("INVALID_FILE");
  if (status === 422 && code === "SELECTIVE_MAP_UNSUPPORTED")
    return report("SELECTIVE_MAP_UNSUPPORTED");
  // 503 is documented only on search; elsewhere it is read the same way.
  const byStatus: Readonly<Record<number, ErrorCode>> = {
    401: "INVALID_API_KEY",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    413: "FILE_TOO_LARGE",
    424: "ADHERENCE_FAILED",
    409: "UPSTREAM",
    429: "RATE_LIMITED",
    503: "SEARCH_BUSY",
  };
  const mapped = byStatus[status];
  if (mapped) return report(mapped);
  if (status >= 500) return report("UPSTREAM");
  if (status >= 400) return report("REQUEST_REJECTED", { status });
  return report("INTERNAL");
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
  const full = isUpstreamError(error)
    ? upstreamReport(error)
    : report("INTERNAL");
  return { ...full, debug: debugInfo(error) };
}

export { CATALOGUE, CliError, isUpstreamError, toErrorReport };
export type { DebugInfo, ErrorCode, ErrorReport, ExitCode };
