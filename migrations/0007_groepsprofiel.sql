-- Groepen krijgen een eigen afbeelding en een beschrijving.
ALTER TABLE conversations ADD COLUMN avatar_id TEXT;
ALTER TABLE conversations ADD COLUMN about TEXT NOT NULL DEFAULT '';
