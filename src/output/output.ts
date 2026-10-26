import { toErrorReport } from "./errors.ts";
import type { ExitCode } from "./errors.ts";

type Writer = (text: string) => void;
type Output = {
  json: boolean;
  /** The command's result: one --json document, or the human rendering, on stdout. */
  result<T>(data: T, human: () => string): void;
  /** Reports a failure the same way everywhere and returns the exit code. */
  fail(error: unknown): ExitCode;
};
type OutputOptions = {
  json: boolean;
  debug: boolean;
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
  const { json, debug, stdout, stderr } = options;
  const document = (value: unknown) => stdout(`${JSON.stringify(value)}\n`);
  return {
    json,
    result(data, human) {
      if (json) document({ ok: true, data });
      else stdout(`${human()}\n`);
    },
    fail(error) {
      const { exitCode, debug: details, ...report } = toErrorReport(error);
      if (json) document({ ok: false, error: report });
      else
        stderr(`✗ error: ${plain(report.message)}\n  ${plain(report.hint)}\n`);
      // Details for a bug report: class name and stack frames only, on stderr, never in the document.
      if (debug && details) {
        const lines = [
          `debug: ${details.className}`,
          ...details.frames.map((f) => `  ${f}`),
        ];
        stderr(`${plain(lines.join("\n"), { newlines: true })}\n`);
      }
      return exitCode;
    },
  };
}

export { createOutput, plain };
export type { Output, Writer };
