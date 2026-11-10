-- Grote bijlagen (> 8 MB) staan op een eigen server (zie server/), niet bij Cloudflare.
-- De server krijgt alleen versleutelde bytes; deze tabel bepaalt wie ze mag ophalen en tot wanneer.
CREATE TABLE bigfiles (
  id              TEXT PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  owner_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  size            INTEGER NOT NULL,
  created_at      INTEGER NOT NULL,
  expires_at      INTEGER NOT NULL
);
CREATE INDEX idx_bigfiles_expire ON bigfiles(expires_at);
