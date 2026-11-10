# Skitta

Chatten, bellen en videobellen met je vrienden, in de look van de klassieke messenger op Windows 7:
[skitta.timvanbergen.nl](https://skitta.timvanbergen.nl).

- Iedereen kan een account maken; de eerste gebruiker wordt beheerder
- Contactpersonen toevoegen met een verzoek, online-status (Online, Afwezig, Niet storen, Onzichtbaar), stemmingsbericht en profielfoto
- Chatten één-op-één en in groepen, live, met "is aan het typen", emoticons, citeren, bewerken en verwijderen
- Foto's versturen (knop, slepen of plakken)
- Bellen en videobellen één-op-één (WebRTC), met de originele geluidjes
- Foto's, video's (worden eerst verkleind), spraakberichten en bestanden; "Gezien"; zoeken in een gesprek
- Zes thema's: Windows 7, Windows XP, Blauwe balk, Mac OS X, Windows 8 en Modern
- Meldingen: pushmeldingen op iPhone (beginscherm-app), Android Chrome en desktopbrowsers; eigen meldingen in de apps
- Apps: Android (`android/`, glazen navigatie) en Windows/macOS (`desktop/`, Rust)
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

### Kosten: altijd gratis

Alles draait op het gratis deel van Cloudflare. `src/limits.js` houdt het verbruik per maand bij en
weigert netjes voordat een grens bereikt is (ongeveer de helft van het gratis deel):

| Wat | Grens in Skitta | Gratis bij Cloudflare |
| --- | --- | --- |
| Bijlagen opgeslagen (R2) | 7 GB | 10 GB |
| Bijlagen opslaan per maand | 500.000 | 1 miljoen |
| Bijlagen laden per maand (zonder cache) | 5 miljoen | 10 miljoen |
| Bellen via TURN per maand | 400 GB | 1000 GB |
| Uploads per persoon per dag | 50 MB | – |
| Grootte per bijlage | 1 MB (groter: eigen bestandsserver) | – |

Foto's worden verkleind (max. 1600 px), video's opnieuw gecodeerd (max. 960 px, ~700 kbit/s, 3 minuten),
spraakberichten op 32 kbit/s. Bijlagen worden uit de edge-cache geladen. Via TURN gaat video op lagere
kwaliteit. In het beheer staat het verbruik, en je kunt oude bijlagen opruimen.

TURN: `npx wrangler secret put TURN_KEY_ID` en `npx wrangler secret put TURN_KEY_TOKEN` (de waarden uit
Cloudflare → Realtime → TURN).

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

## Apps

- **Android** (`android/`): de site in een WebView met de glazen navigatie en menu's (Android 13+).
  Een achtergrondverbinding (`SkittaService`) geeft meldingen als de app dicht is, zonder Google-diensten.
  Bouwen: `./gradlew assembleRelease -PbuildNumber=N` (sleutel in ~/AndroidStudioProjects/skitta-release.*),
  APK naar `public/download/Skitta.apk` en `public/download/android.json` ophogen: de app werkt zichzelf bij.
- **Windows en macOS** (`desktop/`): Rust met wry/tao. Venster dicht = systeemvak; na een minuut alleen nog
  een kleine Rust-verbinding voor meldingen. Mac: `desktop/install.sh`. Windows: `cargo build --release`
  op Windows, of de workflow in `.github/workflows/apps.yml`.
- **iPhone**: Safari → Deel → Zet op beginscherm; daarna meldingen aanzetten in Skitta Home.

## Ontwikkelen

```sh
echo DEV=1 > .dev.vars   # lokaal geen doorverwijzing naar https
npx wrangler d1 migrations apply DB --local
npx wrangler dev
```

Online zetten: `npx wrangler d1 migrations apply DB --remote` (bij een nieuwe migratie) en `npx wrangler deploy`.
