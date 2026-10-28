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
