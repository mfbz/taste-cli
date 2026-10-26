import { describe, expect, it } from "vitest";

import pkg from "../../package.json" with { type: "json" };
import { createContext } from "../context.ts";
import type { Io } from "../io.ts";
import { createOutput } from "../output/output.ts";
import { createTheme } from "../output/theme.ts";
import { openingLines, playOpening } from "./opening.ts";

const HIDE = "\u001b[?25l";
const SHOW = "\u001b[?25h";
const settled = openingLines(createTheme(0), 80);

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
  it("is the name, the tagline and the version over a rule, with room to breathe", () => {
    expect(settled).toBe(
      `◇ taste  the Taste Engine, in your terminal  ${pkg.version}\n${"─".repeat(58)}\n\n`
    );
  });

  it("writes only the final frame without motion", async () => {
    const run = opening({}, { motion: false });
    await run.play();
    expect(run.err()).toBe(`\n${settled}`);
  });

  it("types the name, hiding the cursor and showing it again", async () => {
    const run = opening();
    await run.play();
    const err = run.err();
    expect(err.startsWith(`\n${HIDE}`)).toBe(true);
    expect(err.endsWith(`${settled}${SHOW}`)).toBe(true);
    for (const typed of ["◇ t_", "◇ tast_", "◇ taste_"])
      expect(err).toContain(typed);
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
    expect(run.err()).toContain("◇ ta_");
    expect(run.err()).not.toContain("◇ tas_");
    expect(run.err().endsWith(`${settled}${SHOW}`)).toBe(true);
  });

  it("shows the cursor again when drawing fails", async () => {
    const run = opening({ sleep: () => Promise.reject(new Error("broken")) });
    await expect(run.play()).rejects.toThrow("broken");
    expect(run.err().endsWith(SHOW)).toBe(true);
  });

  it("shortens the rule in a narrow terminal", async () => {
    const run = opening({
      terminal: { tty: true, width: 40, colorLevel: 0, motion: false },
    });
    await run.play();
    expect(run.err().endsWith(`\n${"─".repeat(36)}\n\n`)).toBe(true);
  });
});
