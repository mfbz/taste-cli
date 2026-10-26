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
  it("reads a bare domain as https and keeps an http or https address", () => {
    expect(normalizeUrl(" stripe.com/pricing ").href).toBe(
      "https://stripe.com/pricing"
    );
    expect(normalizeUrl("http://example.org/a?b=1").href).toBe(
      "http://example.org/a?b=1"
    );
  });

  it("accepts public addresses near the private ranges", () => {
    for (const input of [
      ...["8.8.8.8", "172.32.0.1", "100.128.0.1", "192.169.0.1"],
      ...["https://[2606:4700::1111]/", "https://[::ffff:808:808]/"],
      ...["localhost.com", "notlocal.dev"],
    ])
      expect(codeOf(input), input).toBe("ok");
  });

  it("refuses this computer and private networks with PRIVATE_URL", () => {
    for (const input of [
      ...[
        "localhost:3000",
        "LOCALHOST.",
        "app.localhost",
        "http://localhost../",
      ],
      ...["printer.local", "db.internal", "file:///etc/passwd"],
      ...[
        "127.0.0.1",
        "http://127.1/",
        "http://2130706433/",
        "http://0x7f.0.0.1/",
      ],
      ...[
        "0.0.0.0",
        "10.0.0.1",
        "172.16.0.1",
        "192.168.1.1",
        "169.254.169.254",
      ],
      ...[
        "100.64.0.1",
        "http://[::1]/",
        "http://[fd12::1]/",
        "http://[fe80::1]/",
      ],
      ...[
        "http://[::ffff:127.0.0.1]/",
        "http://[::a00:1]/",
        "http://[64:ff9b::7f00:1]/",
      ],
    ])
      expect(codeOf(input), input).toBe("PRIVATE_URL");
  });

  it("refuses other schemes, junk and credentials with INVALID_URL", () => {
    for (const input of [
      ...[
        "ftp://x",
        "javascript:alert(1)",
        "",
        "https://",
        "http://exa mple.com",
      ],
      "https://user:pass@stripe.com/",
    ])
      expect(codeOf(input), input).toBe("INVALID_URL");
  });
});
