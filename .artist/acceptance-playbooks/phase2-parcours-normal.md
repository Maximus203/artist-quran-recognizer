# Phase 2 — parcours normal : inscription, import global/privé, préférences, liste paginée
> Surfaces : [API] · Statut : ✅ · Build : feat/comptes-et-partage @8adc223 · Testé : 2026-10-22
> Périmètre : Comptes (inscription, connexion, déconnexion), import (global, privé, nom par défaut), liste paginée par curseur, favoris/archives/renommage, préférences persistées, non lu, statistiques, documentation.
> Environnement : `next start` (build de production) sur 127.0.0.1, dossier de données de TEST (copie de 2 sessions réelles en lecture seule, jamais les données de Cherif), client HTTP avec un cookie par testeur ; serveur A (inscription ouverte) et serveur B (code d'invitation, quota 100 000 octets, 4 inscriptions/heure).
> Données : aucun compte pré-créé — les comptes (Cherif = premier = administrateur, Awa, Bou…) sont créés par l'API d'inscription, les audios par l'API d'import.
> Critère d'arrêt : tous les scénarios critiques ✅, tous les refus (must-fail) bloqués, aucune ligne d'erreur dans le journal du serveur.
> Rejouer : `cd web && npm run build && node e2e/phase2-api.mjs --source <dossier sessions> --ids <id1,id2> --engine --write` (écrit ce fichier ; `--engine` lance aussi une vraie analyse, avec `AQR_PYTHON`, `AQR_MODELS_DIR`, `AQR_CORPUS_DIR` posés).

## Préconditions
- [API] Build de production présent (`npm run build`), Node ≥ 24 (`node:sqlite`).
- [API] Dossier de données vide de comptes ; deux sessions d'avant les comptes copiées dans `sessions/`.

## Scénarios

### N.1 — [API] Avant tout compte : la configuration est publique, le reste exige une connexion
**Priorité** : critique
**Technique** : nominal
**Action** : `GET /api/auth/config` sans cookie, puis `GET /api/sessions`, `GET /api/me`, `GET /api/stats`, `GET /api/docs` sans cookie.
**Attendu** : La configuration répond `200 { signup: "open", setup_required: true }` ; toutes les autres routes `401 { code: "unauthenticated" }`.
**Observé** : config 200 (setup_required) ; /api/sessions 401, /api/me 401, /api/stats 401, /api/docs 401, /api/me/preferences 401, /api/me/stats 401
**Verdict** : ✅
**Issue** : —

### N.2 — [API] Le premier compte est administrateur, le cookie est durci
**Priorité** : critique
**Technique** : nominal
**Action** : `POST /api/auth/register { username: "Cherif", password }` puis `GET /api/me`.
**Attendu** : `201 { user }` avec `role: "admin"` ; `Set-Cookie: aqr_session` `HttpOnly` `SameSite=Lax` `Path=/` (pas `Secure` en HTTP) ; `/api/me` renvoie l'utilisateur, les préférences par défaut et `quota.limit_bytes: null`. La réponse ne contient ni empreinte ni jeton.
**Observé** : 201 admin (id 1), cookie HttpOnly+Lax+Path=/ sans Secure ; /api/me : thème « system », quota illimité
**Verdict** : ✅
**Issue** : —

### N.3 — [API] Les sessions déjà sur le disque sont importées : globales, sans propriétaire, nommées lisiblement
**Priorité** : critique
**Technique** : nominal
**Action** : Cherif liste `GET /api/sessions?limit=100` (le dossier de test contient 2 sessions d'avant les comptes).
**Attendu** : 2 sessions, `visibility: "global"`, `owner: null`, `mine: false`, `can_edit: true` (administrateur), `unread: false`, `content_label` calculé depuis le résultat, `name_source: "auto"`, `pid` absent.
**Observé** : « test-55 » [Ar-Rahman 55:1–4] ; « Enregistrement du 20 oct. à 04:45 » [Ar-Rahman 55:1–4]
**Verdict** : ✅
**Issue** : —

### N.4 — [API] Un deuxième testeur s'inscrit : simple utilisateur
**Priorité** : critique
**Technique** : nominal
**Action** : `POST /api/auth/register` pour « Awa » puis « Bou » (clients distincts).
**Attendu** : `201`, `role: "user"` ; chacun a son propre cookie ; `GET /api/admin/users` répond `403` pour eux.
**Observé** : Awa (id 2) et Bou (id 3) : role user ; /api/admin/users → 403
**Verdict** : ✅
**Issue** : —

### N.5 — [API] Import global par défaut, avec un nom par défaut intelligent
**Priorité** : critique
**Technique** : nominal
**Action** : Awa envoie en flux `Surah_Yusuf__--_Mishary [dQw4w9WgXcQ] 2026-10-20T17-58-52-469.wav` sans paramètre.
**Attendu** : `201`, `visibility: "global"`, `owner.username: "Awa"`, `mine: true`, `can_edit: true`, `name: "Surah Yusuf - Mishary"`, `name_source: "auto"`, `original_name` = nom envoyé, `size_bytes` = taille envoyée.
**Observé** : nom « Surah Yusuf - Mishary », 64044 octets, global, propriétaire Awa
**Verdict** : ✅
**Issue** : —

### N.6 — [API] Import privé avec un nom choisi ; enregistrement micro horodaté
**Priorité** : critique
**Technique** : partition-équivalence
**Action** : Awa envoie `?visibility=private&name=Mon secret`, puis un fichier `2026-10-22T17-51-03-120.webm` avec `x-aqr-source-kind: microphone`.
**Attendu** : Le privé garde `name: "Mon secret"`, `name_source: "user"`, `visibility: "private"`. L'enregistrement micro est nommé « Enregistrement du … à hh:mm » (UTC ici).
**Observé** : privé « Mon secret » (name_source user) ; micro « Enregistrement du 22 oct. à 19:05 »
**Verdict** : ✅
**Issue** : —

### N.7 — [API] Le privé d'Awa est invisible aux autres, le global est partagé
**Priorité** : critique
**Technique** : table-décision
**Action** : Cherif (administrateur) et Bou listent (`scope=all`, `scope=shared`) et cherchent « secret » ; Cherif ouvre la session privée d'Awa.
**Attendu** : Le global d'Awa apparaît dans `all` et `shared` de Cherif et Bou ; le privé n'apparaît ni dans la liste, ni dans la recherche, ni dans les compteurs ; l'ouvrir donne `404 Session introuvable`.
**Observé** : global partagé (all + shared) pour Cherif et Bou ; privé : absent des listes, de la recherche et du total, 404 à l'ouverture ; Awa le voit dans « mine »
**Verdict** : ✅
**Issue** : —

### N.8 — [API] Les préférences sont enregistrées côté serveur et survivent à la reconnexion
**Priorité** : critique
**Technique** : transition-état
**Action** : Awa `PATCH /api/me/preferences { theme: "dark", visibleSpanSeconds: 30, leftPanelOpen: false, volume: 0.4 }`, se déconnecte, se reconnecte, relit.
**Attendu** : Après reconnexion les 4 valeurs sont là, les autres clés ont leur défaut, `updated_at` ne porte que les 4 clés choisies ; l'ancien cookie, révoqué, donne `401` ; un autre compte garde les défauts.
**Observé** : 4 clés conservées après déconnexion/reconnexion (pseudonyme insensible à la casse), 4 horodatages, ancien jeton révoqué (401), Bou inchangé
**Verdict** : ✅
**Issue** : —

### N.9 — [API] Pagination par curseur : toutes les pages, sans doublon ni trou, dans chaque tri
**Priorité** : critique
**Technique** : valeurs-limites
**Action** : Awa importe 6 petits fichiers (durées 1 à 6 s) puis parcourt `GET /api/sessions?scope=all&limit=3&sort=…` page par page (`recent`, `oldest`, `name`, `duration`, `size`).
**Attendu** : Pour chaque tri la concaténation des pages égale la liste complète (`limit=100`), sans doublon ; `next_cursor` vaut `null` à la dernière page ; `total` constant ; `limit=3` ne renvoie jamais plus de 3 éléments.
**Observé** : recent 4 pages/11 · oldest 4 pages/11 · name 4 pages/11 · duration 4 pages/11 · size 4 pages/11 ; limit=1000 → 400
**Verdict** : ✅
**Issue** : —

### N.10 — [API] Renommer, favori, archiver, retrouver
**Priorité** : normal
**Technique** : nominal
**Action** : Awa renomme le global (`PATCH name`), le met en favori (`PUT …/favorite`), l'archive, cherche par nom ; `name: null` rétablit le nom par défaut.
**Attendu** : Nom `user` retrouvé par `q` ; `scope=favorites` le liste ; archivé il sort de `all` et entre dans `scope=archived` ; `counts.scopes` suit ; `name: null` → nom dérivé du fichier, `name_source: "auto"`. Le favori d'Awa n'est pas celui de Bou.
**Observé** : renommé « Ma récitation préférée », trouvé sans accents, favori propre à Awa, archivé puis désarchivé, nom par défaut rétabli
**Verdict** : ✅
**Issue** : —

### N.11 — [API] « Non lu » : propre à l'utilisateur ; ouvrir est idempotent
**Priorité** : normal
**Technique** : transition-état
**Action** : Cherif liste `state=unread`, appelle `POST …/viewed` sur une session d'avant les comptes puis sur une session prête ; Awa importe un résultat joint (JSON `aqr.recognition/1` du même audio).
**Attendu** : `unread` faux pour les sessions sans propriétaire ; `viewed` sur une session non terminée ne change rien (`viewed_at: null`) ; un résultat joint à l'import n'est pas « non lu » ; `counts.states.unread` = 0.
**Observé** : viewed sur « prête » sans effet ; idempotent (2026-10-22T19:05:34.789Z) ; résultat joint importé « Ar-Rahman 55:1–4 » : déjà vu
**Verdict** : ✅
**Issue** : —

### N.12 — [API] Supprimer sa session ; statistiques personnelles et globales
**Priorité** : normal
**Technique** : nominal
**Action** : Awa supprime l'import avec résultat puis lit `GET /api/me/stats` ; Bou lit `GET /api/stats` et `GET /api/me/stats`.
**Attendu** : `204` puis `404` ; l'espace d'Awa baisse ; `/api/stats` de Bou ne compte pas le privé d'Awa et porte `disk` et `totals` ; `tests: 0` (aucune analyse lancée par l'atelier) ; la liste de Bou ne contient plus la session.
**Observé** : espace d'Awa 1123685 → 864396 octets ; /api/stats de Bou : 9 sessions visibles, disque 1821822 octets, libre 63759716352
**Verdict** : ✅
**Issue** : —

### N.13 — [API] Documentation servie aux testeurs connectés
**Priorité** : normal
**Technique** : nominal
**Action** : `GET /api/docs` puis `GET /api/docs/<slug>` du premier document de `docs/docs-index.json`.
**Attendu** : Index sans chemin de fichier (`file` absent) ; contenu en `text/markdown` ; `401` sans connexion.
**Observé** : 31 document(s) listé(s) sans chemin ; /systeme-en-bref en text/markdown (10970 caractères)
**Verdict** : ✅
**Issue** : —

### N.14 — [API] Vraie analyse (moteur réel) : étiquette de contenu, « non lu » du seul propriétaire, journal des tests
**Priorité** : critique
**Technique** : transition-état
**Action** : Awa envoie en flux l'audio d'une session de référence avec `?autorun=1` (global, enregistrement micro), attend la fin de la cascade réelle, puis Bou et Awa ouvrent le résultat.
**Attendu** : `state: done` ; `content_label` calculé (« Ar-Rahman 55:1–4 ») ; `unread: true` pour Awa seule (Bou : `false`, et son ouverture ne change rien pour Awa) ; `POST …/viewed` d'Awa l'efface ; `GET /api/me/stats` : `tests: 1`, RTF et moteur renseignés ; `GET /api/stats` compte l'analyse ; journal du serveur sans erreur.
**Observé** : fin en 32 s (moteur cascade, 16.08 s d'audio en 30.493 s) ; « Ar-Rahman 55:1–4 » ; non lu pour Awa seule, effacé par SON ouverture ; /api/me/stats : tests 1, RTF moyen 1.90
**Verdict** : ✅
**Issue** : —
