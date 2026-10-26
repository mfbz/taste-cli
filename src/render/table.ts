// A plain table: a dimmed header, columns padded to their widest cell and two spaces apart. Every cell
// goes through plain(), since most come from the server. With a width, the last column is cut with
// "…" so a line never wraps; without one (a pipe) nothing is cut.
import { plain } from "../output/output.ts";
import type { Theme } from "../output/theme.ts";
import { fit } from "./fit.ts";

type TableOptions = { theme: Theme; width?: number };

const GAP = "  ";
// The last column keeps at least this much room, even when the terminal is narrower than the rest.
const MIN_LAST = 16;

const length = (text: string) => [...text].length;

function renderTable(
  header: readonly string[],
  rows: readonly (readonly string[])[],
  options: TableOptions
): string {
  const cells = rows.map((row) => row.map((cell) => plain(cell)));
  const last = header.length - 1;
  const widths = header.map((title, column) =>
    Math.max(length(title), ...cells.map((row) => length(row[column] ?? "")))
  );
  const lead = widths
    .slice(0, last)
    .reduce((sum, width) => sum + width + GAP.length, 0);
  const room =
    options.width === undefined
      ? Infinity
      : Math.max(options.width - 1 - lead, MIN_LAST);
  const line = (row: readonly string[]) =>
    row
      .map((cell, column) =>
        column === last
          ? fit(cell, room)
          : cell.padEnd((widths[column] ?? 0) + length(cell) - cell.length, " ")
      )
      .join(GAP)
      .trimEnd();
  return [options.theme.dim(line(header)), ...cells.map(line)].join("\n");
}

export { renderTable };
