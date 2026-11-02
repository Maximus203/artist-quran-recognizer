-- 009 : index des exports vidéo gardés sur le serveur, par session.
--
-- Les fichiers restent dans <session>/videos/ (voir lib/video-library.ts) : cette table n'en est qu'un
-- INDEX, pour compter les exports d'une session dans la liste sans lire le disque, et pour savoir ce
-- qui est « nouveau » pour celui qui l'a lancé (un export terminé pendant son absence).
-- Une ligne par vidéo gardée ; supprimée avec la vidéo ou avec la session.
CREATE TABLE exports (
  -- Identifiant de la vidéo = nom de fichier (<id>.mp4 / <id>.json).
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES session_meta (id) ON DELETE CASCADE,
  -- Qui a lancé l'export (NULL : vidéo d'avant cette migration, rattachée au propriétaire de la session).
  owner_id    INTEGER REFERENCES users (id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  bytes       INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  -- Vu par celui qui l'a lancé (liste des exports ouverte). NULL = nouveau pour lui.
  seen_at     TEXT
);
CREATE INDEX idx_exports_session ON exports (session_id);
CREATE INDEX idx_exports_owner_unseen ON exports (owner_id, seen_at);
