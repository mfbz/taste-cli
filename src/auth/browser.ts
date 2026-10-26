// Opens the sign in address in the default browser. The address is always printed first, so a failure
// here (no browser, a headless machine) is not an error: the person can open it by hand.
import { spawn } from "node:child_process";

type Command = { file: string; args: string[] };

// The address is one argument, never a shell string. Only https is opened, which also keeps an
// address from being read as an option by open or xdg-open.
function browserCommand(
  url: string,
  platform: NodeJS.Platform
): Command | null {
  if (!url.startsWith("https://")) return null;
  if (platform === "darwin") return { file: "open", args: [url] };
  // Not cmd /c start: cmd parses & and %VAR% inside the address. rundll32 hands it over untouched.
  if (platform === "win32")
    return {
      file: "rundll32",
      args: ["url.dll,FileProtocolHandler", url],
    };
  return { file: "xdg-open", args: [url] };
}

function openBrowser(
  url: string,
  platform: NodeJS.Platform = process.platform
): Promise<void> {
  const command = browserCommand(url, platform);
  if (!command) return Promise.resolve();
  return new Promise((resolve) => {
    // No shell, and no pipes left open to keep taste running after the sign in.
    const child = spawn(command.file, command.args, {
      stdio: "ignore",
      windowsHide: true,
    });
    // Settled on start, not exit: some openers stay alive as long as the browser does.
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
    child.once("error", () => resolve());
  });
}

export { browserCommand, openBrowser };
