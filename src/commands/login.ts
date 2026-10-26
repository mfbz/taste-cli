// taste login: a browser sign in by default, or an API key typed at a hidden prompt (--api-key) or
// piped in (--with-api-key). A key is checked with Taste before it is saved, and never comes from
// argv. Nothing here prints a key or a token.
import type { Identity } from "../auth/provider.ts";
import type { Context } from "../context.ts";
import { ENV_KEY_NOTE } from "../context.ts";
import { CliError, isUpstreamError } from "../output/errors.ts";
import { plain } from "../output/output.ts";
import type { Theme } from "../output/theme.ts";

type LoginOptions = { apiKey?: boolean; withApiKey?: boolean };
type LoginResult = Omit<Identity, "method"> & { method: "key" | "session" };

// One word of printable ASCII: what a key looks like, and all an HTTP header can carry.
const KEY_TEXT = /^[\x21-\x7e]{1,1024}$/;

function parseKey(text: string): string {
  const key = text.trim();
  if (!KEY_TEXT.test(key)) throw new CliError("INVALID_KEY_INPUT");
  return key;
}

async function promptKey(ctx: Context): Promise<string> {
  if (ctx.output.json || !ctx.interactive)
    throw new CliError("LOGIN_NOT_INTERACTIVE");
  const answer = await ctx.askSecret("Your Taste API key");
  if (answer === null) throw new CliError("LOGIN_CANCELLED");
  return parseKey(answer);
}

async function saveKey(ctx: Context, apiKey: string): Promise<LoginResult> {
  // Checked on its own, so a wrong key reads as INVALID_API_KEY and replaces nothing.
  const me = await ctx
    .api({
      header: () => Promise.resolve({ "x-api-key": apiKey }),
      onUnauthorized: () => Promise.resolve(false),
    })
    .me();
  const store = await ctx.store();
  await store.write({ kind: "key", apiKey });
  return { method: "key", email: me.email ?? null, store: store.name };
}

async function browserLogin(ctx: Context): Promise<LoginResult> {
  if (ctx.output.json || !ctx.interactive)
    throw new CliError("LOGIN_NOT_INTERACTIVE");
  let session;
  try {
    session = await ctx.loginWithBrowser();
  } catch (error) {
    // Taste refused the token it had just issued: a failed sign in, not a wrong key.
    if (isUpstreamError(error) && error.status === 401)
      throw new CliError("LOGIN_FAILED", {}, { cause: error });
    throw error;
  }
  const store = await ctx.store();
  return { method: "session", email: session.email, store: store.name };
}

function renderLogin(result: LoginResult, theme: Theme): string {
  const who = result.email ? ` as ${theme.bold(plain(result.email))}` : "";
  const how = result.method === "key" ? " with an API key" : "";
  return `${theme.success("✓")} Signed in${who}${how}.`;
}

async function login(ctx: Context, options: LoginOptions): Promise<void> {
  if (ctx.env.apiKey) ctx.output.note(ENV_KEY_NOTE);
  let result: LoginResult;
  if (options.withApiKey)
    result = await saveKey(ctx, parseKey(await ctx.stdinText()));
  else if (options.apiKey) result = await saveKey(ctx, await promptKey(ctx));
  else result = await browserLogin(ctx);
  ctx.output.result(result, (theme) => renderLogin(result, theme));
}

export { login, renderLogin };
export type { LoginOptions, LoginResult };
