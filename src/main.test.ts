import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const MAIN = fileURLToPath(new URL("./main.ts", import.meta.url));

describe("the taste entry point", () => {
  it("runs from source and exits with run()'s code", () => {
    const ok = spawnSync(process.execPath, [MAIN, "--version"], {
      encoding: "utf8",
    });
    expect(ok.status).toBe(0);
    expect(ok.stdout).toMatch(/^\d+\.\d+\.\d+\n$/);
    expect(spawnSync(process.execPath, [MAIN, "--nope"]).status).toBe(2);
  });

  it("exits quietly when the reader closes the pipe early (taste --help | head -0)", async () => {
    const child = spawn(process.execPath, [MAIN, "--help"]);
    // Close our end before the child has started, so its first write hits a closed pipe.
    child.stdout.destroy();
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    const code = await new Promise<number | null>((resolve) =>
      child.on("close", resolve)
    );
    expect(stderr).not.toContain("EPIPE");
    expect(code).toBe(0);
  });

  it("ends a command that Ctrl-C interrupts with exit 130 and one --json document", async () => {
    // Waits on stdin, which the test keeps open, so only the interrupt can end it.
    const child = spawn(
      process.execPath,
      [MAIN, "login", "--with-api-key", "--json"],
      { env: { PATH: process.env.PATH }, stdio: ["pipe", "pipe", "pipe"] }
    );
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    setTimeout(() => child.kill("SIGINT"), 1_000);
    const code = await new Promise<number | null>((resolve) =>
      child.on("close", resolve)
    );
    child.stdin.destroy();
    expect(code).toBe(130);
    expect(stdout.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(stdout)).toMatchObject({
      ok: false,
      error: { code: "INTERRUPTED" },
    });
  });
});
