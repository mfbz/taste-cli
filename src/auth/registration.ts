// taste-cli registers itself with the authorization server as a public client (dynamic client
// registration), once for all its loopback ports, and keeps the client id in client.json. The id is
// not a secret; it is reused until the ports or the server change, or the server forgets it. The
// token endpoint is kept beside it, so a refresh needn't read the metadata documents every hour.
import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import { clientFile } from "../config/paths.ts";
import { CliError } from "../output/errors.ts";
import type { OAuthEndpoints } from "./discovery.ts";
import { requestJson } from "./http.ts";
import { LOOPBACK_PORTS, redirectUri } from "./loopback.ts";

type Registration = { clientId: string; ports: number[] };

const CLIENT_NAME = "taste-cli (unofficial)";
const REGISTERED = z.looseObject({ client_id: z.string().min(1) });
const CLIENT_FILE = z.object({
  clientId: z.string().min(1),
  ports: z.array(z.number().int()),
  registrationEndpoint: z.string(),
  tokenEndpoint: z.string(),
});

function samePorts(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((port, i) => port === b[i]);
}

async function registerClient(
  fetch: typeof globalThis.fetch,
  meta: OAuthEndpoints,
  signal?: AbortSignal
): Promise<Registration> {
  const { status, body } = await requestJson(fetch, meta.register, {
    method: "POST",
    json: {
      client_name: CLIENT_NAME,
      redirect_uris: LOOPBACK_PORTS.map(redirectUri),
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    signal,
  });
  const parsed = REGISTERED.safeParse(body);
  if (status < 200 || status > 299 || !parsed.success)
    throw new CliError("LOGIN_FAILED");
  return { clientId: parsed.data.client_id, ports: [...LOOPBACK_PORTS] };
}

async function readClientFile(
  dir: string
): Promise<z.infer<typeof CLIENT_FILE> | null> {
  try {
    const json: unknown = JSON.parse(await readFile(clientFile(dir), "utf8"));
    const parsed = CLIENT_FILE.safeParse(json);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// Anything unreadable, or registered for other ports or another server, means register again.
async function readRegistration(
  dir: string,
  meta: OAuthEndpoints
): Promise<Registration | null> {
  const saved = await readClientFile(dir);
  if (!saved) return null;
  if (saved.registrationEndpoint !== meta.register) return null;
  if (!samePorts(saved.ports, LOOPBACK_PORTS)) return null;
  return { clientId: saved.clientId, ports: saved.ports };
}

// Written beside the old file and renamed over it, like the credentials file, so it is never half
// written. Failing to save only means registering again next time.
async function saveRegistration(
  dir: string,
  meta: OAuthEndpoints,
  registration: Registration
): Promise<void> {
  const temp = join(dir, `.client-${randomUUID()}.tmp`);
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") await chmod(dir, 0o700);
    const content = {
      clientId: registration.clientId,
      ports: registration.ports,
      registrationEndpoint: meta.register,
      tokenEndpoint: meta.token,
    };
    await writeFile(temp, JSON.stringify(content), { mode: 0o600, flag: "wx" });
    await rename(temp, clientFile(dir));
  } catch {
    await rm(temp, { force: true }).catch(() => undefined);
  }
}

// The token endpoint saved with this client's registration, if it is still the one on file. Only an
// https address is trusted, as discovery would require.
async function savedTokenEndpoint(
  dir: string,
  clientId: string
): Promise<string | null> {
  const saved = await readClientFile(dir);
  if (saved?.clientId !== clientId) return null;
  return URL.parse(saved.tokenEndpoint)?.protocol === "https:"
    ? saved.tokenEndpoint
    : null;
}

// After a sign in that never came back, the server may have forgotten this client: it then shows its
// own error page instead of redirecting. Registering again next time is the way out.
async function forgetRegistration(dir: string): Promise<void> {
  await rm(clientFile(dir), { force: true }).catch(() => undefined);
}

export {
  forgetRegistration,
  readRegistration,
  registerClient,
  savedTokenEndpoint,
  saveRegistration,
};
export type { Registration };
