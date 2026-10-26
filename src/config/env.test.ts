import { describe, expect, it } from "vitest";

import { CliError, toErrorReport } from "../output/errors.ts";
import { readEnv } from "./env.ts";

function thrown(fn: () => unknown): CliError {
  try {
    fn();
  } catch (error) {
    if (error instanceof CliError) return error;
    throw error;
  }
  throw new Error("expected a CliError");
}

// Built at run time so no key-shaped literal sits in the repo.
const KEY = ["taste", "test", "x".repeat(8)].join("_");

describe("readEnv", () => {
  it("reads the key, the URL and the motion switch, and treats blank values as unset", () => {
    expect(
      readEnv({ TASTE_API_KEY: " ", TASTE_API_URL: "", TASTE_NO_MOTION: "" })
    ).toEqual({});
    expect(
      readEnv({
        TASTE_API_KEY: ` ${KEY} `,
        TASTE_API_URL: "https://api.example.com",
        TASTE_NO_MOTION: "1",
      })
    ).toEqual({
      apiKey: KEY,
      apiUrl: "https://api.example.com",
      noMotion: true,
    });
    expect(readEnv({ TASTE_NO_MOTION: "false" })).toEqual({ noMotion: false });
  });

  it("accepts plain http only on a loopback host, for the local mock", () => {
    for (const url of ["http://127.0.0.1:4010", "http://[::1]:4010"])
      expect(readEnv({ TASTE_API_URL: url }).apiUrl).toBe(url);
  });

  it("refuses any other API URL with a usage error that never echoes it", () => {
    for (const url of [
      "http://api.example.com",
      "http://10.0.0.1",
      "file:///etc/passwd",
      "not a url",
      "https://user:secret@api.example.com",
    ]) {
      const report = toErrorReport(
        thrown(() => readEnv({ TASTE_API_URL: url }))
      );
      expect(report.code, url).toBe("INVALID_ENV");
      expect(report.exitCode).toBe(2);
      expect(JSON.stringify(report)).not.toContain("secret");
    }
  });
});
