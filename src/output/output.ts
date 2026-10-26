import { toErrorReport } from "./errors.ts";
import type { ExitCode } from "./errors.ts";
import type { Theme } from "./theme.ts";

type Writer = (text: string) => void;
type Output = {
  json: boolean;
  theme: Theme;
  /** The command's result: one --json document, or the human rendering, on stdout. */
  result<T>(data: T, human: (theme: Theme) => string): void;
  /** Progress or context for a person, on stderr; silent with --json so stdout stays one document. */
  note(text: string): void;
  /** A live line that redraws itself (progress), on stderr as is; silent with --json. */
  status(text: string): void;
  /** Something a person must know (a credential ignored or left behind), on stderr in every mode. */
  warn(text: string): void;
  /** Reports a failure the same way everywhere and returns the exit code. */
  fail(error: unknown): ExitCode;
};
type OutputOptions = {
  json: boolean;
  debug: boolean;
  theme: Theme;
  stdout: Writer;
  stderr: Writer;
};

// C0 and C1 control characters (ESC, BEL, CR, CSI…), optionally keeping newlines and tabs. Text from
// the server is the server's to choose, so it is cleaned before it reaches a terminal: an escape
// sequence could otherwise clear the screen, retitle the window or forge a line of output.
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;
const CONTROL_AND_LAYOUT = /[\u0000-\u001f\u007f-\u009f]/g;

/** Untrusted text made safe to print in a terminal. JSON output needs none of this: JSON escapes it. */
function plain(text: string, options: { newlines?: boolean } = {}): string {
  return text.replace(options.newlines ? CONTROL : CONTROL_AND_LAYOUT, "");
}

function createOutput(options: OutputOptions): Output {
  const { json, debug, theme, stdout, stderr } = options;
  // One document per run, whatever happens after it: a late failure never adds a second.
  let documented = false;
  const document = (value: unknown) => {
    if (documented) return;
    documented = true;
    stdout(`${JSON.stringify(value)}\n`);
  };
  return {
    json,
    theme,
    result(data, human) {
      if (json) document({ ok: true, data });
      else stdout(`${human(theme)}\n`);
    },
    note(text) {
      if (!json) stderr(`${text}\n`);
    },
    status(text) {
      if (!json) stderr(text);
    },
    warn(text) {
      stderr(`${theme.warning("warning:")} ${plain(text)}\n`);
    },
    fail(error) {
      const { exitCode, debug: trace, ...report } = toErrorReport(error);
      if (json) document({ ok: false, error: report });
      else
        stderr(
          `${theme.error("✗ error:")} ${plain(report.message)}\n${theme.dim(`  ${plain(report.hint)}`)}\n`
        );
      // Details for a bug report: class name and stack frames only, on stderr, never in the document.
      if (debug && trace) {
        const lines = [
          `debug: ${trace.className}`,
          ...trace.frames.map((f) => `  ${f}`),
        ];
        stderr(`${theme.dim(plain(lines.join("\n"), { newlines: true }))}\n`);
      }
      return exitCode;
    },
  };
}

export { createOutput, plain };
export type { Output, Writer };
