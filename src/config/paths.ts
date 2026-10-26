import { isAbsolute, join } from "node:path";

type Source = Readonly<Record<string, string | undefined>>;

const APP = "taste-cli";

function configDir(
  env: Source,
  home: string,
  platform: NodeJS.Platform
): string {
  if (platform === "win32")
    return join(env.APPDATA || join(home, "AppData", "Roaming"), APP);
  // The XDG spec says a relative value is invalid and must be ignored.
  const xdg = env.XDG_CONFIG_HOME;
  return join(xdg && isAbsolute(xdg) ? xdg : join(home, ".config"), APP);
}

function credentialsFile(dir: string): string {
  return join(dir, "credentials.json");
}

// The OAuth client registration: a public client id and its redirect ports, not a secret.
function clientFile(dir: string): string {
  return join(dir, "client.json");
}

export { clientFile, configDir, credentialsFile };
