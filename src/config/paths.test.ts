import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { configDir } from "./paths.ts";

const HOME = join("/", "home", "someone");

describe("configDir", () => {
  it("uses an absolute XDG_CONFIG_HOME, else ~/.config", () => {
    expect(configDir({ XDG_CONFIG_HOME: "/xdg" }, HOME, "linux")).toBe(
      join("/xdg", "taste-cli")
    );
    for (const xdg of ["", "relative"])
      expect(configDir({ XDG_CONFIG_HOME: xdg }, HOME, "darwin")).toBe(
        join(HOME, ".config", "taste-cli")
      );
  });

  it("uses APPDATA on Windows", () => {
    expect(configDir({ APPDATA: "C:/Roaming" }, HOME, "win32")).toBe(
      join("C:/Roaming", "taste-cli")
    );
    expect(configDir({}, HOME, "win32")).toBe(
      join(HOME, "AppData", "Roaming", "taste-cli")
    );
  });
});
