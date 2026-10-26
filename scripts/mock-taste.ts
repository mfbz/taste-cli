// npm run mock [-- --port 4010 --fast --credits 1000]: a local Taste Engine on 127.0.0.1 for demos and
// manual checks, answering from src/api/fixtures/ (synthetic data where none is recorded). Point taste
// at it with TASTE_API_URL=http://127.0.0.1:4010 and TASTE_API_KEY=taste_mock (any key starting with
// taste_mock is accepted). Never spends a credit.
import { parseArgs } from "node:util";

import { loadFixtures } from "../src/api/fixtures.ts";
import { createLibrary } from "./mock-data.ts";
import { KEY_PREFIX, startMock } from "./mock-server.ts";

const DEFAULT_PORT = 4010;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      port: { type: "string", default: String(DEFAULT_PORT) },
      fast: { type: "boolean", default: false },
      credits: { type: "string" },
    },
  });
  const port = Number(values.port);
  const credits =
    values.credits === undefined ? undefined : Number(values.credits);
  if (!Number.isInteger(port) || port < 0 || port > 65_535)
    throw new Error("--port takes a number from 0 to 65535.");
  if (credits !== undefined && !(Number.isInteger(credits) && credits >= 0))
    throw new Error("--credits takes a whole number.");
  const fixtures = loadFixtures();
  const recorded = Object.keys(fixtures);
  const mock = await startMock({
    library: createLibrary(fixtures),
    fast: values.fast,
    credits,
    port,
  });
  process.stderr.write(
    [
      `Mock Taste Engine on ${mock.url}`,
      `Fixtures: ${recorded.length ? recorded.join(", ") : "none recorded, synthetic data"}`,
      `Use: TASTE_API_URL=${mock.url} TASTE_API_KEY=${KEY_PREFIX} taste whoami`,
      "Ctrl-C stops it.",
      "",
    ].join("\n")
  );
  process.once("SIGINT", () => void mock.close());
}

if (import.meta.main)
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  });
