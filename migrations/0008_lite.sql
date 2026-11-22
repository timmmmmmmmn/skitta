-- Skitta Lite: lichte accounts zonder end-to-end-sleutels (snel inloggen op bijvoorbeeld een Lumia).
-- Gesprekken met een Lite-gebruiker zijn daarom niet versleuteld; de Skitta-app laat dat zien.
ALTER TABLE users ADD COLUMN lite INTEGER NOT NULL DEFAULT 0;
