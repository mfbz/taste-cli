// A finished extraction or brand kit as a DESIGN.md file (the Google Labs format, version "alpha"):
// YAML front matter with the tokens, then the spec's sections in its order. Only what the extraction
// holds is written: a token or a section with nothing behind it is left out, never guessed. The
// mapping is a table in TASTE-CLI.md. Every server string goes through plain(), whitespace collapsed,
// and every YAML string is double quoted, so nothing from Taste can end the front matter or add a
// heading.
import type { SubmissionResult } from "../api/schemas.ts";
import { plain } from "../output/output.ts";

type DesignMdMeta = {
  // "taste-cli <version>".
  generator: string;
  // The extraction's date, YYYY-MM-DD.
  extractedAt: string;
};
type Rec = Readonly<Record<string, unknown>>;
// A token's value: a number or a dimension written bare, anything else quoted.
type Value = string | number;
type Tokens = Map<string, Value | Map<string, Value>>;

const SPEC_VERSION = "alpha";
// Website extractions group type variants under these keys; brand kits list a hierarchy.
const TYPE_GROUPS = ["titles", "paragraphs", "labels", "others", "highlights"];
const NUMBER = /^-?(?:\d+\.?\d*|\.\d+)$/;
const DIMENSION = /^-?(?:\d+\.?\d*|\.\d+)(?:px|em|rem)$/;
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const CSS_COLOR = /^(?:rgba?|hsla?)\([\d\s.,%/]+\)$|^transparent$/i;
// Keys YAML would read as something other than a string.
const YAML_WORDS = new Set(["true", "false", "null", "yes", "no", "on", "off"]);

function rec(value: unknown): Rec {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Rec)
    : {};
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

// Server text on one line, without control characters.
function str(value: unknown): string {
  if (typeof value === "number") return String(value);
  return typeof value === "string"
    ? plain(value.replace(/\s+/g, " ")).trim()
    : "";
}

function strs(value: unknown): string[] {
  return arr(value).map(str).filter(Boolean);
}

// A number with a unit (a brand kit gives the number and its unit apart), or nothing.
function dimension(value: unknown, unit = ""): string | undefined {
  const text = `${str(value)}${typeof value === "number" ? unit : ""}`;
  return DIMENSION.test(text) ? text : undefined;
}

// A dimension, or a unitless number where the spec allows one (line height, weight, columns).
function amount(value: unknown, unit = ""): Value | undefined {
  const text = str(value);
  return (
    dimension(value, unit) ?? (NUMBER.test(text) ? Number(text) : undefined)
  );
}

function color(value: unknown): string | undefined {
  const text = str(value);
  return HEX.test(text) || CSS_COLOR.test(text) ? text : undefined;
}

function slug(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// The extraction's own name as a token name; a second of the same name gets -2.
function namer(fallback: string) {
  const taken = new Set<string>();
  return (name: string): string => {
    const base = slug(name) || fallback;
    let key = base;
    for (let n = 2; taken.has(key); n++) key = `${base}-${n}`;
    taken.add(key);
    return key;
  };
}

function yamlKey(key: string): string {
  return /^[a-z][a-z0-9-]*$/.test(key) && !YAML_WORDS.has(key)
    ? key
    : JSON.stringify(key);
}

function yamlValue(value: Value): string {
  return typeof value === "number" || DIMENSION.test(value)
    ? String(value)
    : JSON.stringify(value);
}

function yamlBlock(name: string, tokens: Tokens): string[] {
  if (tokens.size === 0) return [];
  const lines = [`${name}:`];
  for (const [key, value] of tokens) {
    if (value instanceof Map) {
      lines.push(`  ${yamlKey(key)}:`);
      for (const [k, v] of value) lines.push(`    ${k}: ${yamlValue(v)}`);
    } else lines.push(`  ${yamlKey(key)}: ${yamlValue(value)}`);
  }
  return lines;
}

// A line of prose that markdown would otherwise read as a heading, a list, a quote or a rule.
function paragraph(text: string): string {
  return text
    .replace(/^(\d+)([.)])/, "$1\\$2")
    .replace(/^([#>*+=|<`~_-])/, "\\$1");
}

function bullet(label: string, text: string): string {
  return label ? `- **${label}:** ${text}` : `- ${paragraph(text)}`;
}

function section(title: string, blocks: string[][]): string[] {
  const body = blocks.filter((block) => block.length > 0);
  if (body.length === 0) return [];
  return [`## ${title}`, ...body.map((block) => block.join("\n"))];
}

function hostOf(url: string): string {
  return URL.parse(url)?.hostname || url;
}

// The palette: website extractions split it in two, brand kits list one.
function paletteOf(ds: Rec): Rec[] {
  const colors = rec(ds.colors);
  return [colors.baseline, colors.secondary, colors.palette]
    .flatMap(arr)
    .map(rec)
    .filter((c) => HEX.test(str(c.hex)));
}

function colorTokens(palette: Rec[]): Tokens {
  const name = namer("color");
  return new Map(palette.map((c) => [name(str(c.name)), str(c.hex)]));
}

// A component's colour as a reference to the palette token of the same hex, else the value itself.
function colorRef(colors: Tokens, value: unknown): string | undefined {
  const css = color(value);
  if (css === undefined) return undefined;
  for (const [key, hex] of colors)
    if (typeof hex === "string" && hex.toLowerCase() === css.toLowerCase())
      return `{colors.${key}}`;
  return css;
}

function put(
  target: Map<string, Value>,
  key: string,
  value: Value | undefined
) {
  if (value !== undefined) target.set(key, value);
}

function typographyTokens(ds: Rec): Tokens {
  const typography = rec(ds.typography);
  const name = namer("type");
  const tokens: Tokens = new Map();
  const add = (label: string, props: Map<string, Value>) => {
    if (props.size) tokens.set(name(label), props);
  };
  for (const group of TYPE_GROUPS)
    for (const variant of arr(rec(typography[group]).variants).map(rec)) {
      const specs = rec(variant.specs);
      const family = str(variant.name);
      const props = new Map<string, Value>();
      // A CSS expression such as var(--mono) is not a family.
      if (family && !/[()]/.test(family)) props.set("fontFamily", family);
      put(props, "fontSize", dimension(specs.size));
      put(props, "fontWeight", amount(specs.font_weight));
      put(props, "lineHeight", amount(specs.line_height));
      add(str(variant.role) || family, props);
    }
  for (const level of arr(typography.hierarchy).map(rec)) {
    const unit = str(level.unit);
    const props = new Map<string, Value>();
    put(props, "fontFamily", str(level.family) || undefined);
    put(props, "fontSize", dimension(level.size, unit));
    put(props, "fontWeight", amount(level.weight));
    put(props, "lineHeight", amount(level.line_height, unit));
    add(str(level.role), props);
  }
  return tokens;
}

function spacingTokens(ds: Rec): Tokens {
  const grid = rec(rec(ds.layout).grid);
  const tokens = new Map<string, Value>();
  put(tokens, "columns", amount(grid.columns));
  put(tokens, "gutter", amount(grid.gutter));
  put(tokens, "max-width", amount(grid.max_width));
  put(
    tokens,
    "button-gap",
    dimension(rec(rec(ds.actions).button_group).spacing)
  );
  return tokens;
}

function componentTokens(ds: Rec, colors: Tokens): Tokens {
  const name = namer("component");
  const tokens: Tokens = new Map();
  const add = (label: string, props: Map<string, Value>) => {
    if (props.size) tokens.set(name(label), props);
  };
  // Website buttons: the default look, and the hover look when it differs.
  for (const button of arr(rec(ds.actions).button_list).map(rec)) {
    const label = `button ${str(button.name)}`;
    const visuals = rec(button.visuals);
    const look = (state: unknown) => {
      const props = new Map<string, Value>();
      put(props, "backgroundColor", colorRef(colors, rec(state).background));
      put(props, "textColor", colorRef(colors, rec(state).text_color));
      return props;
    };
    const base = look(visuals.default);
    const hover = look(visuals.hover);
    const differs = JSON.stringify([...hover]) !== JSON.stringify([...base]);
    put(
      base,
      "padding",
      dimension(rec(arr(rec(button.specs).sizes)[0]).padding)
    );
    add(label, base);
    if (differs) add(`${label} hover`, hover);
  }
  // Brand kit buttons carry their CSS.
  for (const button of arr(ds.buttons).map(rec)) {
    const css = rec(button.css);
    const state = str(button.state);
    const props = new Map<string, Value>();
    put(props, "backgroundColor", colorRef(colors, css.background));
    put(props, "textColor", colorRef(colors, css.color));
    put(props, "rounded", dimension(css["border-radius"]));
    put(props, "padding", dimension(css.padding));
    add(
      `button ${str(button.role)} ${state === "default" ? "" : state}`,
      props
    );
  }
  const nav = rec(rec(ds.navigation).top_nav);
  const navProps = new Map<string, Value>();
  put(navProps, "backgroundColor", colorRef(colors, rec(nav.background).hex));
  put(navProps, "height", dimension(nav.height));
  add("top nav", navProps);
  return tokens;
}

function overview(ds: Rec): string[][] {
  const profile = rec(ds.profile);
  const style = rec(profile.style_classification);
  const visual = rec(profile.visual_language);
  const lead = str(profile.brand_signature) || str(profile.summary);
  const facts: [string, string][] = [
    ["Tagline", str(profile.tagline)],
    [
      "Style",
      [str(style.primary_style), str(style.secondary_style)]
        .filter(Boolean)
        .join(", "),
    ],
    ["Industry", str(profile.industry)],
    ["Tone", strs(profile.copy_tone).join(", ")],
    ["Personality", strs(profile.personality).join(", ")],
    ["Audience", strs(profile.audience).join(" ")],
    ["Keywords", strs(visual.keywords).join(", ")],
    ["Accents", str(visual.accent_strategy)],
    ["Highlights", str(visual.highlights)],
  ];
  return [
    lead ? [paragraph(lead)] : [],
    facts
      .filter(([, text]) => text)
      .map(([label, text]) => bullet(label, text)),
  ];
}

function colorsProse(ds: Rec, palette: Rec[]): string[][] {
  return [
    ...strs(rec(ds.colors).insights).map((text) => [paragraph(text)]),
    palette.map((c) => {
      const use =
        str(rec(c.rules).description) || strs(c.when_to_use).join(" ");
      const label = `${str(c.name) || "Color"} (${str(c.hex)})`;
      return use ? bullet(label, use) : `- **${label}**`;
    }),
  ];
}

function typographyProse(ds: Rec): string[][] {
  const typography = rec(ds.typography);
  // Website extractions: each family with the roles it sets.
  const roles = new Map<string, string[]>();
  for (const group of TYPE_GROUPS)
    for (const variant of arr(rec(typography[group]).variants).map(rec)) {
      const family = str(variant.name);
      if (!family || /[()]/.test(family)) continue;
      roles.set(
        family,
        [...(roles.get(family) ?? []), str(variant.role)].filter(Boolean)
      );
    }
  return [
    ...strs(typography.insights).map((text) => [paragraph(text)]),
    [...roles].map(([family, list]) => bullet(family, list.join(", "))),
    // Brand kits: each typeface with how to use it.
    arr(typography.typefaces)
      .map(rec)
      .filter((t) => str(t.family))
      .map((t) =>
        bullet(
          str(t.family),
          strs(t.when_to_use).join(" ") || strs(t.roles).join(", ")
        )
      ),
  ];
}

function layoutProse(ds: Rec): string[][] {
  const layout = rec(ds.layout);
  const grid = rec(layout.grid);
  const gridText = [
    grid.columns === undefined ? "" : `${str(grid.columns)} columns`,
    str(grid.gutter) && `${str(grid.gutter)} gutter`,
    str(grid.max_width) && `${str(grid.max_width)} max width`,
  ]
    .filter(Boolean)
    .join(", ");
  const breakpoints = Object.entries(rec(layout.breakpoints))
    .filter(([, text]) => str(text))
    .map(([name, text]) =>
      bullet(str(name.charAt(0).toUpperCase() + name.slice(1)), str(text))
    );
  return [
    ...strs(layout.insights).map((text) => [paragraph(text)]),
    str(layout.section_separation)
      ? [paragraph(str(layout.section_separation))]
      : [],
    [...(gridText ? [bullet("Grid", gridText)] : []), ...breakpoints],
  ];
}

function elevationProse(ds: Rec): string[][] {
  const levels = arr(rec(rec(ds.elevation).shadows).levels).map(rec);
  return [
    levels
      .filter((level) => str(level.name))
      .map((level) => {
        const css = str(level.css_value).replace(/`/g, "");
        const text = [str(level.description), css && `\`${css}\``]
          .filter(Boolean)
          .join(" ");
        return text
          ? bullet(str(level.name), text)
          : `- **${str(level.name)}**`;
      }),
    strs(rec(ds.surfaces).highlights).map((text) => bullet("", text)),
  ];
}

function componentsProse(ds: Rec): string[][] {
  const actions = rec(ds.actions);
  return [
    arr(actions.button_list)
      .map(rec)
      .filter((b) => str(b.name) && str(b.usage))
      .map((b) => bullet(str(b.name), str(b.usage))),
    str(rec(actions.button_group).description)
      ? [paragraph(str(rec(actions.button_group).description))]
      : [],
    ...strs(rec(ds.interactions).insights).map((text) => [paragraph(text)]),
  ];
}

// Brand kits: the voice and the guidelines, verbatim; a spec whose words give no figure gets its
// value. A colour's rules are already under Colors.
function dosAndDonts(ds: Rec): string[][] {
  const voice = rec(rec(ds.profile).voice);
  const rules = arr(ds.rules)
    .map(rec)
    .filter((rule) => str(rule.section) !== "colors")
    .map((rule) => {
      const guideline = str(rule.guideline);
      const value = str(rule.value);
      const bare = str(rule.kind) === "spec" && !/\d/.test(guideline);
      return bare && value && !guideline.includes(value)
        ? `${guideline.replace(/\.$/, "")}: ${value}.`
        : guideline;
    });
  return [
    [...strs(voice.do), ...strs(voice.dont), ...rules]
      .filter(Boolean)
      .map((text) => bullet("", text)),
  ];
}

function renderDesignMd(result: SubmissionResult, meta: DesignMdMeta): string {
  const ds = rec(result.result?.design_system);
  const profile = rec(ds.profile);
  const name = str(profile.brand_name) || str(hostOf(result.source_url));
  const description = str(profile.brand_signature) || str(profile.summary);
  const palette = paletteOf(ds);
  const colors = colorTokens(palette);
  const front = [
    "---",
    `version: ${SPEC_VERSION}`,
    `name: ${JSON.stringify(name)}`,
    ...(description ? [`description: ${JSON.stringify(description)}`] : []),
    ...yamlBlock("colors", colors),
    ...yamlBlock("typography", typographyTokens(ds)),
    ...yamlBlock("spacing", spacingTokens(ds)),
    ...yamlBlock("components", componentTokens(ds, colors)),
    "---",
  ];
  const source = str(result.source_url).replace(/^file:\/\//, "");
  const body = [
    `# ${name}`,
    ...section("Overview", overview(ds)),
    ...section("Colors", colorsProse(ds, palette)),
    ...section("Typography", typographyProse(ds)),
    ...section("Layout", layoutProse(ds)),
    ...section("Elevation & Depth", elevationProse(ds)),
    ...section("Components", componentsProse(ds)),
    ...section("Do's and Don'ts", dosAndDonts(ds)),
    `_Extracted from ${source} on ${meta.extractedAt} with the Taste Engine, via ${meta.generator} (unofficial)._`,
  ];
  return `${front.join("\n")}\n\n${body.join("\n\n")}\n`;
}

export { renderDesignMd };
export type { DesignMdMeta };
