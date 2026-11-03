-- 006 : agents du moteur d'analyse à distance (ADR-0017).
--
-- Un agent est un programme sur une machine à GPU qui réclame des analyses. Son jeton (`qea_` + 256 bits) n'est
-- jamais stocké : seule l'empreinte SHA-256 l'est. Un agent révoqué ne peut plus rien réclamer.
CREATE TABLE engine_agents (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  token_hash   TEXT    NOT NULL UNIQUE,
  prefix       TEXT    NOT NULL,
  created_by   INTEGER NOT NULL REFERENCES users(id),
  created_at   TEXT    NOT NULL,
  last_seen_at TEXT,
  revoked_at   TEXT
);
