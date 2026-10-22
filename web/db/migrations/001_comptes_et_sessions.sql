-- 001 : comptes, jetons de connexion, préférences et métadonnées des sessions.
--
-- Principe : la base porte les MÉTADONNÉES (qui, quoi, visibilité, tri, comptage). Les fichiers
-- lourds (audio, résultat de reconnaissance, revue, révisions) restent sur le disque, dans
-- <AQR_REVIEW_DIR>/sessions/<id>/, et `session.json` reste la source de vérité de l'état d'une
-- analyse : les colonnes « miroir » de session_meta (state, engine, durées…) sont réécrites à
-- chaque écriture de session.json (voir lib/session-index.ts).
--
-- Dates : ISO 8601 UTC en texte (« 2026-10-22T17:51:03.120Z »), triables telles quelles.
-- Booléens : absents ; une date NULL / non NULL porte l'information (archived_at, disabled_at).

-- ── Comptes ────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Pseudonyme tel que saisi (2–24 caractères, jamais une adresse e-mail) : il signe les revues.
  username      TEXT NOT NULL,
  -- Forme normalisée (NFKC, minuscules, espaces repliés) : unicité insensible à la casse.
  username_key  TEXT NOT NULL UNIQUE,
  -- `scrypt$N$r$p$<sel b64>$<empreinte b64>` : les paramètres voyagent avec l'empreinte.
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  -- Compte désactivé : connexion refusée, jetons révoqués, mais ses revues et sessions restent.
  disabled_at   TEXT,
  created_at    TEXT NOT NULL,
  last_login_at TEXT
);

-- ── Connexions (cookie `aqr_session`) ──────────────────────────────────────────────────────────
-- Le jeton (256 bits aléatoires) n'est JAMAIS stocké : seulement son SHA-256. Une fuite de la
-- base ne donne donc aucune connexion utilisable.
CREATE TABLE auth_sessions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash   TEXT NOT NULL UNIQUE,
  user_id      INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  -- Expiration glissante (repoussée à l'usage, plafonnée à created_at + durée maximale).
  expires_at   TEXT NOT NULL
);
CREATE INDEX idx_auth_sessions_user ON auth_sessions (user_id);
CREATE INDEX idx_auth_sessions_expires ON auth_sessions (expires_at);

-- ── Préférences par utilisateur (une ligne par clé : horodatage par clé) ───────────────────────
CREATE TABLE preferences (
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  -- Valeur en JSON ; validée à la lecture par lib/preferences.ts (jamais fiable).
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);

-- ── Sessions : métadonnées + miroir de l'état ──────────────────────────────────────────────────
CREATE TABLE session_meta (
  -- Identifiant de session existant (UUID) = nom du dossier sur le disque.
  id               TEXT PRIMARY KEY,
  -- NULL = session d'avant les comptes. Utilisateur supprimé : la session reste, orpheline.
  owner_id         INTEGER REFERENCES users (id) ON DELETE SET NULL,
  -- Nom affiché ; `name_source` dit s'il vient du nom de fichier (auto) ou d'un choix (user).
  name             TEXT NOT NULL,
  name_source      TEXT NOT NULL DEFAULT 'auto' CHECK (name_source IN ('auto', 'user')),
  -- Nom de fichier d'origine (jamais modifié) : sert à régénérer le nom par défaut et à chercher.
  original_name    TEXT NOT NULL,
  source_kind      TEXT NOT NULL DEFAULT 'file' CHECK (source_kind IN ('file', 'microphone')),
  -- Contenu reconnu (« Yusuf 12:11–31 »), calculé à la fin de l'analyse ; NULL avant.
  content_label    TEXT,
  -- global : visible de tous les testeurs connectés ; private : de son propriétaire seul.
  visibility       TEXT NOT NULL DEFAULT 'global' CHECK (visibility IN ('global', 'private')),
  archived_at      TEXT,
  -- Miroir de session.json (réécrit à chaque sauvegarde) :
  state            TEXT NOT NULL DEFAULT 'ready'
                   CHECK (state IN ('ready', 'queued', 'running', 'done', 'failed', 'cancelled')),
  engine           TEXT,
  started_at       TEXT,
  finished_at      TEXT,
  audio_duration_s REAL,
  duration_s       REAL,
  -- Taille du fichier envoyé (sert au quota) / taille de tout le dossier de session (disque).
  size_bytes       INTEGER NOT NULL DEFAULT 0,
  disk_bytes       INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  -- Texte normalisé (minuscules, sans accents) pour la recherche et le tri par nom.
  search_text      TEXT NOT NULL DEFAULT '',
  sort_name        TEXT NOT NULL DEFAULT ''
);
-- Pagination par curseur (keyset) : chaque tri a son index, l'identifiant départage les égalités.
CREATE INDEX idx_meta_created ON session_meta (created_at, id);
CREATE INDEX idx_meta_owner_created ON session_meta (owner_id, created_at, id);
CREATE INDEX idx_meta_visibility_created ON session_meta (visibility, created_at, id);
CREATE INDEX idx_meta_name ON session_meta (sort_name, id);
CREATE INDEX idx_meta_state ON session_meta (state);
CREATE INDEX idx_meta_engine ON session_meta (engine);

-- ── Favoris et « non lu » : par utilisateur ────────────────────────────────────────────────────
CREATE TABLE favorites (
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES session_meta (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, session_id)
);
CREATE INDEX idx_favorites_session ON favorites (session_id);

-- Dernière ouverture du résultat par un utilisateur : une session terminée est « non lue » pour
-- son propriétaire tant qu'il n'a pas de ligne ici postérieure à la fin de l'analyse.
CREATE TABLE views (
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES session_meta (id) ON DELETE CASCADE,
  viewed_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, session_id)
);

-- ── Journal des analyses : « nombre de tests », durées et tailles par utilisateur ──────────────
-- Une ligne par analyse terminée (réussie ou en échec), idempotente (session_id unique) et
-- conservée même si la session est supprimée ensuite : l'historique d'usage ne se perd pas.
CREATE TABLE analysis_log (
  session_id       TEXT PRIMARY KEY,
  user_id          INTEGER REFERENCES users (id) ON DELETE SET NULL,
  engine           TEXT,
  outcome          TEXT NOT NULL CHECK (outcome IN ('done', 'failed')),
  audio_duration_s REAL,
  duration_s       REAL,
  size_bytes       INTEGER NOT NULL DEFAULT 0,
  finished_at      TEXT NOT NULL
);
CREATE INDEX idx_analysis_user ON analysis_log (user_id, finished_at);
