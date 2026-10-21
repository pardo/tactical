#!/bin/sh
# Browser smoke tests. Needs `npm run dev` running and playwright-cli on PATH.
# The 3D canvas is not checked (no GPU in headless here); these test UI flow and game logic in a real browser.
set -e
dir=$(cd "$(dirname "$0")" && pwd)
playwright-cli open --mobile about:blank >/dev/null
trap 'playwright-cli close >/dev/null 2>&1' EXIT
status=0
for t in "$dir"/*.js; do
  name=$(basename "$t" .js)
  out=$(playwright-cli --raw run-code --filename="$t" 2>&1) && echo "PASS $name: $out" || { echo "FAIL $name: $out"; status=1; }
done
errors=$(playwright-cli console error 2>&1 | grep -c '^\[ERROR\]' || true)
[ "$errors" = "0" ] || { echo "FAIL console errors: $errors"; playwright-cli console error; status=1; }
exit $status
