import { describe, expect, it } from "vitest";

import { CliError } from "../output/errors.ts";
import { normalizeUrl } from "./urls.ts";

function codeOf(input: string): string {
  try {
    normalizeUrl(input);
  } catch (error) {
    if (error instanceof CliError) return error.code;
    throw error;
  }
  return "ok";
}

describe("normalizeUrl", () => {
  it("reads a bare domain as https", () => {
    expect(normalizeUrl("stripe.com").href).toBe("https://stripe.com/");
    expect(normalizeUrl("  stripe.com/pricing ").href).toBe(
      "https://stripe.com/pricing"
    );
    expect(normalizeUrl("stripe.com:8443").href).toBe(
      "https://stripe.com:8443/"
    );
  });

  it("keeps an http or https address as given", () => {
    expect(normalizeUrl("https://stripe.com").href).toBe("https://stripe.com/");
    expect(normalizeUrl("http://example.org/a?b=1").href).toBe(
      "http://example.org/a?b=1"
    );
    expect(normalizeUrl("HTTPS://Stripe.COM").href).toBe("https://stripe.com/");
  });

  it("accepts public addresses near the private ranges", () => {
    for (const input of [
      "8.8.8.8",
      "172.15.0.1",
      "172.32.0.1",
      "100.63.0.1",
      "100.128.0.1",
      "192.169.0.1",
      "https://[2606:4700::1111]/",
      "localhost.com",
      "notlocal.dev",
    ])
      expect(codeOf(input), input).toBe("ok");
  });

  it("refuses this computer and private networks with PRIVATE_URL", () => {
    for (const input of [
      "localhost",
      "localhost:3000",
      "http://localhost/",
      "LOCALHOST.",
      "app.localhost",
      "printer.local",
      "db.internal",
      "127.0.0.1",
      "http://127.1/",
      "http://2130706433/",
      "http://0x7f.0.0.1/",
      "0.0.0.0",
      "10.0.0.1",
      "10.255.255.255",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "100.127.255.255",
      "http://[::1]/",
      "http://[::]/",
      "http://[fc00::1]/",
      "http://[fd12:3456::1]/",
      "http://[fe80::1]/",
      "http://[febf::1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://[::ffff:192.168.0.1]/",
      "file:///etc/passwd",
      "file:",
    ])
      expect(codeOf(input), input).toBe("PRIVATE_URL");
  });

  it("refuses other schemes and junk with INVALID_URL", () => {
    for (const input of [
      "ftp://x",
      "mailto:a@b.c",
      "javascript:alert(1)",
      "data:text/html,hi",
      "",
      "   ",
      "https://",
      "http://exa mple.com",
      "https://user:pass@stripe.com/",
    ])
      expect(codeOf(input), input).toBe("INVALID_URL");
  });
});
