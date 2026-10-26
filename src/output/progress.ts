// A job's live progress on stderr. In a terminal that allows motion, one line redraws in place with a
// spinner, the step and the time so far, never wider than the terminal; elsewhere each step is one
// note. Under --json, nothing. Output keeps the line out of the way of anything else on stderr.
import {
  renderDone,
  renderProgressLine,
  renderStepNote,
} from "../render/progress.ts";
import type { Output } from "./output.ts";

type Progress = {
  step(step: string): void;
  // Clears the line and closes it with a check mark; what is ours, already cleaned.
  done(what: string, cached: boolean): void;
  // Clears the line, if any; safe to call more than once.
  stop(): void;
};

const FRAME_MS = 80;

function startProgress(options: {
  output: Output;
  motion: boolean;
  now: () => number;
  width: number;
}): Progress {
  const { output, now, width } = options;
  const motion = options.motion && !output.json;
  const started = now();
  let current = "";
  let frame = 0;
  let timer: ReturnType<typeof setInterval> | undefined;

  const draw = () => {
    output.live(
      renderProgressLine(frame, current, now() - started, output.theme, width)
    );
    frame += 1;
  };
  const stop = () => {
    if (timer === undefined) return;
    clearInterval(timer);
    timer = undefined;
    output.live(null);
  };

  return {
    step(step) {
      current = step;
      if (!motion) {
        output.note(renderStepNote(step, now() - started, output.theme));
        return;
      }
      draw();
      timer ??= setInterval(draw, FRAME_MS);
      timer.unref();
    },
    done(what, cached) {
      stop();
      output.note(renderDone(what, now() - started, cached, output.theme));
    },
    stop,
  };
}

export { startProgress };
export type { Progress };
