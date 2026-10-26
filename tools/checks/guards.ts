// The guards every change must pass, whoever writes it (people or coding agents): no secrets, no
// personal paths, no AI tool credited as an author, no oversized files. The patterns are written so
// they never match their own source.

type Finding = { rule: string; match: string };

const SECRETS: ReadonlyArray<[string, RegExp]> = [
  ["private key block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["Taste API key", /\btaste_[A-Za-z0-9_-]{16,}/],
  // A signed-in session's access token (or an id token): three base64url parts, header and payload JSON.
  ["JSON Web Token", /\beyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,}/],
  ["OpenAI or Anthropic key", /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}/],
  [
    "GitHub token",
    /\bgh[pousr]_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{40,}/,
  ],
  ["AWS access key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["npm token", /\bnpm_[A-Za-z0-9]{36}\b/],
  ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
];
// A co-author trailer naming an AI tool or a bot; people crediting each other is fine.
const ATTRIBUTION =
  /Co-Authored-By[:][^\n]*(?:claude|anthropic|openai|chatgpt|\bgpt|copilot|codex|cursor|gemini|devin|aider|windsurf|\[bot\])|noreply@anthropic\.com|Generated with \[?Claude/i;

/** 1 MB: a bigger file is almost always a build output or a recording that belongs elsewhere. */
const MAX_FILE_BYTES = 1024 * 1024;
// Files over the limit kept on purpose, by repo path. None yet.
const BIG_ON_PURPOSE = new Set<string>();

function findSecrets(text: string): Finding[] {
  return SECRETS.flatMap(([rule, pattern]) => {
    const found = pattern.exec(text);
    // Only the start of a match: a report must not repeat the secret.
    return found ? [{ rule, match: `${found[0].slice(0, 8)}…` }] : [];
  });
}

function findAttribution(text: string): Finding[] {
  const found = ATTRIBUTION.exec(text);
  return found
    ? [{ rule: "AI tool credited as an author", match: found[0] }]
    : [];
}

function findHomePath(text: string, home: string): Finding[] {
  return home.length > 1 && text.includes(home)
    ? [{ rule: "this computer's home folder", match: home }]
    : [];
}

function isBinary(bytes: Buffer): boolean {
  return bytes.subarray(0, 8000).includes(0);
}

/** Every guard on one file about to be committed: what's wrong with it, for people to read. */
function checkFile(path: string, bytes: Buffer, home: string): string[] {
  const problems: string[] = [];
  if (bytes.length > MAX_FILE_BYTES && !BIG_ON_PURPOSE.has(path))
    problems.push(`${path}: over ${MAX_FILE_BYTES / 1024 / 1024} MB`);
  if (isBinary(bytes)) return problems;
  const text = bytes.toString("utf8");
  for (const f of [
    ...findSecrets(text),
    ...findHomePath(text, home),
    ...findAttribution(text),
  ])
    problems.push(`${path}: ${f.rule} (${f.match})`);
  return problems;
}

/** A commit message: no AI tool as an author, and no secret pasted into it. */
function checkMessage(text: string): string[] {
  return [...findAttribution(text), ...findSecrets(text)].map(
    (f) => `commit message: ${f.rule} (${f.match})`
  );
}

export {
  BIG_ON_PURPOSE,
  MAX_FILE_BYTES,
  checkFile,
  checkMessage,
  findAttribution,
  findHomePath,
  findSecrets,
  isBinary,
};
export type { Finding };
