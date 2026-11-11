#!/bin/sh
# Bundelt bron.jsx (Glisse + React) tot één ES-module voor de site. Gebruik: ./bouw.sh [uitvoerbestand]
set -e
cd "$(dirname "$0")"
[ -d node_modules ] || npm ci --no-audit --no-fund
npx esbuild bron.jsx --bundle --format=esm --minify --jsx=automatic --target=chrome100 \
  --define:process.env.NODE_ENV='"production"' --legal-comments=eof \
  --outfile="${1:-../public/glisse.js}"
