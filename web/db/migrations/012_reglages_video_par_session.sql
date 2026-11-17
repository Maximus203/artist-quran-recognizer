-- 012 : réglages de l'éditeur d'export vidéo, mémorisés PAR VIDÉO (par session) et par compte.
--
-- Avant : un seul jeu de réglages par compte (préférence `videoPrefs`), partagé par toutes les vidéos : changer
-- l'une changeait les autres. Désormais une ligne par (compte, session) ; le réglage global du compte ne sert plus
-- que de point de départ à une vidéo jamais personnalisée.
-- Migration ADDITIVE : aucune table existante n'est touchée ni reconstruite ; sans ligne, la vidéo retombe sur le
-- comportement d'avant (réglages du compte). `prefs` est du JSON validé à l'écriture (`session-video-prefs.ts`).
-- Supprimée avec la session ou avec le compte.
CREATE TABLE session_video_prefs (
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  session_id TEXT    NOT NULL REFERENCES session_meta (id) ON DELETE CASCADE,
  prefs      TEXT    NOT NULL,
  updated_at TEXT    NOT NULL,
  PRIMARY KEY (user_id, session_id)
);
CREATE INDEX idx_session_video_prefs_session ON session_video_prefs (session_id);
