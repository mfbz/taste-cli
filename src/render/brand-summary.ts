// A finished extraction or brand kit as a short terminal summary: the brand, its style and tone, the
// palette as swatches, the type families, and where it came from. design_system's inner shapes are not
// published, so each field is read leniently and a missing one is left out, never guessed. Every
// server string goes through plain() before it is shown.
import { z } from "zod";

import type { SubmissionResult } from "../api/schemas.ts";
import { plain } from "../output/output.ts";
import type { Theme } from "../output/theme.ts";
import type { ColorLevel } from "../output/terminal.ts";
import { fit } from "./fit.ts";
import { normalizeHex, renderColorRow } from "./swatches.ts";
import type { Color } from "./swatches.ts";

type SummaryOptions = { theme: Theme; colorLevel: ColorLevel; width: number };

const LABEL_WIDTH = 7;
// "  ██ #RRGGBB  ": the indent, the swatch and its space, the hex and the gap before the name.
const COLOR_ROW_PREFIX = 2 + 3 + 7 + 2;
// Website extractions group type variants under these keys; brand kits list typefaces.
const TYPE_GROUPS = ["titles", "paragraphs", "labels", "others", "highlights"];

const text = z.string().optional().catch(undefined);
const list = <T extends z.ZodType>(item: T) =>
  z
    .array(z.unknown())
    .optional()
    .catch(undefined)
    .transform((items) =>
      (items ?? []).flatMap((value) => {
        const parsed = item.safeParse(value);
        return parsed.success ? [parsed.data] : [];
      })
    );
const COLOR = z.looseObject({ name: text, hex: z.unknown() });
const DESIGN = z.looseObject({
  profile: z
    .looseObject({
      brand_name: text,
      tagline: text,
      copy_tone: list(z.string()),
      style_classification: z
        .looseObject({ primary_style: text, secondary_style: text })
        .optional()
        .catch(undefined),
    })
    .optional()
    .catch(undefined),
  colors: z
    .looseObject({
      baseline: list(COLOR),
      secondary: list(COLOR),
      palette: list(COLOR),
    })
    .optional()
    .catch(undefined),
  typography: z.record(z.string(), z.unknown()).optional().catch(undefined),
});
const VARIANTS = z.looseObject({
  variants: list(z.looseObject({ name: text })),
});
const TYPEFACES = list(z.looseObject({ family: text }));

function design(result: SubmissionResult) {
  return DESIGN.parse(result.result?.design_system ?? {});
}

function hostOf(url: string): string {
  return URL.parse(url)?.hostname || url;
}

function brandName(result: SubmissionResult): string {
  const name = plain(design(result).profile?.brand_name ?? "").trim();
  return name || plain(hostOf(result.source_url));
}

function colors(d: ReturnType<typeof design>): Color[] {
  const all = [
    ...(d.colors?.baseline ?? []),
    ...(d.colors?.secondary ?? []),
    ...(d.colors?.palette ?? []),
  ];
  const seen = new Set<string>();
  return all.flatMap(({ name, hex }) => {
    const valid = normalizeHex(hex);
    if (!valid || seen.has(valid)) return [];
    seen.add(valid);
    return [{ hex: valid, name: plain(name ?? "") }];
  });
}

function families(d: ReturnType<typeof design>): string[] {
  const typography = d.typography ?? {};
  const names = [
    ...TYPE_GROUPS.flatMap(
      (group) =>
        VARIANTS.safeParse(typography[group]).data?.variants.map(
          (v) => v.name
        ) ?? []
    ),
    ...TYPEFACES.parse(typography.typefaces).map((t) => t.family),
  ];
  // A CSS expression such as var(--mono) is not a family a person can look up.
  const real = names
    .map((name) => plain(name ?? "").trim())
    .filter((name) => name !== "" && !/[()]/.test(name));
  return [...new Set(real)];
}

function renderBrandSummary(
  result: SubmissionResult,
  { theme, colorLevel, width }: SummaryOptions
): string {
  const d = design(result);
  const profile = d.profile;
  const field = (label: string, value: string) =>
    `${theme.dim(label.padEnd(LABEL_WIDTH))}${fit(value, width - LABEL_WIDTH)}`;
  const lines = [theme.bold(fit(brandName(result), width))];
  const tagline = plain(profile?.tagline ?? "").trim();
  if (tagline) lines.push(theme.dim(fit(tagline, width)));
  const style = [
    profile?.style_classification?.primary_style,
    profile?.style_classification?.secondary_style,
  ]
    .map((s) => plain(s ?? "").trim())
    .filter(Boolean);
  if (style.length) lines.push(field("style", style.join(", ")));
  const tone = (profile?.copy_tone ?? []).map((t) => plain(t).trim());
  if (tone.length) lines.push(field("tone", tone.join(", ")));
  const palette = colors(d);
  if (palette.length) {
    lines.push("", theme.dim("palette"));
    for (const color of palette) {
      const name = fit(color.name, width - COLOR_ROW_PREFIX);
      lines.push(`  ${renderColorRow({ ...color, name }, colorLevel, theme)}`);
    }
  }
  const type = families(d);
  if (type.length) lines.push("", field("type", type.join(", ")));
  lines.push(
    "",
    field("source", plain(result.source_url)),
    field("id", plain(result.submission_id)),
    "",
    theme.dim(
      fit(
        `All of it: taste wait ${plain(result.submission_id)} --format json`,
        width
      )
    )
  );
  return lines.join("\n");
}

export { brandName, renderBrandSummary };
export type { SummaryOptions };
