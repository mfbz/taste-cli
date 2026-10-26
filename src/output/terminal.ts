type ColorLevel = 0 | 1 | 2 | 3;
type TerminalInfo = {
  tty: boolean;
  width: number;
  colorLevel: ColorLevel;
  motion: boolean;
};
type StreamLike = {
  isTTY?: boolean;
  columns?: number;
  getColorDepth?: () => number;
};
type EnvLike = Record<string, string | undefined>;

// What a pipe or a file is assumed to be, for anything that lays text out.
const DEFAULT_WIDTH = 80;

function depthToLevel(depth: number): ColorLevel {
  if (depth >= 24) return 3;
  if (depth >= 8) return 2;
  if (depth >= 4) return 1;
  return 0;
}

function colorLevel(stream: StreamLike, env: EnvLike): ColorLevel {
  // https://no-color.org: present and not empty.
  if (env.NO_COLOR) return 0;
  const forced = env.FORCE_COLOR;
  if (forced !== undefined && forced !== "0" && forced !== "false") {
    const level = Number(forced);
    return level >= 1 && level <= 3 ? (level as ColorLevel) : 1;
  }
  if (!stream.isTTY || env.TERM === "dumb") return 0;
  return depthToLevel(stream.getColorDepth?.() ?? 4);
}

function detectTerminal(
  stream: StreamLike,
  env: EnvLike,
  flags: { motion: boolean }
): TerminalInfo {
  const tty = stream.isTTY === true;
  const level = colorLevel(stream, env);
  // Motion is decoration: anything that asks for less, or can't show it, gets none.
  const motion =
    flags.motion &&
    tty &&
    !env.NO_COLOR &&
    !env.CI &&
    !env.TASTE_NO_MOTION &&
    env.TERM !== "dumb";
  return {
    tty,
    width: stream.columns ?? DEFAULT_WIDTH,
    colorLevel: level,
    motion,
  };
}

export { detectTerminal };
export type { ColorLevel, StreamLike, TerminalInfo };
