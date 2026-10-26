#!/usr/bin/env bash
# npm run demo:record: records assets/demo.gif. taste runs against the local mock with a throwaway
# HOME and a mock key, so it spends no credits and nothing personal (path, host, user, email) can
# reach the frames; the prompt is a bare "$ ". Needs asciinema, agg and expect on the PATH.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
cast="$root/assets/demo.cast" # gitignored: kept to re-render the GIF without recording again
gif="$root/assets/demo.gif"

for tool in asciinema agg expect node; do
  command -v "$tool" >/dev/null || {
    echo "demo:record needs $tool on the PATH." >&2
    exit 1
  }
done

work="$(mktemp -d)"
mock_pid=""
cleanup() {
  [ -n "$mock_pid" ] && kill "$mock_pid" 2>/dev/null
  rm -rf "$work"
}
trap cleanup EXIT

(cd "$root" && npm run build --silent >/dev/null)

# Port 0: the mock picks a free port and prints its address.
node "$root/scripts/mock-taste.ts" --fast --port 0 2>"$work/mock.log" &
mock_pid=$!
disown "$mock_pid" # no "Terminated" line when the cleanup stops it
url=""
for _ in $(seq 50); do
  url="$(sed -n 's/^Mock Taste Engine on //p' "$work/mock.log")"
  [ -n "$url" ] && break
  sleep 0.1
done
[ -n "$url" ] || {
  echo "The mock did not start." >&2
  exit 1
}

mkdir "$work/home" "$work/bin"
printf '#!/bin/sh\nexec node "%s/dist/main.mjs" "$@"\n' "$root" >"$work/bin/taste"
chmod +x "$work/bin/taste"
printf "PS1='\\$ '\n" >"$work/bashrc"

# A scratch folder, so the demo's `> DESIGN.md` never touches the repo's own.
mkdir "$work/demo"
cd "$work/demo"
env -i \
  HOME="$work/home" \
  PATH="$work/bin:$(dirname "$(command -v node)"):$(dirname "$(command -v asciinema)"):/usr/bin:/bin" \
  TERM=xterm-256color COLORTERM=truecolor LANG=en_US.UTF-8 \
  HISTFILE=/dev/null BASH_SILENCE_DEPRECATION_WARNING=1 \
  TASTE_API_URL="$url" TASTE_API_KEY=taste_mock \
  asciinema rec --quiet --headless --overwrite --window-size 100x36 \
  --command "expect $root/scripts/demo/demo.exp $work/bashrc" "$cast"

# Taste's dark field and paper type around a plain ANSI palette, which only clack's menu uses.
theme="1e1e1e,f3f3ef,2b2b2b,f47067,57ab5a,c69026,539bf5,b083f0,39c5cf,d1d5da,6e7681,ff938a,6bc46d,daaa3f,6cb6ff,dcbdfb,56d4dd,f3f3ef"
agg --quiet --theme "$theme" --font-size 14 --idle-time-limit 2 \
  --last-frame-duration 4 --fps-cap 15 "$cast" "$gif"

echo "Wrote assets/demo.gif ($(($(wc -c <"$gif") / 1024)) KB)."
