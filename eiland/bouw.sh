#!/bin/sh
# Bundelt bron.jsx (islandcn uit island/ + React) tot één ES-module voor de site. Gebruik: ./bouw.sh [uitvoerbestand]
set -e
cd "$(dirname "$0")"
[ -d node_modules ] || npm install --no-audit --no-fund
npx esbuild bron.jsx --bundle --format=esm --minify --jsx=automatic --target=chrome100,safari15 \
  --define:process.env.NODE_ENV='"production"' --legal-comments=eof --log-override:unsupported-directive=silent \
  --outfile="${1:-../public/eiland.js}"
