// The pages the loopback server shows at the end of a browser sign in. Self-contained: inline styles
// and the inline wordmark, nothing fetched, so the page works offline and the strict CSP holds.
import { PALETTE } from "../output/theme.ts";
import { WORDMARK } from "./wordmark.ts";

const PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  // One callback per sign in: no reason to keep the browser's connection open.
  connection: "close",
} as const;
const SIGNED_IN =
  "You're signed in. You can close this tab and go back to the terminal.";
const GO_BACK = "Go back to the terminal to try again.";
const STYLE = `
  html, body { margin: 0; height: 100%; }
  body {
    display: flex; align-items: center; justify-content: center;
    background: ${PALETTE.field}; color: ${PALETTE.paper};
    font: 16px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  main { max-width: 28rem; padding: 2rem; }
  svg { display: block; width: 8.5rem; height: auto; margin-bottom: 2.5rem; }
  p { margin: 0 0 0.75rem; }
`;

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function page(title: string, lines: string[]): string {
  const body = lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<div role="img" aria-label="Taste">${WORDMARK.trim()}</div>
${body}
</main>
</body>
</html>
`;
}

function successPage(): string {
  return page("Signed in to taste", [SIGNED_IN]);
}

// message is one of ours (a catalogue message), escaped anyway: nothing from the request is shown.
function failurePage(message: string): string {
  return page("taste sign in", [message, GO_BACK]);
}

export { failurePage, PAGE_HEADERS, successPage };
