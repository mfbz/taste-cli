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

function ipv4(a: number, b: number, c: number, d: number): number {
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

function isPrivateV4(address: number): boolean {
  return PRIVATE_V4.some(([base, prefix]) => {
    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
    return (address & mask) >>> 0 === base;
  });
}

// Eight 16-bit groups from the short form the URL parser writes (it has already turned any dotted
// IPv4 tail into hex), or undefined if the text is not that shape.
function hextets(host: string): number[] | undefined {
  const halves = host.split("::");
  if (halves.length > 2) return undefined;
  const split = (part: string | undefined) => (part ? part.split(":") : []);
  const head = split(halves[0]);
  const tail = split(halves[1]);
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return undefined;
  const groups = [...head, ...Array<string>(fill).fill("0"), ...tail];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g)))
    return undefined;
  return groups.map((g) => parseInt(g, 16));
}

const zeros = (groups: number[]) => groups.every((g) => g === 0);

function isPrivateV6(host: string): boolean {
  const g = hextets(host);
  if (!g) return true;
  const embedded = (((g[6] ?? 0) << 16) | (g[7] ?? 0)) >>> 0;
  const prefix = g.slice(0, 6);
  // IPv4 carried inside IPv6: compatible ::/96 (which also covers :: and ::1), mapped
  // ::ffff:0:0/96, translated ::ffff:0:0:0/96 and NAT64 64:ff9b::/96. Each is judged as that IPv4.
  const carriesV4 =
    zeros(prefix) ||
    (zeros(g.slice(0, 5)) && g[5] === 0xffff) ||
    (zeros(g.slice(0, 4)) && g[4] === 0xffff && g[5] === 0) ||
    (g[0] === 0x64 && g[1] === 0xff9b && zeros(g.slice(2, 6)));
  if (carriesV4) return isPrivateV4(embedded);
  const first = g[0] ?? 0;
  // Unique local fc00::/7 and link-local fe80::/10.
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
}

// Takes a hostname as the URL parser writes it (URL.hostname), so IPv4 shorthand such as 127.1 or
// 0x7f.0.0.1 has already become dotted decimal and IPv6 is bracketed.
function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.+$/, "");
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

export { isPrivateHost, normalizeUrl };
