import { describe, expect, it } from "vitest";

import { failurePage, successPage } from "./success-page.ts";

// Anything that would make the browser fetch something: the page must work offline and leak nothing.
const EXTERNAL = /\b(?:src|href|action)\s*=|url\(|@import|<script|<link/i;

describe("successPage", () => {
  it("says the sign in is done, in plain copy, with no external request", () => {
    const page = successPage();
    expect(page).toContain(
      "You&#39;re signed in. You can close this tab and go back to the terminal."
    );
    expect(page).not.toMatch(EXTERNAL);
    expect(page).not.toMatch(/https?:\/\/(?!www\.w3\.org\/2000\/svg)/);
    expect(page.replace(/<[^>]*>/g, "")).not.toMatch(/[—!]/);
  });
});

describe("failurePage", () => {
  it("escapes the message it is given", () => {
    const page = failurePage(`<script>alert("x")</script> & 'y'`);
    expect(page).not.toMatch(EXTERNAL);
    expect(page).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  });
});
