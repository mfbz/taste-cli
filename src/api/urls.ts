// What a person types as a site becomes a URL Taste can read, or a catalogue error before any credit
// is spent. Private targets are refused by name and address only (no DNS lookup): Taste fetches from
// its own servers, so this guards against a mistake, not an attacker.
import { CliError } from "../output/errors.ts";

type Range = readonly [base: number, prefix: number];

// Loopback, "this network", RFC 1918, link-local and carrier-grade NAT.
const PRIVATE_V4: readonly Range[] = [
  [ipv4(0, 0, 0, 0), 8],
  [ipv4(10, 0, 0, 0), 8],
  [ipv4(127, 0, 0, 0), 8],
  [ipv4(169, 254, 0, 0), 16],
  [ipv4(172, 16, 0, 0), 12],
  [ipv4(192, 168, 0, 0), 16],
  [ipv4(100, 64, 0, 0), 10],
];
const PRIVATE_SUFFIXES = [".localhost", ".local", ".internal"];
const SCHEME_WITH_SLASHES = /^[a-z][a-z0-9+.-]*:\/\//i;
// "mailto:x" or "file:" is a scheme; "stripe.com:8443" is a host and a port.
const SCHEME_ONLY = /^[a-z][a-z0-9+.-]*:(?!\d)/i;
const V4_HOST = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const MAPPED_V4 = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/;

function ipv4(a: number, b: number, c: number, d: number): number {
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

function isPrivateV4(address: number): boolean {
  return PRIVATE_V4.some(([base, prefix]) => {
    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
    return (address & mask) >>> 0 === base;
  });
}

// The URL parser has already turned every IPv6 host into its short lowercase form, so the first
// group and the mapped-IPv4 tail can be read off the text.
function isPrivateV6(host: string): boolean {
  if (host === "::1" || host === "::") return true;
  const mapped = MAPPED_V4.exec(host);
  if (mapped)
    return isPrivateV4(
      ((parseInt(mapped[1] ?? "0", 16) << 16) |
        parseInt(mapped[2] ?? "0", 16)) >>>
        0
    );
  const first = parseInt(host.split(":")[0] || "0", 16);
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host.startsWith("[")) return isPrivateV6(host.slice(1, -1));
  if (host === "localhost") return true;
  if (PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  const v4 = V4_HOST.exec(host);
  if (!v4) return false;
  const [a, b, c, d] = v4.slice(1).map(Number);
  return isPrivateV4(ipv4(a ?? 0, b ?? 0, c ?? 0, d ?? 0));
}

function normalizeUrl(input: string): URL {
  const text = input.trim();
  const hasScheme = SCHEME_WITH_SLASHES.test(text) || SCHEME_ONLY.test(text);
  const candidate = hasScheme ? text : `https://${text}`;
  if (text === "" || !URL.canParse(candidate))
    throw new CliError("INVALID_URL");
  const url = new URL(candidate);
  // A file: address always means this computer.
  if (url.protocol === "file:") throw new CliError("PRIVATE_URL");
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new CliError("INVALID_URL");
  // Credentials in a URL would be handed to Taste along with it.
  if (url.hostname === "" || url.username !== "" || url.password !== "")
    throw new CliError("INVALID_URL");
  if (isPrivateHost(url.hostname)) throw new CliError("PRIVATE_URL");
  return url;
}

export { normalizeUrl };
