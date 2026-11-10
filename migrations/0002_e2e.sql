-- End-to-end-versleuteling.
-- De browser leidt uit het wachtwoord (PBKDF2 met kdf_salt) twee dingen af: een inlogcode die naar de
-- server gaat (password_hash is daar de hash van) en een sleutel die het apparaat nooit verlaat.
-- Met die sleutel is enc_privkey versleuteld: het geheime deel van het ECDH-sleutelpaar (P-256).
-- kdf_v = 0: oud account dat nog met het wachtwoord zelf inlogt; wordt bij de volgende keer inloggen omgezet.
ALTER TABLE users ADD COLUMN kdf_salt TEXT;
ALTER TABLE users ADD COLUMN kdf_v INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN pubkey TEXT;
ALTER TABLE users ADD COLUMN enc_privkey TEXT;

-- Elk gesprek heeft een gesprekssleutel (AES-256), per lid versleuteld met diens publieke sleutel.
-- key_version 0 = nog geen sleutel. rotate = 1: iemand heeft de groep verlaten, de volgende afzender
-- maakt een nieuwe sleutel zodat diegene nieuwe berichten niet meer kan lezen.
ALTER TABLE conversations ADD COLUMN key_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversations ADD COLUMN rotate INTEGER NOT NULL DEFAULT 0;

CREATE TABLE conv_keys (
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version         INTEGER NOT NULL,
  wrapped         TEXT NOT NULL,
  pubkey          TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, user_id, version)
);
CREATE INDEX idx_conv_keys_user ON conv_keys(user_id);

-- enc = 1: body is versleuteld (JSON met de berichtsleutel, ingepakt met de gesprekssleutel).
ALTER TABLE messages ADD COLUMN enc INTEGER NOT NULL DEFAULT 0;
-- enc = 1: de foto zelf is versleuteld met de berichtsleutel.
ALTER TABLE media ADD COLUMN enc INTEGER NOT NULL DEFAULT 0;
-- Bij een melding geeft de melder alleen de sleutel van dat ene bericht mee.
ALTER TABLE reports ADD COLUMN msg_key TEXT;
