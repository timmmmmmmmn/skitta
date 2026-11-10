-- Verbruik per maand, zodat Skitta ruim binnen de gratis limieten van Cloudflare blijft.
-- key bijv. 'r2_write:2026-11', 'r2_read:2026-11', 'turn_bytes:2026-11', 'upload:<user>:2026-11-10'.
CREATE TABLE usage (
  key TEXT PRIMARY KEY,
  n   INTEGER NOT NULL DEFAULT 0
);

-- Pushmeldingen (Web Push: iPhone-beginscherm, Android Chrome, desktopbrowsers).
CREATE TABLE push_subs (
  endpoint   TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_push_user ON push_subs(user_id);
