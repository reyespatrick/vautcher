#!/usr/bin/env bash
# Renders docs/manual/index.html to docs/manual/vautcher-guide.pdf via
# headless Chrome. Run from the repo root or this folder.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE/index.html"
OUT="$HERE/vautcher-guide.pdf"

# Detect Chrome / Chromium across platforms.
if [[ "$(uname)" == "Darwin" ]]; then
  CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  [[ -x "$CHROME" ]] || CHROME="/Applications/Chromium.app/Contents/MacOS/Chromium"
elif command -v google-chrome >/dev/null; then
  CHROME="$(command -v google-chrome)"
elif command -v chromium >/dev/null; then
  CHROME="$(command -v chromium)"
else
  echo "Chrome/Chromium not found." >&2
  exit 1
fi

echo "→ rendering $SRC"
"$CHROME" \
  --headless=new \
  --disable-gpu \
  --no-sandbox \
  --no-pdf-header-footer \
  --print-to-pdf="$OUT" \
  --virtual-time-budget=10000 \
  "file://$SRC" >/dev/null 2>&1

echo "  ok → $OUT"
ls -lh "$OUT"
