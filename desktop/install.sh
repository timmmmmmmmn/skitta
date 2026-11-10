#!/bin/sh
# Bouwt Skitta.app en zet hem in /Programma's (/Applications).
set -e
cd "$(dirname "$0")"
./bundle.sh
pkill -x Skitta 2>/dev/null || true
rm -rf /Applications/Skitta.app
cp -R target/Skitta.app /Applications/
echo "Geïnstalleerd: /Applications/Skitta.app"
