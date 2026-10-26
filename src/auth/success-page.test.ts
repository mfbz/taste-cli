import { describe, expect, it } from "vitest";

import { PALETTE } from "../output/theme.ts";
import { failurePage, PAGE_HEADERS, successPage } from "./success-page.ts";
import { WORDMARK } from "./wordmark.ts";

// Anything that would make the browser fetch something: the page must work offline and leak nothing.
const EXTERNAL = /\b(?:src|href|action)\s*=|url\(|@import|<script|<link/i;

describe("successPage", () => {
  const page = successPage();

  it("says the sign in is done and where to go next", () => {
    expect(page).toContain(
      "You&#39;re signed in. You can close this tab and go back to the terminal."
    );
  });

  it("is styled with the field and paper colours and carries the wordmark inline", () => {
    expect(page).toContain(PALETTE.field);
    expect(page).toContain(PALETTE.paper);
    expect(page).toContain(WORDMARK.trim());
  });

  it("makes no external request", () => {
    expect(page).not.toMatch(EXTERNAL);
    expect(page).not.toMatch(/https?:\/\/(?!www\.w3\.org\/2000\/svg)/);
  });

  it("has no em dash or exclamation mark in its copy", () => {
    const text = page.replace(/<[^>]*>/g, "");
    expect(text).not.toMatch(/[—!]/);
  });
});

describe("failurePage", () => {
  it("escapes the message it is given", () => {
    const page = failurePage(`<script>alert("x")</script> & 'y'`);
    expect(page).not.toContain("<script>");
    expect(page).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(page).toContain("&amp; &#39;y&#39;");
  });

  it("makes no external request either", () => {
    expect(failurePage("The sign in was cancelled.")).not.toMatch(EXTERNAL);
  });
});

describe("PAGE_HEADERS", () => {
  it("sends a strict content security policy", () => {
    expect(PAGE_HEADERS["content-security-policy"]).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; img-src data:"
    );
    expect(PAGE_HEADERS["content-type"]).toBe("text/html; charset=utf-8");
  });
});
