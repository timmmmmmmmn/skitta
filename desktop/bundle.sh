#!/bin/sh
# Bouwt Skitta.app (macOS). Windows: `cargo build --release` geeft target/release/skitta.exe.
set -e
cd "$(dirname "$0")"
cargo build --release
APP=target/Skitta.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp target/release/skitta "$APP/Contents/MacOS/Skitta"

# Icoon (.icns) uit het Skitta-icoon
SET=target/Skitta.iconset
rm -rf "$SET"; mkdir -p "$SET"
for s in 16 32 128 256 512; do
  sips -z $s $s ../icon-transparent.png --out "$SET/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2)); sips -z $d $d ../icon-transparent.png --out "$SET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$SET" -o "$APP/Contents/Resources/Skitta.icns"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Skitta</string>
  <key>CFBundleDisplayName</key><string>Skitta</string>
  <key>CFBundleIdentifier</key><string>nl.timvanbergen.skitta</string>
  <key>CFBundleExecutable</key><string>Skitta</string>
  <key>CFBundleIconFile</key><string>Skitta</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSMicrophoneUsageDescription</key><string>Skitta gebruikt de microfoon voor bellen en spraakberichten.</string>
  <key>NSCameraUsageDescription</key><string>Skitta gebruikt de camera voor videobellen.</string>
</dict>
</plist>
PLIST
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true
echo "Klaar: $APP"
