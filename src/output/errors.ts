// Every message taste-cli shows comes from this catalogue. Nothing else is ever printed as an error:
// not a library's message, not what was typed, not the Taste Engine's error text. The exceptions are
// a failed job's own reason ({reason}), shortened with key-shaped tokens redacted, and a brand's
// address ({url}) or word ({word}), cleaned so the hint stays a command to copy. Agents branch on
// `code`; `message` and `hint` are ours, so they are safe to show to a person and to put in an
// agent's context.
import { PAGE_TYPE } from "../api/schemas.ts";

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
  // Structured data for agents, only where a code carries some: the id of a job to wait for, or for
  // BELOW_THRESHOLD the check's whole verdict.
  details?: Readonly<Record<string, unknown>>;
};
type DebugInfo = { className: string; frames: string[] };
// What a paid request was, for the hint after it fails in flight.
type PaidKind = "job" | "check" | "search" | "enhance";
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
  USAGE_CONFLICTING_OPTIONS: entry(
    2,
    "Those options can't be used together.",
    "Pick one. See --help after the command."
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
  INVALID_ENV: entry(
    2,
    "{name} is not valid.",
    "TASTE_API_URL takes an https address, or http on 127.0.0.1, ::1 or localhost. Fix or unset it."
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
  CREDENTIALS_STORE_FAILED: entry(
    1,
    "Couldn't update your saved sign in.",
    "Check that your keychain is unlocked and your config folder can be written, then try again."
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
  // The sign in service answered in a way taste can't use: a bad document, an error in the redirect,
  // a refused exchange. Its own words are never shown.
  LOGIN_FAILED: entry(
    1,
    "The sign in couldn't be finished.",
    "Run taste login again. If it keeps failing, wait a few minutes first.",
    true
  ),
  LOGIN_NOT_INTERACTIVE: entry(
    1,
    "This way of signing in needs a terminal.",
    "Run taste login in a terminal, pipe a key to taste login --with-api-key, or set TASTE_API_KEY."
  ),
  LOGIN_CANCELLED: entry(
    130,
    "Sign in cancelled.",
    "Nothing was saved. Run taste login when you are ready."
  ),
  // Never says what came in: it may be a key with a typo.
  INVALID_KEY_INPUT: entry(
    2,
    "No usable API key came in.",
    "Give the key alone, such as taste login --with-api-key < key.txt."
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
    "Taste could not compare those two: {reason}",
    "Check that both addresses are public sites that load, then run it again. Failed checks are refunded."
  ),
  // The verdict itself rides in details, so a script has the recommendations without another call.
  BELOW_THRESHOLD: entry(
    1,
    "The score {score} is below the minimum {min}.",
    "Work through the recommendations, or lower --min."
  ),
  SEARCH_BUSY: entry(
    1,
    "Taste search is busy right now.",
    "Try again in a minute.",
    true
  ),
  USAGE_INVALID_QUERY: entry(
    2,
    "A search query is 2 to 400 characters.",
    'Describe the look you want, such as taste search "dark brutalist developer tools".'
  ),
  USAGE_INVALID_INDUSTRY: entry(
    2,
    "--industry takes one of Taste's industries.",
    "Such as saas, ai, fintech, developer_tools, e_commerce or healthcare. taste search --help lists them all."
  ),
  USAGE_INVALID_PAGE_TYPE: entry(
    2,
    "--page-type takes one of Taste's page types.",
    `Page types: ${PAGE_TYPE.options.join(", ")}.`
  ),
  // A bare word given where a brand goes: Taste's ids are UUIDs, so it was most likely a site.
  USAGE_INVALID_BRAND: entry(
    2,
    "That isn't an extraction's id or a site's address.",
    "Give the site's address, such as {word}.com, or an extraction's id from taste history."
  ),
  USAGE_INVALID_PROMPT: entry(
    2,
    "The prompt is empty.",
    'Give the prompt in quotes, such as taste enhance "a pricing page" --brand stripe.com.'
  ),
  SELECTIVE_MAP_UNSUPPORTED: entry(
    2,
    "--sections and --map can't be used together.",
    "Drop --sections to map the site, or --map to extract some sections of one page."
  ),
  USAGE_INVALID_SECTIONS: entry(
    2,
    "--sections takes section names, separated by commas.",
    "Sections: profile, layout, colors, typography, surfaces, elevation, interactions, actions, navigation, data_display, structure, icons, assets, sections, brand_assets."
  ),
  USAGE_NEEDS_OPTION: entry(
    2,
    "{option} only works with {needs}.",
    "Add {needs}, or leave out {option}."
  ),
  FILE_NOT_FOUND: entry(
    1,
    "That file doesn't exist or can't be read.",
    "Check the path and that you can read the file."
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
  TIMEOUT: entry(
    1,
    "The Taste Engine didn't answer in time.",
    "Check your connection and try again.",
    true
  ),
  WAIT_TIMEOUT: entry(
    1,
    "Still working after the time you allowed.",
    "The job keeps running. Run taste wait {id} to pick it up.",
    true
  ),
  // A manifest path that would leave the folder, or a folder on the way that is a symlink, isn't the
  // person's own or that others can write to. Raised mid-run too, so it never claims nothing was written.
  BUNDLE_PATH_UNSAFE: entry(
    1,
    "taste stopped saving: a file would land outside the output folder, or in a folder someone else can change.",
    "Use a folder only you can write to. Report it at github.com/mfbz/taste-cli/issues if it keeps happening."
  ),
  // Anything else that stops a save after the job is done; the hint names the free way back.
  SAVE_FAILED: entry(
    1,
    "The job is done, but its files couldn't be saved.",
    "Run the command again with --debug and report it at github.com/mfbz/taste-cli/issues."
  ),
  DOWNLOAD_TOO_LARGE: entry(
    1,
    "{file} is larger than 100 MB, so taste didn't save it.",
    "Report it at github.com/mfbz/taste-cli/issues if the file should be there."
  ),
  // An API answer past its cap: never read whole, never retried.
  RESPONSE_TOO_LARGE: entry(
    1,
    "The Taste Engine's answer was larger than taste accepts.",
    "Run again with --debug and report it at github.com/mfbz/taste-cli/issues."
  ),
  // share: the API's answer didn't say whether the result is public now. Setting it again is harmless.
  VISIBILITY_UNKNOWN: entry(
    1,
    "Taste didn't say whether that result is public now.",
    "Run the command again; it is safe to repeat.",
    true
  ),
  // An asset from a manifest: its host is a CDN, not the Taste Engine, so API codes would mislead.
  DOWNLOAD_FAILED: entry(
    1,
    "Couldn't download {file} ({status}).",
    "Run the command again. Each run gets fresh download links.",
    true
  ),
  // The manifest itself can't be saved as it stands: two entries on one file, an entry with nothing
  // in it, or an asset address that isn't public https.
  BUNDLE_INVALID: entry(
    1,
    "The download lists files taste won't save.",
    "Nothing was written. Report it at github.com/mfbz/taste-cli/issues if it keeps happening."
  ),
  // The job is finished and paid for, so the way to the files again is wait, which is free.
  BUNDLE_INCOMPLETE: entry(
    1,
    "Saved {written} of {total} files and skipped {skipped}, then {file} couldn't be saved.",
    "The result is safe on Taste. Run taste wait {id} --out with the same folder and --overwrite to save it all, for free."
  ),
  OUTPUT_EXISTS: entry(
    1,
    "That output folder already has files in it.",
    "Choose another folder with --out, or add --overwrite to replace files of the same name."
  ),
  OUTPUT_UNUSABLE: entry(
    1,
    "taste can't save files in that output folder.",
    "Give --out a folder you can write to, or a new one."
  ),
  USAGE_OUT_UNSUPPORTED: entry(
    2,
    "--out saves the files of an extraction or a brand kit, and that id is a brand adherence check.",
    "Leave out --out. With --format json the verdict is printed whole."
  ),
  // Ctrl-C while a paid job runs: the job carries on server side, so say how to pick it up.
  INTERRUPTED: entry(
    130,
    "Interrupted.",
    // Shown when no job was started; JOB_HINTS has the hint for when one was.
    "Run the command again.",
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
// A job's own error is free text: cleaned of control characters (an agent reads the JSON too),
// shortened, with key-shaped tokens redacted one by one so the rest stays readable.
const TEXT_PARAMS = new Set(["reason"]);
const TEXT_LIMIT = 120;
// A file's path from a download manifest: server text but no secret, so it is shown, cleaned of
// control characters, cut, with key-shaped tokens redacted. Never a URL: the signed link stays out.
const PATH_PARAMS = new Set(["file"]);
// An address taste normalized (a brand to extract): shown so the hint stays a command to copy, without
// a user name, password, query or fragment, cleaned and cut like a path.
const URL_PARAMS = new Set(["url"]);
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
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

// With a job id the job carries on server side, so the hint says how to pick it up rather than run
// it, and pay for it, again.
const RESUME_HINT = "The job carries on. Run taste wait {id} to pick it up.";
const JOB_HINTS: Partial<Record<ErrorCode, string>> = {
  INTERRUPTED: RESUME_HINT,
  NETWORK: RESUME_HINT,
  TIMEOUT: RESUME_HINT,
  UPSTREAM: RESUME_HINT,
  RATE_LIMITED: RESUME_HINT,
};
// A paid request that failed in flight (params.paid names its kind) may still have reached Taste and
// been charged, so it is never offered as a retry: running it again could pay twice. Where to look
// first depends on what was sent.
const PAID_HINTS: Readonly<Record<PaidKind, string>> = {
  job: "It may have reached Taste and started anyway. Check taste history before you run it again, so you don't pay twice.",
  check:
    "It may have reached Taste and started anyway. Check taste history checks before you run it again, so you don't pay twice.",
  search:
    "It may have reached Taste and been charged. Check taste history searches before you run it again, so you don't pay twice.",
  enhance:
    "It may have reached Taste and been charged. Enhancements aren't listed in taste history, so check your credits in your Taste account before you run it again.",
};
const PAID_CODES = new Set<ErrorCode>([
  "NETWORK",
  "TIMEOUT",
  "INTERRUPTED",
  "RESPONSE_TOO_LARGE",
]);
// A failed save after a finished job: the result is safe on Taste, and wait --out saves it for free.
const SAVE_AGAIN =
  "The result is safe on Taste. Run taste wait {id} --out with a folder only you can write to";
const SAVE_HINTS: Partial<Record<ErrorCode, string>> = {
  OUTPUT_EXISTS: `${SAVE_AGAIN}, empty or with --overwrite, to save it for free.`,
  OUTPUT_UNUSABLE: `${SAVE_AGAIN} to save it for free.`,
  BUNDLE_PATH_UNSAFE: `${SAVE_AGAIN}, and --overwrite if it has files, to save it for free. Report it at github.com/mfbz/taste-cli/issues if it keeps happening.`,
  BUNDLE_INVALID:
    "Nothing was written. The result is safe on Taste: taste wait {id} shows it for free. Report it at github.com/mfbz/taste-cli/issues.",
  SAVE_FAILED: `${SAVE_AGAIN}, and --overwrite if it has files, to save it for free.`,
};

// A brand given by its address (similar, enhance) with no usable extraction: the way forward is one
// command, so it is named with the address taste already normalized.
const BRAND_URL: Partial<Record<ErrorCode, Pick<Entry, "message" | "hint">>> = {
  NOT_FOUND: {
    message: "You have no finished extraction of {url}.",
    hint: "Run taste extract {url} first. It spends credits.",
  },
  FULL_EXTRACTION_REQUIRED: {
    message:
      "Your extraction of {url} has only some sections, and this needs a full one.",
    hint: "Run taste extract {url} without --sections first. It spends credits.",
  },
};

// A save stopped by a sign in or credit problem keeps that code and hint, with the job's id added.
const KEPT_ON_SAVE = new Set<ErrorCode>([
  "NOT_SIGNED_IN",
  "SESSION_EXPIRED",
  "INVALID_API_KEY",
  "FORBIDDEN",
  "INSUFFICIENT_CREDITS",
]);

const DETAIL_CODES = new Set<ErrorCode>([
  "BUNDLE_INCOMPLETE",
  ...KEPT_ON_SAVE,
  ...(Object.keys(SAVE_HINTS) as ErrorCode[]),
  "INTERRUPTED",
  "WAIT_TIMEOUT",
  "JOB_FAILED",
  "ADHERENCE_FAILED",
  "NETWORK",
  "TIMEOUT",
  "UPSTREAM",
  "RATE_LIMITED",
]);

class CliError extends Error {
  readonly code: ErrorCode;
  readonly params: Params;
  // Only BELOW_THRESHOLD carries any: the verdict, which JSON escapes, so it needs no cleaning.
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: ErrorCode,
    params: Params = {},
    options?: { cause?: unknown; details?: Readonly<Record<string, unknown>> }
  ) {
    // The message is ours and contains no parameters, so it is safe wherever it ends up.
    super(
      CATALOGUE[code].message,
      options && "cause" in options ? { cause: options.cause } : undefined
    );
    this.name = "CliError";
    this.code = code;
    this.params = params;
    if (options?.details) this.details = options.details;
  }
}

// A manifest path made safe to show anywhere: no URL (a signed link stays out), no control
// characters, key-shaped tokens redacted, at most 120 characters.
function cleanPath(value: string): string {
  if (/:\/\/|[?#]/.test(value)) return "…";
  const path = [...value.replace(CONTROL, "").replace(KEY_TOKEN, "…")];
  const cut =
    path.length > TEXT_LIMIT
      ? `${path.slice(0, TEXT_LIMIT - 1).join("")}…`
      : path.join("");
  return cut === "" ? "…" : cut;
}

function cleanUrl(value: string): string {
  const url = URL.parse(value);
  if (!url) return "…";
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  const text = [...url.href.replace(CONTROL, "").replace(KEY_TOKEN, "…")];
  return text.length > TEXT_LIMIT
    ? `${text.slice(0, TEXT_LIMIT - 1).join("")}…`
    : text.join("");
}

function fill(template: string, params: Params): string {
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = String(params[name] ?? "");
    if (name === "id") return isJobId(value) ? value : "…";
    if (TEXT_PARAMS.has(name)) {
      const text = value
        .replace(CONTROL, "")
        .trim()
        .slice(0, TEXT_LIMIT)
        .replace(KEY_TOKEN, "…");
      return text === "" ? "…" : text;
    }
    if (PATH_PARAMS.has(name)) return cleanPath(value);
    if (URL_PARAMS.has(name)) return cleanUrl(value);
    if (KEY_SHAPED.test(value)) return "…";
    const safe = NAME_PARAMS.has(name)
      ? NAME.test(value) && !KEY_PREFIX.test(value)
      : SAFE_PARAM.test(value);
    return safe ? value : "…";
  });
}

function report(code: ErrorCode, params: Params = {}): FullReport {
  const { exit } = CATALOGUE[code];
  const byUrl = params.url === undefined ? undefined : BRAND_URL[code];
  const message = byUrl?.message ?? CATALOGUE[code].message;
  const hasJob = isJobId(String(params.id ?? ""));
  const paidKind = params.paid === undefined ? undefined : String(params.paid);
  // An unknown kind still warns: the job hint, never a plain retry.
  const paidHint = paidKind
    ? (PAID_HINTS[paidKind as PaidKind] ?? PAID_HINTS.job)
    : undefined;
  const paid = paidHint !== undefined && PAID_CODES.has(code);
  const hint =
    (hasJob ? (JOB_HINTS[code] ?? SAVE_HINTS[code]) : undefined) ??
    (paid ? paidHint : (byUrl?.hint ?? CATALOGUE[code].hint));
  return {
    code,
    message: fill(message, params),
    hint: fill(hint, params),
    // Retryable means running the same command again is safe and costs nothing extra; never when the
    // hint is taste wait (the job runs on) or the paid one (it may have been charged).
    retryable:
      CATALOGUE[code].retryable && !paid && !(hasJob && DETAIL_CODES.has(code)),
    exitCode: exit,
    ...(DETAIL_CODES.has(code) && hasJob
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

// Class name and stack frames only: frames hold file names and line numbers, never values. The stack
// starts with the message, which may span lines (some may even start with "at "), so those lines are
// dropped by count; a stack that doesn't start with the message gives no frames at all.
function debugInfo(error: unknown): DebugInfo {
  const className =
    error instanceof Error ? error.constructor.name : typeof error;
  if (!(error instanceof Error) || !error.stack)
    return { className, frames: [] };
  const head = String(error);
  if (!error.stack.startsWith(head)) return { className, frames: [] };
  const frames = error.stack
    .split("\n")
    .slice(head.split("\n").length)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("at "))
    .map((line) => line.replace(KEY_TOKEN, "…"))
    .slice(0, 12);
  return { className, frames };
}

// A failure while waiting on a job that is already running (the network, Taste's side) leaves the job
// running, so the error carries its id and the hint says taste wait instead of try again.
function whileWaiting(error: unknown, id: string): unknown {
  if (error instanceof CliError) {
    if (error.params.id !== undefined || !JOB_HINTS[error.code]) return error;
    return new CliError(error.code, { ...error.params, id }, { cause: error });
  }
  if (!isUpstreamError(error)) return error;
  const code = upstreamReport(error).code as ErrorCode;
  return JOB_HINTS[code] ? new CliError(code, { id }, { cause: error }) : error;
}

// A save that fails after the job is done must never lose the job's id: every failure carries it, with
// the hint to save again for free. Ctrl-C keeps its own hint (taste wait).
function whileSaving(error: unknown, id: string): unknown {
  if (error instanceof CliError) {
    if (error.code === "INTERRUPTED") return whileWaiting(error, id);
    if (
      error.code === "BUNDLE_INCOMPLETE" ||
      SAVE_HINTS[error.code] ||
      KEPT_ON_SAVE.has(error.code)
    )
      return new CliError(
        error.code,
        { ...error.params, id },
        { cause: error }
      );
  }
  // Sign in and credit problems keep their own words: saving again won't help until they are fixed.
  if (isUpstreamError(error)) {
    const code = upstreamReport(error).code as ErrorCode;
    if (KEPT_ON_SAVE.has(code)) {
      const credits: Params =
        code === "INSUFFICIENT_CREDITS"
          ? {
              balance: error.balance ?? "unknown",
              required: error.required ?? "unknown",
            }
          : {};
      return new CliError(code, { ...credits, id }, { cause: error });
    }
  }
  return new CliError("SAVE_FAILED", { id }, { cause: error });
}

function toErrorReport(error: unknown): FullReport {
  if (error instanceof CliError) {
    const full = report(error.code, error.params);
    return error.details ? { ...full, details: error.details } : full;
  }
  const full = isUpstreamError(error)
    ? upstreamReport(error)
    : report("INTERNAL");
  return { ...full, debug: debugInfo(error) };
}

export {
  CATALOGUE,
  cleanPath,
  CliError,
  isUpstreamError,
  toErrorReport,
  whileSaving,
  whileWaiting,
};
export type { DebugInfo, ErrorCode, ErrorReport, ExitCode, PaidKind };
