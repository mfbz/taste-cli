// taste logout: forget the saved sign in, wherever it is kept. Signing out twice is not an error.
import type { Context } from "../context.ts";
import { ENV_KEY_NOTE } from "../context.ts";
import type { Theme } from "../output/theme.ts";

function renderLogout(theme: Theme): string {
  return `${theme.success("✓")} Signed out.`;
}

async function logout(ctx: Context): Promise<void> {
  const store = await ctx.store();
  await store.clear();
  if (ctx.env.apiKey) ctx.output.note(ENV_KEY_NOTE);
  ctx.output.result({ signedOut: true }, renderLogout);
}

export { logout, renderLogout };
