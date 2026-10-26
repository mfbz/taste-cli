// taste share <id> [--private]: makes a finished result public, so anyone with its address can read it
// without signing in, or private again. Free. The id is routed as wait routes it: a submission first,
// then a check. The address is the API's own result endpoint, which Taste serves without
// authentication once a result is public.
import type { Context } from "../context.ts";
import { plain } from "../output/output.ts";
import { byKind } from "./job.ts";

type ShareOptions = { private?: true };

function resultUrl(ctx: Context, path: string, id: string): string {
  return new URL(`${path}/${encodeURIComponent(id)}/result`, ctx.apiUrl).href;
}

async function share(
  ctx: Context,
  id: string,
  options: ShareOptions
): Promise<void> {
  const api = ctx.api();
  const wanted = !options.private;
  const shared = await byKind(
    async () => ({
      path: "/design/submissions",
      isPublic: (await api.setSubmissionVisibility(id, wanted)).is_public,
    }),
    async () => ({
      path: "/judge/brand-adherence",
      isPublic:
        (await api.setAdherenceVisibility(id, wanted)).is_public ?? wanted,
    })
  );
  const url = shared.isPublic ? resultUrl(ctx, shared.path, id) : null;
  ctx.output.result({ id, public: shared.isPublic, url }, (theme) =>
    url === null
      ? `${theme.success("✓")} Private. Only your account can read ${plain(id)}.`
      : `${theme.success("✓")} Public. Anyone with this address can read the result, without signing in:\n  ${plain(url)}`
  );
}

export { share };
export type { ShareOptions };
