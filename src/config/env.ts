import { z } from "zod";

import { CliError } from "../output/errors.ts";

type Env = { apiKey?: string; apiUrl?: string; noMotion?: boolean };
type Source = Readonly<Record<string, string | undefined>>;

const DEFAULT_API_URL = "https://api.tastelabs.com";
// Plain http only reaches this computer, for the local mock: a key never crosses a network unencrypted.
const LOOPBACK = new Set(["127.0.0.1", "[::1]", "localhost"]);
const API_URL = z.string().refine((text) => {
  const url = URL.parse(text);
  // Credentials in the URL would ride along on every request and into any error a proxy echoes.
  if (!url || url.username || url.password) return false;
  return (
    url.protocol === "https:" ||
    (url.protocol === "http:" && LOOPBACK.has(url.hostname))
  );
});

function invalid(name: string): never {
  throw new CliError("INVALID_ENV", { name });
}

// Settings come from the environment and nowhere else: taste never reads a .env, so a cloned repo or a
// download can't choose the endpoint a key is sent to. Values are never echoed in errors.
function readEnv(source: Source): Env {
  const env: Env = {};
  const apiKey = source.TASTE_API_KEY?.trim();
  if (apiKey) env.apiKey = apiKey;
  const apiUrl = source.TASTE_API_URL?.trim();
  if (apiUrl) {
    if (!API_URL.safeParse(apiUrl).success) invalid("TASTE_API_URL");
    env.apiUrl = apiUrl;
  }
  const noMotion = source.TASTE_NO_MOTION?.trim().toLowerCase();
  if (noMotion) env.noMotion = noMotion !== "0" && noMotion !== "false";
  return env;
}

export { DEFAULT_API_URL, readEnv };
export type { Env };
