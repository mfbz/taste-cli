import { describe, expect, it } from "vitest";

import pkg from "../../package.json" with { type: "json" };
import { createContext } from "../context.ts";
import type { Io } from "../io.ts";
import { createOutput } from "../output/output.ts";
import { createTheme } from "../output/theme.ts";
import { openingFrame, playOpening, WORDMARK } from "./opening.ts";

const HIDE = "\u001b[?25l";
const SHOW = "\u001b[?25h";
const settled = `${openingFrame(1, createTheme(0)).join("\n")}\n`;

function opening(seams: Partial<Io> = {}, terminal = { motion: true }) {
  let err = "";
  const io: Io = {
    stdout: () => {},
    stderr: (text) => (err += text),
    terminal: { tty: true, width: 80, colorLevel: 0, ...terminal },
    sleep: () => Promise.resolve(),
    ...seams,
  };
  const ctx = createContext(
    io,
    createOutput({
      json: false,
      debug: false,
      theme: createTheme(0),
      stdout: io.stdout,
      stderr: io.stderr,
    })
  );
  const signal = new AbortController().signal;
  return { play: () => playOpening(ctx, { signal }), err: () => err };
}

describe("the opening", () => {
  it("is our own lettering, 5 rows that fit 64 columns", () => {
    expect(WORDMARK).toHaveLength(5);
    for (const line of WORDMARK) expect(line.length).toBeLessThanOrEqual(64);
    expect(settled).toContain(
      `unofficial CLI for the Taste Engine · ${pkg.version}`
    );
  });

  it("writes only the final frame without motion", async () => {
    const run = opening({}, { motion: false });
    await run.play();
    expect(run.err()).toBe(settled);
  });

  it("plays its frames, hiding the cursor and showing it again", async () => {
    const run = opening();
    await run.play();
    const err = run.err();
    expect(err.startsWith(HIDE)).toBe(true);
    expect(err.endsWith(SHOW)).toBe(true);
    expect(err).toContain("▒");
    expect(err.split("unofficial CLI").length - 1).toBe(12);
  });

  it("jumps to the final frame on a key press", async () => {
    let press = () => {};
    let sleeps = 0;
    const run = opening({
      keypress: () => new Promise<void>((resolve) => (press = resolve)),
      sleep: async () => {
        sleeps += 1;
        if (sleeps === 2) press();
        await Promise.resolve();
      },
    });
    await run.play();
    expect(run.err().split("unofficial CLI").length - 1).toBe(3);
    expect(run.err()).toContain(WORDMARK[0]);
    expect(run.err().endsWith(SHOW)).toBe(true);
  });

  it("shows the cursor again when drawing fails", async () => {
    const run = opening({ sleep: () => Promise.reject(new Error("broken")) });
    await expect(run.play()).rejects.toThrow("broken");
    expect(run.err().endsWith(SHOW)).toBe(true);
  });

  it("is one line in a terminal narrower than the wordmark", async () => {
    const run = opening({
      terminal: { tty: true, width: 50, colorLevel: 0, motion: true },
    });
    await run.play();
    expect(run.err()).toBe("TASTE · unofficial CLI for the Taste Engine\n");
  });
});
