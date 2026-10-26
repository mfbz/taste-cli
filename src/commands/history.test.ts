import { describe, expect, it } from "vitest";

import { createFakeApi } from "../api/fake-api.ts";
import type { FakeApi } from "../api/fake-api.ts";
import { fixtureState } from "../api/fixtures.ts";
import { runCli } from "../fake-io.ts";
import { fixtures, jobSeams } from "../job-seams.ts";

const ANSI = /\u001b/;
const SUBMISSIONS = [
  "00000000-0000-4000-8000-000000000100",
  "00000000-0000-4000-8000-000000000200",
  "00000000-0000-4000-8000-000000000300",
  "00000000-0000-4000-8000-000000000500",
];
const PASS = "00000000-0000-4000-8000-000000000900";
const FAIL = "00000000-0000-4000-8000-000000001000";

// A fresh fake with the same fixtures, for what the API itself answers.
function reference(): FakeApi {
  return createFakeApi(fixtureState(fixtures));
}

describe("taste history", () => {
  it("lists extractions by default: id, when, status and address", async () => {
    const { api, io } = jobSeams();
    const { code, out } = await runCli(["history"], io);
    expect(code).toBe(0);
    expect(api.calls).toEqual(["GET /design/submissions"]);
    for (const id of SUBMISSIONS) expect(out).toContain(id);
    expect(out).toContain("https://stripe.com/");
    expect(out).toContain("2026-10-26");
    expect(out).toContain("completed");
    expect(out).not.toMatch(ANSI);
  });

  it("gives --json the API's list unchanged, and fetches nothing else", async () => {
    const { api, io } = jobSeams();
    const { code, doc } = await runCli(["history", "checks", "--json"], io);
    expect(code).toBe(0);
    expect(doc().data).toEqual(
      await reference().listAdherence({ limit: 20, offset: 0 })
    );
    expect(api.calls).toEqual(["GET /judge/brand-adherence"]);
    const searches = await runCli(["history", "searches", "--json"], io);
    expect(searches.doc().data).toEqual(
      await reference().listSearches({ limit: 20, offset: 0 })
    );
  });

  it("shows each check's score", async () => {
    const { io } = jobSeams();
    const { code, out } = await runCli(["history", "checks"], io);
    expect(code).toBe(0);
    const line = (id: string) => out.split("\n").find((l) => l.includes(id));
    expect(line(PASS)).toContain("0.90");
    expect(line(FAIL)).toContain("0.15");
    expect(line(PASS)).toContain("https://tastelabs.com/");
  });

  it("lists searches with their query", async () => {
    const { io } = jobSeams();
    const { code, out } = await runCli(["history", "searches"], io);
    expect(code).toBe(0);
    expect(out).toContain("dark brutalist developer tools");
    expect(out).toContain("00000000-0000-4000-8000-000000000600");
  });

  it("finds a paid job just started with no options, first in the list", async () => {
    const { api, io } = jobSeams();
    const started = await api.createSubmission({ url: "https://example.com/" });
    const { out } = await runCli(["history"], io);
    const first = out.split("\n")[1] ?? "";
    expect(first).toContain(started.submission_id);
    expect(first).toContain("accepted");
  });

  it("passes the filters and the page to the API", async () => {
    const { api, io } = jobSeams();
    const seen: unknown[] = [];
    const listSubmissions: FakeApi["listSubmissions"] = (query) => {
      seen.push(query);
      return api.listSubmissions(query);
    };
    const { code } = await runCli(
      [
        "history",
        "extractions",
        "--status",
        "failed",
        "--search",
        "stripe",
        "--limit",
        "5",
        "--offset",
        "10",
      ],
      { ...io, api: { ...api, listSubmissions } }
    );
    expect(code).toBe(0);
    expect(seen).toEqual([
      { status: "failed", q: "stripe", limit: 5, offset: 10 },
    ]);
  });

  it("cuts the last column to a terminal's width, and nothing in a pipe", async () => {
    const long = `https://example.com/${"a".repeat(80)}`;
    const { io } = jobSeams({
      submissions: [
        {
          submission_id: "sub-9",
          status: "completed",
          source_url: long,
          is_public: false,
          accepted_at: "2026-10-26T10:00:00Z",
        },
      ],
    });
    const piped = await runCli(["history"], io);
    expect(piped.out).toContain(long);
    const terminal = await runCli(["history"], {
      ...io,
      terminal: { tty: true, width: 70, colorLevel: 0, motion: false },
    });
    const lines = terminal.out.trimEnd().split("\n");
    for (const line of lines) expect([...line].length).toBeLessThan(70);
    expect(terminal.out).toContain("…");
  });

  it("says how to see more when the page is not the whole list", async () => {
    const { io } = jobSeams();
    const { out } = await runCli(["history", "--limit", "1"], io);
    expect(out).toContain("1 of 4");
    expect(out).toContain("--offset 1");
  });

  it("says so when there is nothing to list", async () => {
    const { io } = jobSeams({ submissions: [] });
    const { code, out } = await runCli(["history"], io);
    expect(code).toBe(0);
    expect(out).toContain("No extractions");
  });

  it("refuses a status the list doesn't have, and a limit out of range, before any request", async () => {
    const { api, io } = jobSeams();
    for (const argv of [
      ["history", "--status", "judging"],
      ["history", "searches", "--status", "crawling"],
      ["history", "--limit", "0"],
      ["history", "--limit", "101"],
      ["history", "everything"],
    ]) {
      const { code, doc } = await runCli([...argv, "--json"], io);
      expect(code, argv.join(" ")).toBe(2);
      expect(doc().error.code).toMatch(/^USAGE_/);
    }
    expect(api.calls).toEqual([]);
  });

  it("strips control characters from what Taste sends", async () => {
    const { io } = jobSeams({
      submissions: [
        {
          submission_id: "sub-9",
          status: "completed",
          source_url: "https://example.com/\u001b[2J\u0007",
          is_public: false,
          accepted_at: "2026-10-26T10:00:00Z",
        },
      ],
    });
    const { out } = await runCli(["history"], io);
    expect(out).toContain("https://example.com/[2J");
    expect(out).not.toMatch(/[\u0000-\u0008\u000b-\u001f]/);
  });

  it("is free, and says so nowhere as spending", async () => {
    const { out } = await runCli(["history", "--help"]);
    expect(out).not.toMatch(/spends credits/i);
  });
});
