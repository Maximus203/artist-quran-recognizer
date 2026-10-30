-- 007 : invitations de testeurs.
--
-- Une invitation est un lien (`/access?invitation=inv_…`) qu'un administrateur remet à UNE personne : il ouvre l'accès
-- à l'atelier (comme le jeton d'accès, mais révocable et limité dans le temps) et autorise un nombre limité
-- d'inscriptions. Le jeton (`inv_` + 128 bits) n'est jamais stocké : seule son empreinte SHA-256 l'est.
CREATE TABLE invitations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  label        TEXT    NOT NULL,
  token_hash   TEXT    NOT NULL UNIQUE,
  prefix       TEXT    NOT NULL,
  created_by   INTEGER NOT NULL REFERENCES users(id),
  created_at   TEXT    NOT NULL,
  expires_at   TEXT    NOT NULL,
  max_uses     INTEGER NOT NULL CHECK (max_uses BETWEEN 1 AND 20),
  uses         INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  revoked_at   TEXT
);
