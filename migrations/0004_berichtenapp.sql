-- Functies van een volwaardige berichtenapp.

-- Reacties (emoji), end-to-end versleuteld zoals berichten: body is een versleutelde envelop.
CREATE TABLE reactions (
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id)
);

-- Berichten die iemand alleen voor zichzelf heeft verwijderd.
CREATE TABLE hidden (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, message_id)
);

-- Per persoon per gesprek: dempen, vastpinnen, archiveren.
ALTER TABLE members ADD COLUMN muted_until INTEGER NOT NULL DEFAULT 0;
ALTER TABLE members ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE members ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;

-- Verdwijnende berichten: na zoveel seconden weg (0 = uit). Een cron-taak ruimt ze op.
ALTER TABLE conversations ADD COLUMN expire INTEGER NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN expires_at INTEGER;
CREATE INDEX idx_messages_expire ON messages(expires_at) WHERE expires_at IS NOT NULL;

-- Privacy: leesbevestigingen delen (net als bij Signal wederzijds: uit = je ziet ze ook niet van anderen).
ALTER TABLE users ADD COLUMN read_receipts INTEGER NOT NULL DEFAULT 1;
