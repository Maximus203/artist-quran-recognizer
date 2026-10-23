# Photo de profil et « qui a importé quoi » dans les listes de sessions
> Surfaces : [API] · [mobile 375 px] · [desktop 1280 px] · Statut : ✅ (12 scénarios ; campagne indépendante de Cherif QA du 2026-10-23 : aucun défaut bloquant, 4 corrections faites, voir P.11 et P.12) · Build : feat/photo-de-profil · Testé : 2026-10-23
> Périmètre : `PUT`/`DELETE /api/me/avatar`, `GET /api/users/<id>/avatar`, `owner` de `GET /api/sessions`, réglage dans `/compte`, avatar de l'en-tête, du menu du compte, du panneau Sessions, de `/sessions` et de l'en-tête d'une session, migration `002_photo_de_profil.sql`.
> Environnement : `next build` puis `next start` sur 127.0.0.1:3217 (jamais `next dev`), dossier de données de TEST jetable (`AQR_REVIEW_DIR` sur D:, jamais les données du mainteneur), quatre comptes locaux (« Chef Test » administrateur, « Amina Test », « Bilal Test », « Cécile Test »), cinq audios générés par ffmpeg (sinus de 4 s). Navigateur du volet intégré de l'outil, tailles émulées 375×812, 1024×768 et 1280×800, thèmes sombre et clair.
> Critère d'arrêt : tous les scénarios critiques ✅, tous les refus (must-fail) bloqués, aucune erreur inattendue dans la console (observé : seules les réponses 415/404 voulues des scénarios négatifs).
> Limites connues : ffmpeg 9.0 seulement ; l'orientation EXIF est testée avec un JPEG fabriqué à la main (octets EXIF écrits à la main), pas avec une photo de téléphone réelle ; aucun vrai téléphone.

## Préconditions
- Build de production présent, ffmpeg dans le `PATH` (ou `AQR_FFMPEG`).
- Quatre comptes créés par l'API d'inscription ; chacun a importé un audio (un privé pour « Bilal Test »).

## Scénarios

### P.1 — [API] Un faux fichier est refusé par son contenu, jamais par son nom
**Priorité** : critique
**Technique** : partition d'équivalence (contenu faux annoncé comme valide)
**Action** : `PUT /api/me/avatar` avec : un SVG contenant `<script>` annoncé `image/png` ; du HTML annoncé `image/jpeg` ; 3 Mo commençant par la signature PNG ; un PNG tronqué puis complété par des octets quelconques ; un corps vide ; une requête d'origine `http://evil.example` ; une requête sans connexion.
**Attendu** : 415, 415, 413, 422, 400, 403, 401. Rien n'est écrit dans `avatars/`.
**Observé** : 415, 415, 413, 422, 400, 403, 401 ; le dossier `avatars/` ne contient que les photos valides envoyées plus tard
**Verdict** : ✅
**Issue** : —

### P.2 — [API] Trois formats valides deviennent un JPEG carré de 256 px
**Priorité** : critique
**Technique** : parcours nominal
**Action** : Envoyer un PNG 640×360, un JPEG 300×700 et un WebP 400×400 ; lire la photo servie.
**Attendu** : 200 `{ user }` avec `avatar_version` (16 caractères hexadécimaux) ; octets servis = JPEG ; le fichier est `AQR_REVIEW_DIR/avatars/<id>.jpg` et rien n'existe dans `public/`.
**Observé** : 200 pour les trois ; `Content-Type: image/jpeg`, octets `FF D8` ; fichiers `1.jpg`, `2.jpg`, `3.jpg` ; pas de `public/avatars` ; test automatisé : sortie 256×256, métadonnées et commentaires absents, transparence aplatie sur fond clair, SVG collé après un JPEG disparu
**Verdict** : ✅
**Issue** : —

### P.3 — [API] Tout compte connecté lit les photos, personne ne les écrit à la place d'un autre
**Priorité** : critique
**Technique** : droits par rôle
**Action** : Avec « Bilal Test » : lire la photo d'« Amina Test » ; lire celle d'un compte sans photo ; lire sans connexion ; lire `/api/users/abc/avatar`, `0`, `-1`, `1.5`, `99999999999`, `%2e%2e` ; tenter `PUT` et `DELETE /api/users/<id d'Amina>/avatar`.
**Attendu** : 200 avec `Content-Type: image/jpeg` fixe et `X-Content-Type-Options: nosniff` ; 404 ; 401 ; 404 partout pour les identifiants invalides ; 405 pour l'écriture sur un autre compte (la route n'existe pas).
**Observé** : 200, `image/jpeg`, `nosniff` ; 404 ; 401 ; 404 pour les six identifiants ; 405 et 405
**Verdict** : ✅
**Issue** : —

### P.4 — [API] Le cache se valide par empreinte et un changement de photo l'invalide
**Priorité** : important
**Technique** : transition d'état
**Action** : Lire avec `?v=<version courante>`, avec `If-None-Match`, avec `?v=ancienne` ; remplacer la photo ; relire la version.
**Attendu** : `private, max-age=31536000, immutable` ; 304 ; `private, no-cache` ; nouvelle `avatar_version` différente.
**Observé** : conforme aux quatre ; `c6b86de85247c3df` → `eb82e927ba2e4050`
**Verdict** : ✅
**Issue** : —

### P.5 — [API] L'API des sessions donne le pseudo et la version de la photo, jamais rien de sensible, et la visibilité ne bouge pas
**Priorité** : critique
**Technique** : droits par rôle
**Action** : Avec « Cécile Test » : `GET /api/sessions` ; chercher le privé de « Bilal Test » ; ouvrir ce privé par son identifiant.
**Attendu** : `owner` = `{ id, username, avatar_version }` exactement ; `avatar_version: null` sans photo ; privé absent de la liste et 404 à l'ouverture ; aucune chaîne `password`, `@` ou `email` dans la réponse.
**Observé** : clés `avatar_version,id,username` ; `null` pour Cécile ; privé invisible, 404 ; aucune occurrence ; « Bilal Test » voit bien son privé
**Verdict** : ✅
**Issue** : —

### P.6 — [API] Retirer la photo supprime le fichier et ramène l'initiale
**Priorité** : important
**Technique** : transition d'état (idempotence)
**Action** : `DELETE /api/me/avatar` deux fois ; relire la photo ; lister le dossier.
**Attendu** : 200 `avatar_version: null` les deux fois ; 404 ensuite ; fichier absent du disque.
**Observé** : 200 et 200 ; 404 ; `avatars/<id>.jpg` absent
**Verdict** : ✅
**Issue** : —

### P.7 — [desktop 1280 px] Choisir, voir l'aperçu, enregistrer, retirer, refus clairs
**Priorité** : critique
**Technique** : parcours nominal + valeurs-limites
**Action** : Dans `/compte` : choisir un SVG ; un faux PNG qui est un SVG ; un GIF annoncé PNG ; un fichier illisible annoncé PNG ; un PNG 800×400 valide ; « Utiliser cette photo » ; « Retirer ».
**Attendu** : SVG refusé tout de suite (« Format non pris en charge… ») ; faux PNG : refus du serveur, aperçu retiré ; GIF : aperçu puis refus du serveur (415), aperçu retiré ; illisible : « Ton navigateur n'arrive pas à lire cette image » sans aperçu cassé ; PNG valide : aperçu rond, puis la photo remplace l'initiale **sans recharger** dans l'en-tête, la carte d'identité et le réglage ; « Retirer » ramène l'initiale, le bouton redevient « Choisir une photo ».
**Observé** : conforme à chaque étape ; annonce `role="status"` « Photo enregistrée. » / « Photo retirée : ton initiale est de retour. » ; photo supprimée côté serveur (404)
**Verdict** : ✅
**Issue** : — (premier essai : l'aperçu d'un fichier illisible montrait le texte de remplacement dans le cercle ; corrigé avant ce test)

### P.8 — [mobile 375 px] Le propriétaire se lit d'un coup d'œil dans la liste, le panneau et l'en-tête de session
**Priorité** : critique
**Technique** : valeurs-limites (375 px, nom de session très long)
**Action** : À 375×812 : ouvrir `/sessions`, ouvrir une session, ouvrir le tiroir Sessions ; mesurer la largeur de page et la taille des avatars.
**Attendu** : avatar rond de 24 px et pseudo sur chaque carte, « Importé par » dans l'en-tête de session, avatar + « pseudo · statut » dans le tiroir ; aucun défilement horizontal ; le nom de session très long reste sur plusieurs lignes ; l'avatar de l'utilisateur dans l'en-tête de page est sa photo.
**Observé** : largeur de page 375 = fenêtre ; avatars 24×24 ; cartes, en-tête et tiroir conformes
**Verdict** : ✅
**Issue** : —

### P.9 — [desktop 1280 px] Colonne « Importé par », thèmes clair et sombre, couleur stable de l'avatar par défaut
**Priorité** : important
**Technique** : parcours nominal
**Action** : À 1280×800 : `/sessions` en sombre puis clair ; comparer les initiales de plusieurs pseudos ; relire après rechargement.
**Attendu** : colonne « Importé par » avec photo ou initiale + pseudo ; lignes de 64 px comme avant ; pas de débordement ; une même personne garde la même couleur ; initiale lisible dans les deux thèmes.
**Observé** : lignes de 64 px, largeur de ligne = largeur de carte (1190 px) ; initiale « C » rose (grenat clair) pour « Cécile Test » sans photo, stable ; lisible en clair et en sombre
**Verdict** : ✅
**Issue** : — (à 1024 px la grille de la liste dépassait déjà de la carte avant ce changement : la colonne ajoutée est compensée par une colonne « Nom » plus étroite, sans aggraver)

### P.10 — [API] La migration s'applique sur une base existante sans rien perdre
**Priorité** : critique
**Technique** : transition d'état (idempotence)
**Action** : Test automatisé `web/lib/migrate.test.ts` : base avec la migration 001 seule, un compte et une session ; appliquer toutes les migrations deux fois.
**Attendu** : premier passage `[2]`, second `[]` ; le compte et la propriété de la session intacts ; `avatar_hash` et `avatar_updated_at` nuls.
**Observé** : conforme
**Verdict** : ✅
**Issue** : —

### P.11 — [desktop 1280 px] Le bouton de choix a un survol et le focus clavier ne se perd pas
**Priorité** : important
**Technique** : transition d'état (accessibilité)
**Action** : Survoler « Changer la photo » ; au clavier, activer « Utiliser cette photo » puis « Retirer » ; lire `document.activeElement`.
**Attendu** : le bouton a un contour (variante secondaire) et un état de survol ; après chaque action, le focus est sur « Choisir / Changer la photo », jamais sur `<body>` ; le pseudo d'une ligne de session est précédé de « Importé par » pour un lecteur d'écran.
**Observé** : contour et anneau visibles au survol ; focus sur `avatar-choose` après l'enregistrement et après l'annulation ; texte masqué « Importé par » dans les puces de propriétaire des cartes et des lignes
**Verdict** : ✅
**Issue** : — (relevé par Cherif QA : D1, D2, D5 ; corrigés avant ce test)

### P.12 — [desktop 1280 px] Un fichier aux dimensions refusées n'a pas d'aperçu
**Priorité** : important
**Technique** : valeurs-limites (dimensions)
**Action** : Choisir un PNG de 1×1 px, puis un PNG de 600×300.
**Attendu** : le 1×1 est refusé tout de suite (« Dimensions refusées : de 32 à 8192 px de côté. », même texte que le serveur), sans aperçu ni envoi ; le 600×300 s'affiche et s'enregistre.
**Observé** : message identique à celui du serveur, pas d'aperçu, focus sur « Choisir une photo » ; le 600×300 s'affiche et s'enregistre (« Photo enregistrée. »)
**Verdict** : ✅
**Issue** : — (relevé par Cherif QA : D4 ; corrigé avant ce test)

## Défauts relevés par Cherif QA et laissés tels quels (décisions)
- Le serveur coupe la connexion au lieu de répondre `413` pour un `PUT` en flux (sans `Content-Length`) de plus de 2 Mo : cas hors navigateur, l'interface contrôle la taille avant l'envoi.
- Un `PUT` sans en-tête `Origin` est accepté avec un cookie valide : règle commune à toutes les écritures de l'atelier (le cookie est `SameSite=Lax`), pas propre à cette fonction.
- L'état de la photo ne se synchronise pas entre deux onglets du même compte avant la prochaine action ou le prochain rechargement.
- Hors périmètre, présents avant ce changement : la grille de `/sessions` dépasse de sa carte entre 1024 et 1140 px (actions de ligne coupées) ; l'en-tête déborde horizontalement entre 761 et 1008 px.
