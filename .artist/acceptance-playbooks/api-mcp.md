# API et MCP : jetons, API /api/v1, serveur /mcp

## Must-pass

- Un jeton se crée depuis Compte → API & MCP, s'affiche une seule fois, apparaît ensuite sous son
  préfixe seulement ; la base ne contient que son empreinte.
- `GET /api/v1/me` avec le jeton : compte et droits. Sans jeton, jeton inventé, révoqué, expiré,
  compte désactivé : `401`.
- Jeton en lecture seule : `GET` et sous-titres `200` ; import `403` ; outil MCP `create_recording`
  refusé sans appel à l'API.
- Un jeton ne peut pas atteindre `/api/me/tokens`, `/api/me/password`, `/api/admin`, `/api/users`,
  `/api/auth` : `403`.
- Un essai privé d'un autre compte répond `404` à un jeton (jamais `403`).
- MCP : `initialize`, `tools/list`, `tools/call` pour les cinq outils ; erreurs d'outil en
  `isError`, jamais un plantage ; `GET /mcp` : `405`.
- Les versets d'`get_recording` portent l'arabe et la traduction du résultat, et leur statut.
- Import par jeton : privé par défaut.

## Parcours à jouer

1. Créer un jeton « écriture », importer un audio par `create_recording`, attendre `done`, lire.
2. Créer un jeton « lecture », vérifier les refus, le révoquer, vérifier le `401`.
3. Brancher le MCP dans un vrai client (Claude Code) et lister les essais.

## Export par l'API (sous-titres et vidéo)

- `GET /api/v1/export/options` liste les options ; une option inconnue ou hors plage répond `400`
  avec le détail.
- `POST …/export/video/jobs` (JSON, puis multipart avec `background_image`) répond `202` ; le job
  passe `running` (avancement lisible) puis `done` ; le `file` est un MP4 H.264 + AAC aux dimensions
  demandées, de la durée de l'audio. Un jeton en lecture peut le faire.
- Troisième job actif du même compte : `429`. Aucun Chrome/Edge : `503` lisible. Job d'un autre
  compte ou expiré : `404`.
- Le MCP fait de même : `export_video`, `get_video_export`, `get_export_options`, `get_verse`.
- Export vidéo par plages : `ranges` à deux plages donne deux MP4 (`downloads`), chacun de la durée de sa plage avec le son
  de même durée ; `per_verse` donne une vidéo par verset ; `fps` 24 ou `resolution` 1000 : `400` ; plage hors audio : job
  `failed` avec « Plage 1 : commence à … » ; `fps` 60 et `resolution` 2160 : MP4 3840×2160 à 60 im/s (ffprobe).
- MCP : `delete_recording` sans `confirm: true` refuse sans appeler l'API ; `get_video_export` liste `download_paths`.
