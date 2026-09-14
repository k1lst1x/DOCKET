-- Email and password accounts replace emailed one-time codes. password_hash holds
-- "scrypt$N$r$p$salt$hash" (src/lib/passwords.ts). Members who signed in with a code
-- before have no hash yet; registering with their email sets one. Nullable because
-- DSQL can't add a NOT NULL column to an existing table.
ALTER TABLE members ADD COLUMN IF NOT EXISTS password_hash text;
