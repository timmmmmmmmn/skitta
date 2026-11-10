# Skitta-bestandsserver

Bewaart grote bijlagen (vanaf 8 MB, tot 1 GB) op je eigen server in plaats van bij Cloudflare.
De bestanden zijn al in de browser versleuteld: deze server ziet alleen onleesbare bytes.
Uploaden en downloaden kan alleen met een token van 10–60 minuten dat de Skitta-Worker ondertekent.
Bestanden vanaf 50 MB worden na 7 dagen verwijderd, kleinere na 90 dagen.

## Installeren op Arch Linux

```sh
sudo pacman -S --needed rust caddy
git clone <repo> && cd skitta/server
cargo build --release
sudo install -m755 target/release/skitta-bestanden /usr/local/bin/
openssl rand -hex 32                        # dit is het geheim, bewaar het
echo "SKITTA_FILES_SECRET=<het geheim>" | sudo tee /etc/skitta-bestanden.env
sudo chmod 600 /etc/skitta-bestanden.env
sudo install -m644 skitta-bestanden.service /etc/systemd/system/
sudo systemctl enable --now skitta-bestanden
```

## Bereikbaar maken via https

De server luistert alleen op 127.0.0.1:8090. Kies één van beide:

**A. Caddy met poort 443 open in je router** (verkeer gaat niet via Cloudflare):
DNS-record `bestanden.timvanbergen.nl` → je thuis-IP, *zonder* oranje wolkje (DNS only).
`/etc/caddy/Caddyfile`:

```
bestanden.timvanbergen.nl {
    reverse_proxy 127.0.0.1:8090
    request_body {
        max_size 1100MB
    }
}
```

`sudo systemctl enable --now caddy` (Caddy regelt het certificaat zelf).

**B. Cloudflare Tunnel** (geen poort openzetten, gratis): `cloudflared tunnel` met
`bestanden.timvanbergen.nl` → `http://127.0.0.1:8090`. Let op: uploads via Cloudflare zijn max. 100 MB per verzoek.

## Skitta koppelen

```sh
cd skitta
npx wrangler secret put FILES_SECRET     # hetzelfde geheim
# in wrangler.toml onder [vars]: FILES_URL = "https://bestanden.timvanbergen.nl"
npx wrangler deploy
```
