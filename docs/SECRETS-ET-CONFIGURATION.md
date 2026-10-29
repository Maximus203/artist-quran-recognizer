# Secrets et configuration

Ce document dit quelles variables d'environnement protègent l'atelier, ce que le serveur exige au
démarrage, comment séparer développement, test et production, et comment faire tourner (renouveler)
chaque secret. Aucune valeur n'est écrite ici : seulement des noms.

## Contrôle au démarrage (production)

Quand `NODE_ENV=production` (c'est ce que fait `next start`), le serveur vérifie sa configuration
avant d'accepter la moindre requête (`web/lib/config-guard.ts`, appelé par `web/instrumentation.ts`).
S'il manque une valeur de sécurité, il écrit **une ligne lisible dans le journal d'application**, qui
nomme chaque variable en cause sans jamais citer de valeur, puis s'arrête avec le code 1. En
développement, le même contrôle ne fait que prévenir.

Deux modes d'accès, à déclarer sans ambiguïté :

| Mode | Déclaration | Exigences |
|---|---|---|
| **Poste local** | `AQR_LOCAL_ONLY=1` | Aucun jeton ; seule l'adresse 127.0.0.1 est acceptée. Incompatible avec `AQR_ACCESS_TOKEN`. |
| **Accès public** | `AQR_ACCESS_TOKEN` | Toutes les lignes ci-dessous. |

Exigences de l'accès public (chacune est testée dans `web/lib/config-guard.test.ts`) :

| Variable | Exigence |
|---|---|
| `AQR_ACCESS_TOKEN` | au moins 32 caractères aléatoires, pas une valeur prévisible |
| `AQR_PUBLIC_ORIGIN` | origine **https** (`https://hôte`), sans chemin ni identifiants |
| `AQR_TRUST_PROXY` | déclaré : `1` derrière un reverse proxy de confiance, `0` sinon. Sans `1`, l'adresse réelle des visiteurs est inconnue et aucun blocage d'adresse n'a lieu. |
| `AQR_SIGNUP` | déclaré : `open`, `code` ou `closed` (+ `AQR_SIGNUP_CODE` si `code`) |
| `AQR_AUDIT_SALT` | au moins 32 caractères aléatoires (sel des empreintes d'audit et d'adresses) |
| `AQR_FORM_KEY` | au moins 32 caractères aléatoires (jetons des formulaires pièges) |
| `AQR_LIVE_KEY` | au moins 32 caractères, **si** le direct est branché (`AQR_LIVE_URL`) ; le fichier local ne suffit pas en public |

Générer une valeur : `python -c "import secrets; print(secrets.token_urlsafe(48))"`.

Autres vérifications faites au démarrage : version de Node corrigée de CVE-2026-111497 et coût scrypt
(`AQR_SCRYPT_LOG_N` entre 17 et 20), cf. `docs/SECURITE-DEPENDANCES.md`.

## Un jeu de secrets par environnement

Chaque environnement a **ses propres** valeurs, générées séparément. Une clé de production n'est jamais
copiée sur un poste de développement ni dans un test.

| Environnement | D'où viennent les valeurs | Règle |
|---|---|---|
| Développement | `.env` local (ignoré par Git) ou environnement du shell | valeurs jetables ; `AQR_LOCAL_ONLY=1` ou jeton de test |
| Test | valeurs écrites dans les tests (`"t" * 32`, `"x" * 40`…) | jamais une valeur qui marche ailleurs |
| Production | gestionnaire de secrets de l'hôte ou fichier d'environnement 0600 hors dépôt, lu par le service (sur Alpha : `/opt/atelier/atelier.env`, propriétaire root) | générée sur place, jamais passée par un chat, un mail ou un ticket |

Ce que Git ne contient pas, et comment on le vérifie :

- `.env`, `.env.*` (sauf `.env.example`, qui ne porte que des noms vides), `*.key`, `*.pem` et les bases
  SQLite sont ignorés (`.gitignore`).
- `python scripts/scan_secrets.py` (fichiers suivis) et `python scripts/scan_secrets.py --history` (tous les
  commits de toutes les branches) cherchent des clés connues et des affectations de secret longues ; le
  test `tests/unit/test_scan_secrets.py` fait échouer la suite si un secret apparaît dans l'arbre.
  Ce n'est pas gitleaks : à lancer aussi quand l'outil est installé.

## Rotation

Quand : à la fin d'une durée prévue, au départ d'une personne qui connaissait la valeur, ou **tout de
suite** au moindre soupçon de fuite. Les secrets sont indépendants : en changer un ne touche pas les autres.

| Secret | Procédure | Effet visible |
|---|---|---|
| `AQR_ACCESS_TOKEN` | nouvelle valeur dans l'environnement, redémarrer l'atelier, communiquer la valeur aux seuls intéressés | tous les cookies d'accès en cours deviennent invalides : chacun ressaisit le jeton. Les sessions de compte ne sont pas touchées. |
| `AQR_LIVE_KEY` | même valeur nouvelle pour l'atelier **et** le service du direct, redémarrer les deux | les jetons du direct durent 60 s : au plus un flux en cours de connexion échoue et se relance. Aucun audio n'est concerné. |
| `AQR_AUDIT_SALT` | nouvelle valeur, redémarrer | les empreintes d'adresses déjà écrites ne correspondent plus aux nouvelles : la liste de blocage repart de zéro et l'audit ne relie plus une même adresse avant et après. À faire hors incident en cours. |
| `AQR_FORM_KEY` | nouvelle valeur, redémarrer | les formulaires déjà ouverts sont refusés une fois : il suffit de recharger la page. |
| Jetons d'API des utilisateurs | l'utilisateur les révoque depuis son compte ; durée par défaut 180 jours | l'outil qui s'en servait doit recevoir un nouveau jeton |
| Mots de passe | changement par l'utilisateur ; un administrateur peut déverrouiller un compte | — |
| Base de données | SQLite locale : **aucun identifiant de base** à renouveler. Le fichier est protégé par les droits du système (0600/0640) et par la sauvegarde chiffrée (section 15). | — |

Après toute rotation : redémarrer, lire le journal d'application (aucune ligne « démarrage refusé »), ouvrir
l'atelier et faire une connexion réelle.

## Routes de développement

Aucune route de test, de débogage ou d'administration de base n'existe sous `web/app` (contrôlé dans
`web/lib/config-guard.test.ts`), et les noms habituels (`/api/debug`, `/phpmyadmin`, `/actuator`…) sont des
pièges qui bloquent l'adresse (cf. `docs/DIAGNOSTIC-PRODUCTION.md`).
