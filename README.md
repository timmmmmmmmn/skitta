# Skitta

Chatten, bellen en videobellen met je vrienden, in de look van de klassieke messenger op Windows 7:
[skitta.timvanbergen.nl](https://skitta.timvanbergen.nl).

- Iedereen kan een account maken; de eerste gebruiker wordt beheerder
- Contactpersonen toevoegen met een verzoek, online-status (Online, Afwezig, Niet storen, Onzichtbaar), stemmingsbericht en profielfoto
- Chatten één-op-één en in groepen, live, met "is aan het typen", emoticons, citeren, bewerken en verwijderen
- Foto's versturen (knop, slepen of plakken)
- Bellen en videobellen één-op-één (WebRTC), met de originele geluidjes
- Berichten melden; de beheerder keurt ze goed of fout op [/beheer](https://skitta.timvanbergen.nl/beheer)
- Beheer: meldingen, gebruikers (blokkeren, beheerder maken, wachtwoord resetten, verwijderen), mededeling op Skitta Home, registratie open/dicht

## Opbouw

| Map | Wat |
| --- | --- |
| `src/worker.js` | Cloudflare Worker: de JSON-API (`/api/...`) |
| `src/hub.js` | Durable Object "Hub": WebSockets voor live berichten, online-status, typen en bel-signalen |
| `migrations/` | D1-database `skitta-db` (accounts, contacten, gesprekken, berichten, meldingen) |
| `public/` | De website (geen build-stap); `public/beheer/` is het beheer |
| `public/sounds/` | De geluidjes |

### Opslag

- **Tekst**: D1. Ruim genoeg: ook het gratis plan (500 MB per database) past miljoenen berichten.
- **Foto's**: zonder R2 als BLOB in D1 (max. 1,5 MB per foto, de app verkleint foto's tot 1600 px).
  Dat is prima om mee te beginnen, maar D1 raakt vol bij een paar duizend foto's. Zet daarom R2 aan
  (10 GB gratis, geen kosten voor downloaden):
  1. Cloudflare-dashboard → R2 → aanzetten
  2. `npx wrangler r2 bucket create skitta-media`
  3. In `wrangler.toml` het `[[r2_buckets]]`-blok aanzetten en `npx wrangler deploy`

  Nieuwe foto's gaan dan naar R2; oude foto's blijven gewoon uit D1 komen.
- **Bellen**: peer-to-peer met STUN van Cloudflare. Achter strenge netwerken (sommige 4G-providers,
  bedrijfsnetwerken) is een TURN-server nodig. Maak in het Cloudflare-dashboard bij Realtime → TURN een
  sleutel aan (1000 GB per maand gratis) en zet die als secrets:
  `npx wrangler secret put TURN_KEY_ID` en `npx wrangler secret put TURN_KEY_TOKEN`.

## API voor de latere apps

Desktop- (Rust) en Android-apps kunnen dezelfde API gebruiken: `POST /api/login` met `"app": true`
geeft een `token` terug in plaats van een cookie; stuur die mee als `Authorization: Bearer <token>`,
ook bij de WebSocket op `/api/ws?dev=<apparaat-id>`.

## Ontwikkelen

```sh
npx wrangler d1 migrations apply DB --local
npx wrangler dev
```

Online zetten: `npx wrangler d1 migrations apply DB --remote` (bij een nieuwe migratie) en `npx wrangler deploy`.
