-- Skitta: accounts, contactpersonen, gesprekken, berichten, foto's en meldingen.

-- Iedereen kan een account maken; de eerste gebruiker wordt beheerder.
-- presence is wat de gebruiker zelf kiest; of hij echt online is weet de Hub (Durable Object).
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  mood          TEXT NOT NULL DEFAULT '',
  presence      TEXT NOT NULL DEFAULT 'online' CHECK (presence IN ('online', 'away', 'dnd', 'invisible')),
  avatar_id     TEXT,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  is_admin      INTEGER NOT NULL DEFAULT 0,
  warnings      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  last_seen     INTEGER
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- Contactpersonen: per richting een rij. state: 'out' (verzoek verstuurd), 'in' (verzoek ontvangen),
-- 'ok' (geaccepteerd), 'blocked' (user_id heeft contact_id geblokkeerd).
CREATE TABLE contacts (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state      TEXT NOT NULL CHECK (state IN ('out', 'in', 'ok', 'blocked')),
  message    TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, contact_id)
);
CREATE INDEX idx_contacts_contact ON contacts(contact_id);

-- Gesprekken: 'direct' (twee personen, direct_key = "kleinste:grootste") of 'group'.
CREATE TABLE conversations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL CHECK (kind IN ('direct', 'group')),
  topic      TEXT NOT NULL DEFAULT '',
  direct_key TEXT UNIQUE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  last_at    INTEGER NOT NULL
);

CREATE TABLE members (
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at       INTEGER NOT NULL,
  left_at         INTEGER,
  last_read       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX idx_members_user ON members(user_id);

-- kind: 'text', 'photo', 'call' (body = JSON met duur/gemist), 'system' (body = JSON met gebeurtenis).
-- removed = 1: afgekeurd door de beheerder.
CREATE TABLE messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('text', 'photo', 'call', 'system')),
  body            TEXT NOT NULL DEFAULT '',
  media_id        TEXT,
  client_id       TEXT,
  created_at      INTEGER NOT NULL,
  edited_at       INTEGER,
  deleted_at      INTEGER,
  removed         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_messages_conv ON messages(conversation_id, id);

-- Foto's en profielfoto's. Zonder R2 staat de afbeelding als BLOB in data, met R2 in de bucket (in_r2 = 1).
CREATE TABLE media (
  id              TEXT PRIMARY KEY,
  owner_id        INTEGER REFERENCES users(id) ON DELETE CASCADE,
  conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE,
  mime            TEXT NOT NULL,
  size            INTEGER NOT NULL,
  width           INTEGER,
  height          INTEGER,
  in_r2           INTEGER NOT NULL DEFAULT 0,
  data            BLOB,
  created_at      INTEGER NOT NULL
);

-- Meldingen. De tekst wordt bij het melden vastgelegd, zodat de beheerder ziet wat er stond.
-- status: 'open', 'goed' (bericht mag blijven) of 'fout' (bericht verwijderd).
CREATE TABLE reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id  INTEGER REFERENCES messages(id) ON DELETE SET NULL,
  reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  sender_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reason      TEXT NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  snapshot    TEXT NOT NULL DEFAULT '',
  media_id    TEXT,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'goed', 'fout')),
  action      TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  resolved_at INTEGER,
  resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (message_id, reporter_id)
);
CREATE INDEX idx_reports_status ON reports(status, created_at);

-- Instellingen voor de hele site (mededeling, registratie open/dicht).
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE attempts (
  key TEXT NOT NULL,
  at  INTEGER NOT NULL
);
CREATE INDEX idx_attempts ON attempts(key, at);
