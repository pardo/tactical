#!/bin/sh
# Browser smoke tests. Needs `npm run dev` running and playwright-cli on PATH.
# The 3D canvas is not checked (no GPU in headless here); these test UI flow and game logic in a real browser.
# Each test gets a fresh browser so WebGL contexts and peers don't leak between tests.
dir=$(cd "$(dirname "$0")" && pwd)
status=0
for t in "$dir"/*.js; do
  name=$(basename "$t" .js)
  playwright-cli open --mobile about:blank >/dev/null 2>&1
  if out=$(playwright-cli --raw run-code --filename="$t" 2>&1); then
    echo "PASS $name: $out"
  else
    echo "FAIL $name: $out"
    status=1
  fi
  # WebGL shader/context errors come from the GPU-less headless browser, not the game.
  errors=$(playwright-cli console error 2>&1 | grep '^\[ERROR\]' | grep -vc 'WebGL')
  if [ "$errors" != "0" ]; then
    echo "FAIL $name console errors: $errors"
    playwright-cli console error 2>&1 | grep '^\[ERROR\]' | grep -v 'WebGL' | head -20
    status=1
  fi
  playwright-cli close >/dev/null 2>&1
done
exit $status
