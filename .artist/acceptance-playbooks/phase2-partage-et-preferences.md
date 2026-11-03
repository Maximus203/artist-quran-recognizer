# Phase 2 — partage, autorisations et préférences : refus, isolation, quota, débit
> Surfaces : [API] · Statut : ✅ · Build : feat/comptes-et-partage @8adc223 · Testé : 2026-10-22
> Périmètre : Isolation du privé (16 routes), droits propriétaire/administrateur, attribution des signalements, vérité terrain admin, préférences strictes, authentification hostile, administration, code d'invitation, quota et débit.
> Environnement : `next start` (build de production) sur 127.0.0.1, dossier de données de TEST (copie de 2 sessions réelles en lecture seule, jamais les données de Cherif), client HTTP avec un cookie par testeur ; serveur A (inscription ouverte) et serveur B (code d'invitation, quota 100 000 octets, 4 inscriptions/heure).
> Données : aucun compte pré-créé — les comptes (Cherif = premier = administrateur, Awa, Bou…) sont créés par l'API d'inscription, les audios par l'API d'import.
> Critère d'arrêt : tous les scénarios critiques ✅, tous les refus (must-fail) bloqués, aucune ligne d'erreur dans le journal du serveur.
> Rejouer : `cd web && npm run build && node e2e/phase2-api.mjs --source <dossier sessions> --ids <id1,id2> --engine --write` (écrit ce fichier ; `--engine` lance aussi une vraie analyse, avec `AQR_PYTHON`, `AQR_MODELS_DIR`, `AQR_CORPUS_DIR` posés).

## Préconditions
- [API] Build de production présent (`npm run build`), Node ≥ 24 (`node:sqlite`).
- [API] Dossier de données vide de comptes ; deux sessions d'avant les comptes copiées dans `sessions/`.

## Scénarios

### S.1 — [API] Un audio privé répond 404 sur TOUTES les routes, pour tout autre compte (administrateur compris)
**Priorité** : critique
**Technique** : table-décision
**Action** : Bou et Cherif (administrateur) appellent les 16 routes de session (lecture, audio, forme d'onde, export, ZIP, revue, lancer, annuler, lu, favori, vérité terrain, renommer, supprimer) sur le privé d'Awa ; puis ajoutent son id à une action groupée.
**Attendu** : Chaque appel : `404`, message « Session introuvable », jamais `403` ; l'action groupée répond `not_found` ; la session reste intacte (nom inchangé, présente).
**Observé** : Bou : 16 routes + bulk → 404 ; Cherif : 16 routes + bulk → 404 ; session intacte pour Awa
**Verdict** : ✅
**Issue** : —

### S.2 — [API] Global : lisible par tous, modifiable par son propriétaire ou un administrateur seulement
**Priorité** : critique
**Technique** : table-décision
**Action** : Bou (testeur) tente de renommer, changer la portée, archiver, supprimer, lancer et annuler le global d'Awa ; puis le lit, l'écoute, le met en favori. Cherif (administrateur) le renomme.
**Attendu** : Bou : `403` pour renommer/portée/archiver/supprimer/lancer/annuler ; `200` pour lire, forme d'onde (200 ou 503 selon ffmpeg), export, favori. Cherif : `200` sur le renommage ; Awa le voit renommé.
**Observé** : Bou : 6 refus 403 (PATCH / 403, PATCH / 403, PATCH / 403…) ; lecture/export/revue 200, peaks 200, favori 200 ; administrateur renomme (200)
**Verdict** : ✅
**Issue** : —

### S.3 — [API] Signalements : l'auteur est le compte, non falsifiable ; on ne touche pas au signalement d'un autre
**Priorité** : critique
**Technique** : erreur
**Action** : Sur une session d'avant les comptes, Bou crée un signalement en envoyant `tester: "Usurpateur"` ; Awa tente de le modifier puis de le supprimer ; Cherif (administrateur) le modifie.
**Attendu** : Le signalement de Bou porte `tester: "Bou"` ; la tentative d'Awa renvoie son `id` dans `rejected` et n'a aucun effet ; Cherif le modifie : `tester` reste « Bou », `updated_by: "Cherif"`.
**Observé** : auteur forcé à « Bou » malgré « Usurpateur » ; Awa : rejected [7e0e9424…], signalement intact ; administrateur : tester Bou, updated_by Cherif
**Verdict** : ✅
**Issue** : —

### S.4 — [API] Vérité terrain réservée aux administrateurs (remplace ?relecteur=1)
**Priorité** : critique
**Technique** : table-décision
**Action** : Awa (propriétaire de l'une de ses sessions globales), Bou puis Cherif appellent `GET` et `POST …/validation`, avec et sans `?relecteur=1`.
**Attendu** : Testeurs : `403` « réservée aux administrateurs » (même propriétaire, même avec `?relecteur=1`) ; administrateur : `GET 200`.
**Observé** : Awa et Bou : GET/POST (propose, manifest) → 403 « réservée aux administrateurs », avec ou sans ?relecteur=1 ; Cherif : GET 200
**Verdict** : ✅
**Issue** : —

### S.5 — [API] Préférences : schéma strict, rien d'écrit en cas de refus, fusion partielle
**Priorité** : critique
**Technique** : erreur
**Action** : Bou envoie une clé inconnue, un thème invalide, une taille arabe hors pas, un volume > 1, un corps illisible, puis une mise à jour valide partielle, `null` pour une clé automatique, et `DELETE ?key=`.
**Attendu** : Chaque corps invalide : `400` et AUCUNE clé écrite (même les valides du même corps) ; le valide fusionne sans toucher aux autres clés ; `DELETE ?key=theme` ne remet que `theme` ; `DELETE ?key=inconnue` → `400`.
**Observé** : 8 corps invalides + 1 illisible → 400 sans écriture ; fusion partielle correcte ; DELETE ?key remet une seule clé
**Verdict** : ✅
**Issue** : —

### S.6 — [API] Authentification : refus propres, messages génériques, verrouillage progressif
**Priorité** : critique
**Technique** : erreur
**Action** : Inscriptions invalides (mot de passe court, e-mail comme pseudonyme, doublon de casse) ; connexions erronées (mauvais mot de passe, pseudonyme inconnu) ; 5 échecs de suite sur un compte jetable puis le bon mot de passe ; jeton forgé ; Origin étrangère.
**Attendu** : `400` avec `field` ; `409` sur le doublon ; mauvais mot de passe et pseudonyme inconnu ont EXACTEMENT le même `401` ; après 5 échecs `429` avec `Retry-After`, même avec le bon mot de passe ; un jeton aléatoire ou une injection dans le cookie → `401` ; un `Origin` étranger sur une mutation → `403`.
**Observé** : court 400, e-mail 400, doublon de casse 409 ; mêmes 401 (inconnu = faux mdp) ; 5 échecs → 429 Retry-After 15 s même avec le bon mot de passe ; jeton forgé/injection 401 ; Origin étrangère 403
**Verdict** : ✅
**Issue** : —

### S.7 — [API] Administration : promouvoir, désactiver, jamais le dernier administrateur
**Priorité** : critique
**Technique** : table-décision
**Action** : Cherif liste les comptes, promeut Bou, désactive Awa (qui a une connexion ouverte), tente de retirer successivement le rôle de Cherif puis de Bou.
**Attendu** : Liste avec usage ; la connexion d'Awa meurt (`401`) et elle ne peut plus se connecter ; rétrograder le dernier administrateur actif → `409 last_admin` ; un utilisateur ordinaire ne peut rien (`403`).
**Observé** : liste avec usage ; Bou promu ; Awa désactivée (jeton mort, reconnexion 401) puis réactivée ; dernier administrateur protégé (409 last_admin) ; ex-administrateur : 403
**Verdict** : ✅
**Issue** : —

### S.8 — [API] Entrées de liste et d'import hostiles
**Priorité** : normal
**Technique** : erreur
**Action** : Paramètres invalides (`scope`, `sort`, `state`, `engine`, `from`), curseur forgé, injection SQL dans `q`, import avec `visibility=secret`, nom de 200 caractères, extension interdite, import sans connexion.
**Attendu** : `400` avec un message lisible pour chaque paramètre invalide ; `q` piégé : `200`, aucune ligne, la liste reste intacte ; import invalide : `400`, rien d'écrit ; import anonyme `401`.
**Observé** : 8 paramètres invalides → 400 ; q piégé → 200 sans résultat, liste intacte ; imports invalides → 400/401, aucun dossier laissé
**Verdict** : ✅
**Issue** : —

### S.9 — [API] Documentation : liste blanche stricte
**Priorité** : normal
**Technique** : erreur
**Action** : `GET /api/docs/<slug>` avec des slugs hors index, des traversées (`..`, `%2e%2e`, `%2f`), un chemin de fichier réel (`AGENTS`, `AGENTS.md`).
**Attendu** : `404` pour tout ce qui n'est pas dans `docs/docs-index.json` (ou la redirection `308` que Next applique lui-même à un segment `..` avant d'atteindre la route) ; jamais le contenu d'un fichier non listé.
**Observé** : 10 slugs hostiles → 404 (ou 308 de normalisation de Next pour « .. »), aucun contenu
**Verdict** : ✅
**Issue** : —

### S.10 — [API] Inscription sur code d'invitation, et limite d'inscriptions par heure
**Priorité** : critique
**Technique** : table-décision
**Action** : Serveur B (`AQR_SIGNUP=code`, 4 inscriptions/heure) : inscription sans code, avec un mauvais code, avec le bon, puis une 5ᵉ tentative.
**Attendu** : `403` (champ `code`) sans code ou avec un mauvais ; `201` avec le bon (le premier compte est administrateur même en mode code) ; au-delà de 4 tentatives dans l'heure, `429` avec `Retry-After`.
**Observé** : sans code 403, mauvais code 403, bon code 201 (admin) puis 201 ; 5ᵉ tentative de l'heure → 429 + Retry-After
**Verdict** : ✅
**Issue** : —

### S.11 — [API] Quota par utilisateur : 413 clair, rien de conservé, quota par compte
**Priorité** : critique
**Technique** : valeurs-limites
**Action** : Serveur B (quota 100 000 octets) : « Premier » importe 60 000 octets (accepté), puis 60 000 de plus (flux), puis 60 000 en formulaire ; « Second » importe 60 000 octets.
**Attendu** : Le 2ᵉ et le 3ᵉ : `413` « Quota atteint : tu utilises … sur … », aucune session ni dossier ajouté ; `GET /api/me` donne `used_bytes` et `limit_bytes`; « Second » n'est pas affecté par le quota de « Premier » ; supprimer libère l'espace.
**Observé** : 413 « Quota atteint : tu utilises 58,6 Ko sur 97,7 Ko. Supprime des sessions pour libérer de la place. » (flux et formulaire), dossiers inchangés (1) ; quota par compte ; libéré par la suppression ; /api/me/stats : restant 40000 octets
**Verdict** : ✅
**Issue** : —

### S.12 — [API] Action groupée : chaque identifiant est contrôlé séparément
**Priorité** : normal
**Technique** : partition-équivalence
**Action** : Bou (administrateur, serveur A) envoie dans une même requête : une session qui est à lui, une d'Awa (globale), le privé d'Awa et un identifiant inexistant, pour `archive` ; puis un testeur ordinaire (compte neuf) vise le global d'Awa.
**Attendu** : `results` par id : `ok` pour les siennes et la globale d'Awa (Bou est administrateur), `not_found` pour le privé et l'inconnu ; 101 identifiants ou une action inconnue → `400`.
**Observé** : ok / ok / not_found / not_found (2 appliquées) ; 101 ids, action inconnue, visibilité manquante → 400 ; testeur ordinaire sur un global d'autrui → forbidden
**Verdict** : ✅
**Issue** : —

### S.13 — [API] Déconnexion : le jeton est révoqué côté serveur ; changement de mot de passe
**Priorité** : normal
**Technique** : nominal
**Action** : Bou change son mot de passe depuis une connexion tout en ayant une 2ᵉ connexion ouverte ; puis se déconnecte.
**Attendu** : Mauvais mot de passe actuel → `401` ; bon → `204` ; la 2ᵉ connexion est révoquée (`401`), la courante reste valable ; l'ancien mot de passe ne marche plus ; après `logout`, le cookie copié ne marche plus.
**Observé** : mauvais actuel 401, trop court 400, changement 204 ; 2ᵉ connexion révoquée ; ancien mot de passe refusé ; cookie copié après logout → 401
**Verdict** : ✅
**Issue** : —
