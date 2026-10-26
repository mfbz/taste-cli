// npm run fixtures:sample-pdf: writes fixtures-input/sample-guidelines.pdf, the brand guidelines of
// Acme, a made-up brand, for the kit recipe. Built by hand (objects, xref, the standard Helvetica
// fonts, vector shapes), so it needs no dependency, holds no one's data, and comes out byte for byte
// the same every time: it is committed, and a test checks it matches this script.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type Rgb = readonly [number, number, number];
type Swatch = {
  name: string;
  hex: string;
  share: number;
  use: string;
};

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUTPUT = join(ROOT, "fixtures-input", "sample-guidelines.pdf");
// A4, in points.
const WIDTH = 595;
const HEIGHT = 842;
const MARGIN = 56;
const SWATCHES: readonly Swatch[] = [
  {
    name: "Acme Red",
    hex: "#D7263D",
    share: 10,
    use: "Primary actions and the wordmark",
  },
  { name: "Ink", hex: "#1B1B1E", share: 25, use: "Text and dark surfaces" },
  { name: "Paper", hex: "#F7F4EF", share: 50, use: "Page background" },
  {
    name: "Steel",
    hex: "#5C6B73",
    share: 10,
    use: "Secondary text and borders",
  },
  { name: "Sun", hex: "#F4B942", share: 5, use: "Highlights, used sparingly" },
];
const SCALE: readonly [string, string, number, number][] = [
  ["Display", "Bold", 48, 52],
  ["Heading 1", "Bold", 32, 38],
  ["Heading 2", "Bold", 24, 30],
  ["Body", "Regular", 16, 24],
  ["Caption", "Regular", 12, 16],
];

function rgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  const unit = (c: number) => Math.round((c / 255) * 1000) / 1000;
  return [unit((n >> 16) & 255), unit((n >> 8) & 255), unit(n & 255)];
}

const RED = rgb("#D7263D");
const INK = rgb("#1B1B1E");
const PAPER = rgb("#F7F4EF");
const STEEL = rgb("#5C6B73");

function color(c: Rgb, op: "rg" | "RG"): string {
  return `${c.join(" ")} ${op}`;
}

function escapeText(text: string): string {
  return text.replace(/[\\()]/g, "\\$&");
}

// y is measured from the top of the page, as people read it.
function text(
  x: number,
  y: number,
  size: number,
  value: string,
  c: Rgb = INK,
  bold = false
): string {
  return `BT ${color(c, "rg")} /${bold ? "F2" : "F1"} ${size} Tf ${x} ${HEIGHT - y} Td (${escapeText(value)}) Tj ET`;
}

function rect(x: number, y: number, w: number, h: number, c: Rgb): string {
  return `${color(c, "rg")} ${x} ${HEIGHT - y - h} ${w} ${h} re f`;
}

// A rounded rectangle: four Bezier corners (kappa 0.5523), filled or stroked.
function rounded(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  paint: string
): string {
  const k = r * 0.5523;
  const b = HEIGHT - y - h;
  const t = HEIGHT - y;
  return [
    `${x + r} ${b} m`,
    `${x + w - r} ${b} l`,
    `${x + w - r + k} ${b} ${x + w} ${b + r - k} ${x + w} ${b + r} c`,
    `${x + w} ${t - r} l`,
    `${x + w} ${t - r + k} ${x + w - r + k} ${t} ${x + w - r} ${t} c`,
    `${x + r} ${t} l`,
    `${x + r - k} ${t} ${x} ${t - r + k} ${x} ${t - r} c`,
    `${x} ${b + r} l`,
    `${x} ${b + r - k} ${x + r - k} ${b} ${x + r} ${b} c`,
    paint,
  ].join(" ");
}

function heading(title: string, page: number): string[] {
  return [
    rect(0, 0, WIDTH, HEIGHT, PAPER),
    text(MARGIN, 64, 10, "ACME  BRAND GUIDELINES", STEEL, true),
    text(WIDTH - MARGIN - 12, 64, 10, String(page), STEEL),
    text(MARGIN, 120, 32, title, INK, true),
  ];
}

function cover(): string[] {
  return [
    rect(0, 0, WIDTH, HEIGHT, INK),
    rect(MARGIN, 300, 12, 120, RED),
    text(MARGIN + 32, 400, 96, "ACME", PAPER, true),
    text(MARGIN + 32, 448, 20, "Tools that work the first time.", PAPER),
    text(MARGIN, HEIGHT - 72, 11, "Brand guidelines, edition 1", STEEL),
    text(
      MARGIN,
      HEIGHT - 56,
      11,
      "A sample brand for testing. Acme is not a real company.",
      STEEL
    ),
  ];
}

function colors(): string[] {
  const ops = heading("Color", 2);
  ops.push(
    text(
      MARGIN,
      156,
      12,
      "Five colors. Use them in these proportions across a page.",
      STEEL
    )
  );
  let x = MARGIN;
  const barWidth = WIDTH - 2 * MARGIN;
  for (const s of SWATCHES) {
    const w = (barWidth * s.share) / 100;
    ops.push(rect(x, 184, w, 24, rgb(s.hex)));
    x += w;
  }
  ops.push(
    `${color(STEEL, "RG")} 0.5 w ${MARGIN} ${HEIGHT - 208} ${barWidth} 24 re S`
  );
  SWATCHES.forEach((s, i) => {
    const y = 248 + i * 104;
    ops.push(rounded(MARGIN, y, 120, 80, 6, `${color(rgb(s.hex), "rg")} f`));
    ops.push(rounded(MARGIN, y, 120, 80, 6, `${color(STEEL, "RG")} 0.5 w S`));
    ops.push(text(MARGIN + 144, y + 22, 16, s.name, INK, true));
    ops.push(
      text(MARGIN + 144, y + 44, 12, `${s.hex}   ${s.share}% of a page`, INK)
    );
    ops.push(text(MARGIN + 144, y + 64, 12, s.use, STEEL));
  });
  return ops;
}

function typography(): string[] {
  const ops = heading("Typography", 3);
  ops.push(
    text(
      MARGIN,
      160,
      14,
      "Typeface: Helvetica Neue. Fallbacks: Helvetica, Arial, sans-serif.",
      INK
    )
  );
  ops.push(
    text(
      MARGIN,
      182,
      12,
      "Bold for display and headings, Regular for body and captions.",
      STEEL
    )
  );
  ops.push(text(MARGIN, 224, 10, "ROLE", STEEL, true));
  ops.push(text(MARGIN + 110, 224, 10, "WEIGHT", STEEL, true));
  ops.push(text(MARGIN + 190, 224, 10, "SIZE / LINE HEIGHT", STEEL, true));
  let y = 260;
  for (const [role, weight, size, line] of SCALE) {
    ops.push(text(MARGIN, y, 12, role, INK));
    ops.push(text(MARGIN + 110, y, 12, weight, INK));
    ops.push(text(MARGIN + 190, y, 12, `${size} px / ${line} px`, INK));
    y += 24;
  }
  y += 24;
  for (const [role, weight, size, line] of SCALE) {
    y += line;
    ops.push(
      text(
        MARGIN,
        y,
        size,
        role === "Caption" ? "Caption text, 12 px" : `${role} sample`,
        INK,
        weight === "Bold"
      )
    );
  }
  ops.push(
    text(
      MARGIN,
      y + 48,
      12,
      "Body text sets at 16 px on 24 px, left aligned, 60 to 75 characters a line.",
      STEEL
    )
  );
  return ops;
}

function buttonsAndLogo(): string[] {
  const ops = heading("Buttons and logo", 4);
  ops.push(
    text(
      MARGIN,
      160,
      12,
      "Corner radius 6 px. Padding 12 px top and bottom, 24 px left and right. Label 16 px Bold.",
      STEEL
    )
  );
  ops.push(rounded(MARGIN, 184, 140, 44, 6, `${color(RED, "rg")} f`));
  ops.push(text(MARGIN + 24, 212, 16, "Get started", PAPER, true));
  ops.push(
    rounded(MARGIN + 164, 184, 120, 44, 6, `${color(INK, "RG")} 1.5 w S`)
  );
  ops.push(text(MARGIN + 188, 212, 16, "Read more", INK, true));
  ops.push(
    text(
      MARGIN,
      252,
      12,
      "Primary: Acme Red fill, Paper label. One per screen.",
      INK
    )
  );
  ops.push(
    text(
      MARGIN,
      272,
      12,
      "Secondary: no fill, 1.5 px Ink border, Ink label.",
      INK
    )
  );
  ops.push(text(MARGIN, 336, 20, "Logo", INK, true));
  ops.push(
    `${color(STEEL, "RG")} 0.75 w [4 3] 0 d ${MARGIN} ${HEIGHT - 476} 236 112 re S [] 0 d`
  );
  ops.push(text(MARGIN + 28, 446, 56, "ACME", INK, true));
  ops.push(
    text(MARGIN + 260, 384, 12, "Clear space: the height of the A in the", INK)
  );
  ops.push(text(MARGIN + 260, 400, 12, "wordmark, on every side.", INK));
  ops.push(
    text(
      MARGIN + 260,
      424,
      12,
      "Minimum width: 96 px on screen, 24 mm in print.",
      INK
    )
  );
  ops.push(text(MARGIN, 524, 20, "Misuse", INK, true));
  ops.push(
    text(
      MARGIN,
      556,
      12,
      "1. Do not stretch, slant or rotate the wordmark.",
      INK
    )
  );
  ops.push(
    text(
      MARGIN,
      578,
      12,
      "2. Do not place the wordmark on Acme Red or on a busy photo.",
      INK
    )
  );
  return ops;
}

function buildSampleGuidelines(): Uint8Array {
  const pages = [cover(), colors(), typography(), buttonsAndLogo()];
  const objects: string[] = [];
  // push returns the new length, which is the object's number (they start at 1).
  const add = (body: string) => objects.push(body);
  const catalog = add("");
  const tree = add("");
  const regular = add(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
  );
  const bold = add(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"
  );
  const info = add(
    "<< /Title (Acme brand guidelines) /Producer (taste-cli) >>"
  );
  const kids = pages.map((ops) => {
    const stream = ops.join("\n");
    const content = add(
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
    );
    return add(
      `<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 ${WIDTH} ${HEIGHT}] /Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >> >> /Contents ${content} 0 R >>`
    );
  });
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${tree} 0 R >>`;
  objects[tree - 1] =
    `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => {
    const offset = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets)
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // Every character above is ASCII, so string offsets are byte offsets.
  return new TextEncoder().encode(pdf);
}

if (import.meta.main) {
  mkdirSync(dirname(OUTPUT), { recursive: true });
  const bytes = buildSampleGuidelines();
  writeFileSync(OUTPUT, bytes);
  process.stderr.write(
    `Wrote fixtures-input/sample-guidelines.pdf (${Math.ceil(bytes.length / 1024)} KB)\n`
  );
}

export { buildSampleGuidelines, OUTPUT };
