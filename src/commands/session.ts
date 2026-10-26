// Bare `taste` in a terminal: the opening, who taste is signed in as, then a menu that asks for each
// command's inputs and runs the same command function the direct command does. Anything that spends
// credits says so in the menu and is confirmed first. Ctrl-C at a prompt goes back to the menu; at the
// menu it quits. Ctrl-C while a command runs ends the session the way it ends that command.
import type { Identity } from "../auth/provider.ts";
import { normalizeUrl } from "../api/urls.ts";
import type { Context } from "../context.ts";
import type { Choice, Prompter } from "../io.ts";
import { toErrorReport } from "../output/errors.ts";
import { plain } from "../output/output.ts";
import { playOpening } from "../ui/opening.ts";
import { check } from "./check.ts";
import { enhance } from "./enhance.ts";
import { extract } from "./extract.ts";
import { history, HISTORY_LISTS } from "./history.ts";
import { DEFAULT_TIMEOUT_S } from "./job.ts";
import { kit } from "./kit.ts";
import { login } from "./login.ts";
import { logout } from "./logout.ts";
import { search } from "./search.ts";

type ActionName =
  | "extract"
  | "check"
  | "search"
  | "kit"
  | "enhance"
  | "history"
  | "login"
  | "logout";
type Action = {
  label: string;
  paid: boolean;
  run(ctx: Context, ask: Prompter): Promise<void>;
};

const JOB = {
  format: "summary",
  wait: true,
  timeout: DEFAULT_TIMEOUT_S,
} as const;
const ACTIONS: Readonly<Record<ActionName, Action>> = {
  extract: {
    label: "Extract a brand",
    paid: true,
    async run(ctx, ask) {
      const url = await askUrl(ask, "Which site?");
      if (url === null || !(await spends(ask, `Extract ${host(url)}`))) return;
      await extract(ctx, url, JOB);
    },
  },
  check: {
    label: "Check brand adherence",
    paid: true,
    async run(ctx, ask) {
      const candidate = await askUrl(ask, "Which site should be checked?");
      if (candidate === null) return;
      const against = await askUrl(ask, "Whose brand should it follow?");
      if (against === null) return;
      if (!(await spends(ask, `Check ${host(candidate)}`))) return;
      await check(ctx, candidate, {
        against,
        wait: true,
        timeout: DEFAULT_TIMEOUT_S,
      });
    },
  },
  search: {
    label: "Search brands",
    paid: true,
    async run(ctx, ask) {
      const query = await ask.text("Describe the look", filled);
      if (query === null || !(await spends(ask, "Search"))) return;
      await search(ctx, query, {});
    },
  },
  kit: {
    label: "Brand kit from a PDF",
    paid: true,
    async run(ctx, ask) {
      const file = await ask.text("Path to the guidelines PDF", filled);
      if (file === null || !(await spends(ask, "Extract a brand kit"))) return;
      await kit(ctx, file.trim(), JOB);
    },
  },
  enhance: {
    label: "Enhance a prompt",
    paid: true,
    async run(ctx, ask) {
      const prompt = await ask.text("The prompt", filled);
      if (prompt === null) return;
      const brand = await ask.text(
        "Which brand? An extraction's id or a site you extracted",
        filled
      );
      if (brand === null || !(await spends(ask, "Enhance it"))) return;
      await enhance(ctx, prompt, { brand: brand.trim() });
    },
  },
  history: {
    label: "History",
    paid: false,
    async run(ctx, ask) {
      const list = await ask.select(
        "Which list?",
        HISTORY_LISTS.map((value) => ({ value, label: value }))
      );
      if (list === null) return;
      await history(ctx, list, { limit: 20, offset: 0 });
    },
  },
  login: {
    label: "Sign in",
    paid: false,
    run: (ctx) => login(ctx, {}),
  },
  logout: {
    label: "Sign out",
    paid: false,
    run: (ctx) => logout(ctx),
  },
};
const MENU: readonly ActionName[] = [
  "extract",
  "check",
  "search",
  "kit",
  "enhance",
  "history",
];

// The reason an address won't do, in the catalogue's words, shown under the field as it is typed.
function urlProblem(value: string): string | undefined {
  try {
    normalizeUrl(value);
    return undefined;
  } catch (error) {
    return toErrorReport(error).message;
  }
}

function filled(value: string): string | undefined {
  return value.trim() ? undefined : "Type something first.";
}

function host(url: string): string {
  return normalizeUrl(url).host;
}

function askUrl(ask: Prompter, message: string): Promise<string | null> {
  return ask.text(message, urlProblem);
}

async function spends(ask: Prompter, what: string): Promise<boolean> {
  return (await ask.confirm(`${what}? It uses credits.`)) === true;
}

async function identity(ctx: Context): Promise<Identity | null> {
  try {
    return await ctx.auth.describe();
  } catch {
    return null;
  }
}

function status(who: Identity | null): string {
  if (who === null) return "Not signed in.";
  if (who.method === "env-key") return "Using an API key from TASTE_API_KEY.";
  if (who.method === "key") return "Signed in with an API key.";
  return who.email ? `Signed in as ${plain(who.email)}.` : "Signed in.";
}

function menu(signedIn: boolean): Choice<ActionName | "quit">[] {
  const items = [...MENU, signedIn ? "logout" : "login"] as const;
  return [
    ...items.map((value) => {
      const { label, paid } = ACTIONS[value];
      return { value, label: paid ? `${label} (uses credits)` : label };
    }),
    { value: "quit", label: "Quit" },
  ];
}

// newContext gives each action a fresh context, as each direct command gets, so a sign in made from
// the menu is what the next action uses.
async function session(newContext: () => Context): Promise<number> {
  const first = newContext();
  const { output } = first;
  const ask = first.prompter();
  await playOpening(first, { signal: first.signal });
  let who = await identity(first);
  output.note(output.theme.dim(status(who)));
  for (;;) {
    const choice = await ask.select("What would you like to do?", menu(!!who));
    if (choice === null || choice === "quit") return 0;
    const ctx = newContext();
    try {
      await ACTIONS[choice].run(ctx, ask);
    } catch (error) {
      const code = output.fail(ctx.auth.explain(error));
      // The interrupt is spent for the process: the job's id or what to check is in the message.
      if (ctx.signal.aborted) return code;
    }
    who = await identity(ctx);
  }
}

export { session };
