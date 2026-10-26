// taste-cli registers itself with the authorization server as a public client (dynamic client
// registration), once for all its loopback ports, and keeps the client id in client.json. The id is
// not a secret; it is reused until the ports or the server change, or the server forgets it.
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

// Anything unreadable, or registered for other ports or another server, means register again.
async function readRegistration(
  dir: string,
  meta: OAuthEndpoints
): Promise<Registration | null> {
  let json: unknown;
  try {
    json = JSON.parse(await readFile(clientFile(dir), "utf8"));
  } catch {
    return null;
  }
  const parsed = CLIENT_FILE.safeParse(json);
  if (!parsed.success) return null;
  const saved = parsed.data;
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
    };
    await writeFile(temp, JSON.stringify(content), { mode: 0o600, flag: "wx" });
    await rename(temp, clientFile(dir));
  } catch {
    await rm(temp, { force: true }).catch(() => undefined);
  }
}

export { readRegistration, registerClient, saveRegistration };
export type { Registration };
