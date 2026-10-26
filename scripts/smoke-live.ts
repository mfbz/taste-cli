// npm run smoke:live: runs the built CLI against the real Taste Engine with your own sign in (taste
// login or TASTE_API_KEY), free and read-only commands only. Paid commands are smoke tested by the
// maintainer by hand. Each step prints its name, ok or failed and how long it took, never what Taste
// answered: an email, an id or an address would end up in a terminal log or an agent's transcript.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

type Step = { name: string; args: readonly string[] };

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI = join(ROOT, "dist", "main.mjs");
const STEPS: readonly Step[] = [
  { name: "whoami", args: ["whoami"] },
  { name: "history", args: ["history", "--limit", "1"] },
  { name: "history checks", args: ["history", "checks", "--limit", "1"] },
  { name: "history searches", args: ["history", "searches", "--limit", "1"] },
];
// A catalogue code is safe to print; anything else in the document is not looked at.
const CODE = /"code":"([A-Z_]+)"/;

function runStep(step: Step): boolean {
  const started = performance.now();
  const result = spawnSync(process.execPath, [CLI, ...step.args, "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  const ok = result.status === 0 && result.stdout.startsWith('{"ok":true');
  const code = ok ? "" : ` (${CODE.exec(result.stdout)?.[1] ?? "no answer"})`;
  process.stdout.write(
    `${step.name.padEnd(18)}${ok ? "ok" : `failed${code}`}  ${seconds}s\n`
  );
  return ok;
}

function main(): void {
  let failed = 0;
  for (const step of STEPS) if (!runStep(step)) failed++;
  process.exitCode = failed > 0 ? 1 : 0;
}

if (import.meta.main) main();
