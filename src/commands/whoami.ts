// taste whoami: which credential taste would send, and whose account it is. One free request to
// /design/me confirms it still works (a session is refreshed first if it must be).
import type { Identity } from "../auth/provider.ts";
import type { Context } from "../context.ts";
import { ENV_KEY_NOTE } from "../context.ts";
import { CliError } from "../output/errors.ts";
import { plain } from "../output/output.ts";
import type { Theme } from "../output/theme.ts";

const HOW: Readonly<Record<Exclude<Identity["method"], "env-key">, string>> = {
  session: "browser session",
  key: "API key",
};

function renderWhoami(identity: Identity, theme: Theme): string {
  const email = identity.email ? theme.bold(plain(identity.email)) : null;
  if (identity.method === "env-key")
    return `Using an API key from TASTE_API_KEY${email ? ` (${email})` : ""}.`;
  return `Signed in${email ? ` as ${email}` : ""} (${HOW[identity.method]}).`;
}

async function whoami(ctx: Context): Promise<void> {
  if (ctx.env.apiKey) ctx.output.note(ENV_KEY_NOTE);
  const identity = await ctx.auth.describe();
  if (!identity) throw new CliError("NOT_SIGNED_IN");
  const me = await ctx.api().me();
  const result: Identity = { ...identity, email: me.email ?? identity.email };
  ctx.output.result(result, (theme) => renderWhoami(result, theme));
}

export { renderWhoami, whoami };
