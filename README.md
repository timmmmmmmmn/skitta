# Skitta

Chatten, bellen en videobellen met je vrienden, in de look van de klassieke messenger op Windows 7:
[skitta.timvanbergen.nl](https://skitta.timvanbergen.nl).

- Iedereen kan een account maken; de eerste gebruiker wordt beheerder
- Contactpersonen toevoegen met een verzoek, online-status (Online, Afwezig, Niet storen, Onzichtbaar), stemmingsbericht en profielfoto
- Chatten één-op-één en in groepen, live, met "is aan het typen", emoticons, citeren, bewerken en verwijderen
- Foto's versturen (knop, slepen of plakken)
- Bellen en videobellen één-op-één (WebRTC), met de originele geluidjes
- **End-to-end versleuteld**: berichten en foto's worden in de browser versleuteld; de server en de database zien alleen onleesbare gegevens. Bellen is peer-to-peer en ook versleuteld (WebRTC)
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

## Versleuteling

- Uit het wachtwoord leidt de browser met PBKDF2-SHA256 (600.000 rondes, salt per gebruiker) 512 bits af:
  de eerste helft is de **inlogcode** die naar de server gaat (de server bewaart daar een hash van), de
  tweede helft is de **wachtwoordsleutel** die het apparaat nooit verlaat. Het wachtwoord zelf komt dus
  nooit bij de server.
- Iedere gebruiker heeft één ECDH-sleutelpaar (P-256). Het geheime deel staat versleuteld met de
  wachtwoordsleutel in de database, zodat je op elk apparaat met alleen je wachtwoord alles kunt lezen.
  Op het apparaat staat het als niet-exporteerbare sleutel in IndexedDB; bij afmelden wordt het gewist.
- Elk gesprek heeft een gesprekssleutel (AES-256-GCM, met versies), per lid ingepakt met diens publieke
  sleutel (ECDH + HKDF). Verlaat iemand een groep, dan maakt de volgende afzender een nieuwe versie.
  Nieuwe leden en mensen met een nieuw sleutelpaar krijgen de oude versies van een medelid dat online is.
- Elk bericht en elke foto heeft een eigen berichtsleutel, ingepakt met de gesprekssleutel. Bij een
  melding geeft de melder alleen die berichtsleutel mee; de server controleert de tekst daarmee, zodat de
  beheerder alleen dat ene bericht ziet.
- Wachtwoord vergeten en gereset door de beheerder: je krijgt een nieuw sleutelpaar. Je oude berichten
  worden weer leesbaar zodra iemand uit dat gesprek online is geweest.
- Niet versleuteld (metadata): wie met wie praat en wanneer, groepsonderwerpen, gesprekslogboek
  (duur van gesprekken), namen, stemmingsberichten en profielfoto's.
- Zoals bij elke webapp met versleuteling vertrouw je erop dat de server de echte app-code levert.

## API voor de latere apps

Desktop- (Rust) en Android-apps gebruiken dezelfde API en dezelfde versleuteling (zie `E2E` in
`public/app.js`): `POST /api/prelogin` geeft de salt, daarna `POST /api/login` met de inlogcode en
`"app": true`; dat geeft een `token` terug in plaats van een cookie. Stuur die mee als
`Authorization: Bearer <token>`, ook bij de WebSocket op `/api/ws?dev=<apparaat-id>`.

## Ontwikkelen

```sh
echo DEV=1 > .dev.vars   # lokaal geen doorverwijzing naar https
npx wrangler d1 migrations apply DB --local
npx wrangler dev
```

Online zetten: `npx wrangler d1 migrations apply DB --remote` (bij een nieuwe migratie) en `npx wrangler deploy`.
