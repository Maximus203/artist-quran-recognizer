-- 003 : jetons d'API et de MCP.
--
-- Un jeton identifie une application ou un agent qui agit AU NOM d'un compte (il en a les droits,
-- jamais plus : ni administration, ni gestion des jetons). Seule l'empreinte SHA-256 est gardée :
-- le jeton lui-même n'est montré qu'une fois, à sa création. `prefix` (les 8 premiers caractères
-- après « qtr_ ») permet de le reconnaître dans la liste sans le révéler.
CREATE TABLE api_tokens (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT    NOT NULL,
  prefix       TEXT    NOT NULL,
  token_hash   TEXT    NOT NULL UNIQUE,
  scope        TEXT    NOT NULL CHECK (scope IN ('read', 'write')),
  created_at   TEXT    NOT NULL,
  expires_at   TEXT,
  last_used_at TEXT,
  revoked_at   TEXT
);
CREATE INDEX api_tokens_user ON api_tokens(user_id);
