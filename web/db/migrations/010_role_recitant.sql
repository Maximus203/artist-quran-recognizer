-- @foreign_keys_off
-- 010 : rôle « récitateur » (enregistre et exporte sa vidéo, interface réduite).
--
-- SQLite ne sait pas élargir un CHECK : on reconstruit `users` (procédure officielle en 12 étapes).
-- Le marqueur ci-dessus demande au runner de couper les clés étrangères HORS transaction : sans cela,
-- DROP TABLE users déclencherait les ON DELETE CASCADE (sessions, préférences, jetons) et les viderait.
-- Le runner contrôle ensuite `foreign_key_check` avant de valider.
CREATE TABLE users_new (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  username        TEXT NOT NULL,
  username_key    TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin', 'recitant')),
  disabled_at     TEXT,
  created_at      TEXT NOT NULL,
  last_login_at   TEXT,
  avatar_hash     TEXT,
  avatar_updated_at TEXT
);
INSERT INTO users_new (id, username, username_key, password_hash, role, disabled_at, created_at, last_login_at, avatar_hash, avatar_updated_at)
  SELECT id, username, username_key, password_hash, role, disabled_at, created_at, last_login_at, avatar_hash, avatar_updated_at FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

-- Rôle choisi sur une invitation : testeur (par défaut) ou récitateur. Les anciennes invitations restent testeur.
ALTER TABLE invitations ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'recitant'));
