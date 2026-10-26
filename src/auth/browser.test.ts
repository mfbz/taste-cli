import { describe, expect, it } from "vitest";

import { browserCommand } from "./browser.ts";

const URL_WITH_QUERY =
  "https://auth.example.com/authorize?client_id=c&state=s&scope=openid+email";

describe("browserCommand", () => {
  it("uses open on macOS with the address as one argument", () => {
    expect(browserCommand(URL_WITH_QUERY, "darwin")).toEqual({
      file: "open",
      args: [URL_WITH_QUERY],
    });
  });

  it("uses xdg-open on Linux and other Unix systems", () => {
    for (const platform of ["linux", "freebsd"] as const)
      expect(browserCommand(URL_WITH_QUERY, platform)).toEqual({
        file: "xdg-open",
        args: [URL_WITH_QUERY],
      });
  });

  it("uses rundll32 on Windows, so cmd never parses the address", () => {
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
