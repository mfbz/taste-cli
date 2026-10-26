import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { clientFile, configDir, credentialsFile } from "./paths.ts";

const HOME = join("/", "home", "someone");

describe("configDir", () => {
  it("uses XDG_CONFIG_HOME when it is set", () => {
    expect(configDir({ XDG_CONFIG_HOME: "/xdg" }, HOME, "linux")).toBe(
      join("/xdg", "taste-cli")
    );
  });

  it("falls back to ~/.config on Linux and macOS", () => {
    expect(configDir({}, HOME, "darwin")).toBe(
      join(HOME, ".config", "taste-cli")
    );
    expect(configDir({ XDG_CONFIG_HOME: "" }, HOME, "linux")).toBe(
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

  it("ignores a relative XDG_CONFIG_HOME, as the XDG spec asks", () => {
    expect(configDir({ XDG_CONFIG_HOME: "rel" }, HOME, "linux")).toBe(
      join(HOME, ".config", "taste-cli")
    );
  });
});

describe("the files in it", () => {
  it("keeps credentials and the client registration apart", () => {
    expect(credentialsFile("/d")).toBe(join("/d", "credentials.json"));
    expect(clientFile("/d")).toBe(join("/d", "client.json"));
  });
});
