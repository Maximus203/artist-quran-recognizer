-- 011 : playlists (regrouper des audios et les lire à la suite).
--
-- Une playlist appartient à UN compte (supprimée avec lui). Elle ne contient que des références à des sessions :
-- une session supprimée sort de toutes les playlists, mais le droit de voir une session reste celui de la
-- session (une playlist ne donne accès à rien). `position` ordonne la lecture, à partir de 0, sans trou.
CREATE TABLE playlists (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id   INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  created_at TEXT    NOT NULL,
  updated_at TEXT    NOT NULL
);
CREATE INDEX idx_playlists_owner ON playlists (owner_id, updated_at);

CREATE TABLE playlist_items (
  playlist_id INTEGER NOT NULL REFERENCES playlists (id) ON DELETE CASCADE,
  session_id  TEXT    NOT NULL REFERENCES session_meta (id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  added_at    TEXT    NOT NULL,
  PRIMARY KEY (playlist_id, session_id)
);
CREATE INDEX idx_playlist_items_order ON playlist_items (playlist_id, position);
