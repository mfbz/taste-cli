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
});
