#!/bin/sh
# Browser smoke tests. Needs `npm run dev` running and playwright-cli on PATH.
# WebGL runs through Mesa's software OpenGL (llvmpipe) via cli.config.json; Chromium's own
# SwiftShader crashes on the first draw under PRoot/arm64. Needs the Mesa EGL/GL packages
# (libegl-mesa0 libgl1-mesa-dri libgles2) installed.
# Tests skip the WebGL draw (window.__noDraw) so the CPU goes to the game, not to rasterizing;
# set E2E_DRAW=1 to draw anyway. E2E_JOBS sets how many tests run at once (default 3).
# Each test gets a fresh browser session so WebGL contexts and peers don't leak between tests.
dir=$(cd "$(dirname "$0")" && pwd)

if [ "$1" = "one" ]; then
  t=$2
  name=$(basename "$t" .js)
  s="-s=e2e-$name"
  playwright-cli $s open --mobile --config="$dir/cli.config.json" about:blank >/dev/null 2>&1
  if [ -z "$E2E_DRAW" ]; then
    playwright-cli $s run-code 'async (page) => { await page.context().addInitScript(() => { window.__noDraw = true; }); }' >/dev/null 2>&1
  fi
  status=0
  if out=$(playwright-cli $s --raw run-code --filename="$t" 2>&1); then
    echo "PASS $name: $out"
  else
    echo "FAIL $name: $out"
    status=1
  fi
  # WebGL shader/context errors come from the GPU-less headless browser, not the game.
  errors=$(playwright-cli $s console error 2>&1 | grep '^\[ERROR\]' | grep -vc 'WebGL')
  if [ "$errors" != "0" ]; then
    echo "FAIL $name console errors: $errors"
    playwright-cli $s console error 2>&1 | grep '^\[ERROR\]' | grep -v 'WebGL' | head -20
    status=1
  fi
  playwright-cli $s close >/dev/null 2>&1
  exit $status
fi

# Slowest tests first so they don't end up running alone at the end.
order="ai-vs-ai online hotseat planning-touch editor mobile-ux grenade-carry"
files=""
for n in $order; do [ -f "$dir/$n.js" ] && files="$files $dir/$n.js"; done
for t in "$dir"/*.js; do case " $files " in *" $t "*) ;; *) files="$files $t" ;; esac; done

out=$(mktemp -d)
printf '%s\n' $files | xargs -P "${E2E_JOBS:-3}" -I{} sh -c 'sh "$0" one "$1" > "$2/$(basename "$1" .js).log" 2>&1; echo $? > "$2/$(basename "$1" .js).rc"' "$dir/run.sh" {} "$out"
status=0
for t in $files; do
  n=$(basename "$t" .js)
  cat "$out/$n.log"
  [ "$(cat "$out/$n.rc")" = "0" ] || status=1
done
rm -rf "$out"
exit $status
