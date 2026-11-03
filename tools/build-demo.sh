#!/usr/bin/env bash
# Builds the client demo for bogabee.ayricky.dev into dist/demo: the showcase at the root,
# and today's site under /today/ so the before/after pages can still load it.
#   tools/build-demo.sh && secrets run bogabee-site/cloudflare-pages -- npx wrangler pages deploy dist/demo --project-name bogabee-demo --branch main
set -euo pipefail
cd "$(dirname "$0")/.."
out=dist/demo
rm -rf "$out"
mkdir -p "$out/today"
cp -R demos/. "$out/"
cp index.html "$out/today/"
cp -R assets "$out/today/"
# In the repo the demos sit one folder below today's site; here today's site is /today/.
for f in "$out/compare/index.html" "$out/bees/index.html"; do
    sed -i "s#'\.\./\.\./assets/#'../today/assets/#g; s#\"\.\./\.\./\"#\"../today/\"#g" "$f"
done
if grep -rn "\.\./\.\./" "$out/compare/index.html" "$out/bees/index.html"; then echo "build-demo: a path still points above the demo" >&2; exit 1; fi
# A demo, not the shop: keep it out of search results.
printf 'User-agent: *\nDisallow: /\n' > "$out/robots.txt"
printf '/*\n  X-Robots-Tag: noindex\n' > "$out/_headers"
echo "built $out ($(du -sh "$out" | cut -f1))"
