import { describe, expect, it } from "vitest";

import { runCli } from "../fake-io.ts";
import type { Io, Prompter } from "../io.ts";
import { jobSeams, recorded } from "../job-seams.ts";

type Answer = string | boolean | null;
type Asked = {
  kind: string;
  message: string;
  choices?: string[];
  problem?: string;
};

const TERMINAL = {
  tty: true,
  width: 80,
  colorLevel: 0,
  motion: false,
} as const;
const ENV = { TASTE_API_KEY: ["taste", "session", "test"].join("_") };

// Answers each question in turn, as a person would. An answer the field refuses is recorded with the
// reason, and the field is left as a person would leave it: with Ctrl-C.
function scripted(answers: Answer[]) {
  const asked: Asked[] = [];
  const next = () => {
    if (answers.length === 0) throw new Error("no answer left");
    return answers.shift() ?? null;
  };
  const prompter: Prompter = {
    select: (message, choices) => {
      asked.push({
        kind: "select",
        message,
        choices: choices.map((c) => c.label),
      });
      return Promise.resolve(next() as never);
    },
    text: (message, validate) => {
      const answer = next() as string | null;
      const problem = answer === null ? undefined : validate(answer);
      asked.push({ kind: "text", message, ...(problem ? { problem } : {}) });
      return Promise.resolve(problem ? null : answer);
    },
    confirm: (message) => {
      asked.push({ kind: "confirm", message });
      return Promise.resolve(next() as boolean | null);
    },
  };
  return { prompter, asked };
}

function session(answers: Answer[], overrides: Partial<Io> = {}) {
  const { prompter, asked } = scripted(answers);
  const { api, io } = jobSeams(
    { results: { "sub-1": recorded("extract-full") } },
    { interactive: true, terminal: TERMINAL, env: ENV, prompter, ...overrides }
  );
  return { api, asked, io };
}

describe("taste with no arguments in a terminal", () => {
  it("extracts a brand from the menu once the spend is confirmed", async () => {
    const { api, asked, io } = session([
      "extract",
      "tastelabs.com",
      true,
      "quit",
    ]);
    const { code, out, err } = await runCli([], io);
    expect(code).toBe(0);
    expect(err).toContain("the Taste Engine, in your terminal");
    expect(err).toContain("Using an API key from TASTE_API_KEY.");
    expect(asked[0]?.choices).toContain("Extract a brand (uses credits)");
    expect(asked[0]?.choices).toContain("Sign out");
    expect(asked[2]?.message).toBe("Extract tastelabs.com? It uses credits.");
    expect(api.calls[0]).toBe("POST /design/submissions");
    expect(out).toContain("#0000EE");
  });

  it("spends nothing when the confirm is declined, and goes back to the menu", async () => {
    const { api, asked, io } = session([
      "extract",
      "stripe.com",
      false,
      "quit",
    ]);
    const { code } = await runCli([], io);
    expect(code).toBe(0);
    expect(api.calls).toEqual([]);
    expect(asked.filter((q) => q.kind === "select")).toHaveLength(2);
  });

  it("goes back to the menu on Ctrl-C at a prompt, and quits with 0 on Ctrl-C at the menu", async () => {
    const { api, asked, io } = session(["search", null, null]);
    const { code } = await runCli([], io);
    expect(code).toBe(0);
    expect(api.calls).toEqual([]);
    expect(asked.map((q) => q.kind)).toEqual(["select", "text", "select"]);
  });

  it("refuses a private address at the prompt, before anything is spent", async () => {
    const { api, asked, io } = session(["extract", "localhost:3000", "quit"]);
    await runCli([], io);
    expect(asked[1]?.problem).toContain("private network");
    expect(api.calls).toEqual([]);
  });

  it("shows the help, with no animation, outside an interactive terminal", async () => {
    for (const overrides of [
      { interactive: false },
      { env: { ...ENV, CI: "true" } },
    ]) {
      const { api, asked, io } = session([], {
        ...overrides,
        terminal: { ...TERMINAL, motion: true },
      });
      const { code, out, err } = await runCli([], io);
      expect(code).toBe(0);
      expect(out).toContain("Usage: taste");
      expect(out + err).not.toContain("\u001b[?25l");
      expect(asked).toEqual([]);
      expect(api.calls).toEqual([]);
    }
  });
});
