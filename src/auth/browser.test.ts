import { describe, expect, it } from "vitest";

import { browserCommand } from "./browser.ts";

const URL_WITH_QUERY =
  "https://auth.example.com/authorize?client_id=c&state=s&scope=openid+email";

describe("browserCommand", () => {
  it("passes the address as one argument, never through a shell", () => {
    expect(browserCommand(URL_WITH_QUERY, "darwin")).toEqual({
      file: "open",
      args: [URL_WITH_QUERY],
    });
    expect(browserCommand(URL_WITH_QUERY, "linux")?.file).toBe("xdg-open");
    expect(browserCommand(URL_WITH_QUERY, "win32")).toEqual({
      file: "rundll32",
      args: ["url.dll,FileProtocolHandler", URL_WITH_QUERY],
    });
  });

  it("opens nothing but https addresses", () => {
    expect(browserCommand("file:///etc/passwd", "darwin")).toBeNull();
    expect(browserCommand("--args", "linux")).toBeNull();
  });
});
