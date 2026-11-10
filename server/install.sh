#!/bin/sh
# Installeert de Skitta-bestandsserver op een Linux-server, als gewone gebruiker (geen sudo nodig):
# Rust (indien nodig) -> bouwen -> ~/.local/bin, geheim in ~/.config, opslag in ~/skitta-bestanden,
# en een systemd-gebruikersservice. Daarna (stap 2) een Cloudflare Tunnel naar bestanden.timvanbergen.nl.
#
#   sh install.sh            bouwen en server starten
#   sh install.sh tunnel     tunnel instellen (eenmalig inloggen bij Cloudflare via een link)
set -eu
cd "$(dirname "$0")"
BIN="$HOME/.local/bin"
CONF="$HOME/.config/skitta-bestanden.env"
UNIT="$HOME/.config/systemd/user"
HOSTNAME_PUBLIC="bestanden.timvanbergen.nl"
mkdir -p "$BIN" "$UNIT" "$HOME/skitta-bestanden" "$HOME/.config"

if [ "${1:-}" = "tunnel" ]; then
  if [ ! -x "$BIN/cloudflared" ]; then
    case "$(uname -m)" in
      x86_64) A=amd64 ;; aarch64) A=arm64 ;; armv7l) A=arm ;; *) echo "Onbekende processor"; exit 1 ;;
    esac
    curl -fsSL -o "$BIN/cloudflared" "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$A"
    chmod +x "$BIN/cloudflared"
  fi
  [ -f "$HOME/.cloudflared/cert.pem" ] || "$BIN/cloudflared" tunnel login
  "$BIN/cloudflared" tunnel list | grep -q skitta-bestanden || "$BIN/cloudflared" tunnel create skitta-bestanden
  ID=$("$BIN/cloudflared" tunnel list | awk '/skitta-bestanden/ {print $1}')
  cat > "$HOME/.cloudflared/config.yml" <<EOF
tunnel: $ID
credentials-file: $HOME/.cloudflared/$ID.json
ingress:
  - hostname: $HOSTNAME_PUBLIC
    service: http://127.0.0.1:8090
  - service: http_status:404
EOF
  "$BIN/cloudflared" tunnel route dns skitta-bestanden "$HOSTNAME_PUBLIC" || true
  cat > "$UNIT/skitta-tunnel.service" <<EOF
[Unit]
Description=Cloudflare Tunnel voor de Skitta-bestandsserver
After=network-online.target

[Service]
ExecStart=$BIN/cloudflared --no-autoupdate tunnel run skitta-bestanden
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now skitta-tunnel
  echo "Tunnel draait: https://$HOSTNAME_PUBLIC"
  exit 0
fi

# Rust
if ! command -v cargo >/dev/null 2>&1 && [ ! -x "$HOME/.cargo/bin/cargo" ]; then
  curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal
fi
PATH="$HOME/.cargo/bin:$PATH"
cargo build --release
install -m755 target/release/skitta-bestanden "$BIN/skitta-bestanden"

# Geheim (gedeeld met de Skitta-Worker), alleen leesbaar voor jou
if [ ! -f "$CONF" ]; then
  umask 077
  printf 'SKITTA_FILES_SECRET=%s\n' "$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')" > "$CONF"
fi
chmod 600 "$CONF"

cat > "$UNIT/skitta-bestanden.service" <<EOF
[Unit]
Description=Skitta-bestandsserver (grote, versleutelde bijlagen)
After=network-online.target

[Service]
EnvironmentFile=$CONF
Environment=SKITTA_FILES_DIR=$HOME/skitta-bestanden
Environment=SKITTA_FILES_LISTEN=127.0.0.1:8090
Environment=SKITTA_FILES_MAX_GB=${SKITTA_FILES_MAX_GB:-50}
ExecStart=$BIN/skitta-bestanden
Restart=always
NoNewPrivileges=yes
PrivateTmp=yes
MemoryMax=256M

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now skitta-bestanden
systemctl --user restart skitta-bestanden
# Blijft draaien als je niet bent ingelogd (lukt dit niet: eenmalig `sudo loginctl enable-linger $USER`).
loginctl enable-linger "$USER" 2>/dev/null || echo "Let op: voer eenmalig uit: sudo loginctl enable-linger $USER"
sleep 1
systemctl --user is-active skitta-bestanden
