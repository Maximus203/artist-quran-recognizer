# Diagnostic en production : où regarder, avec quelles commandes

Procédure de la section 10 de `docs/SECURITE-PRE-DEPLOIEMENT.md`. Elle vaut pour le serveur de
l'atelier (Node). Le service du direct (Python) a son propre journal : voir la section « Direct ».

## Où sont les journaux

Dossier : `AQR_LOG_DIR`, sinon `<AQR_REVIEW_DIR>/logs`. Un fichier **par flux et par jour (UTC)**, une
**ligne JSON par événement**, droits `0640`, rotation par taille (suffixe `.1`, `.2`…) au-delà de 50 Mio.

| Flux | Contenu | Conservation |
|---|---|---|
| `app-AAAA-MM-JJ.log` | démarrage et arrêt du service, avertissements, erreurs serveur, version de Node | 30 jours (`AQR_LOG_RETENTION_DAYS`) |
| `access-…` | une ligne par requête d'API : méthode, chemin **sans** la requête, statut, durée, identifiant de corrélation | 30 jours |
| `queue-…` | analyses (début, fin, échec, délai dépassé, durée, moteur, attente) et exports (vidéo, sous-titres) | 90 jours au moins |
| `security-…` | connexions, échecs, verrouillages, inscriptions, mots de passe, jetons, passage privé/partagé, refus de débit ou inter-sites | 365 jours (`AQR_AUDIT_RETENTION_DAYS`) |

Les fichiers expirés sont supprimés au démarrage puis chaque jour. Le flux `security` est un journal
**d'audit en chaîne** : chaque ligne porte `prev` et `hash` (empreinte de la ligne précédente), donc
modifier, supprimer ou insérer une ligne se voit.

**Jamais** dans les journaux : mot de passe, jeton, cookie, audio, texte coranique, traduction,
contenu d'utilisateur. Une couche de masquage retire en plus les jetons `qtr_…`, les cookies
`aqr_session`, les en-têtes `Authorization`, les longues clés et tout texte arabe. L'adresse IP n'y
figure que **pseudonymisée** (HMAC tronqué ; `AQR_AUDIT_SALT` pour le sel), le compte que par son numéro.

## Relier les lignes d'une même requête

Chaque requête reçoit un `X-Request-Id` (réponse HTTP comprise). Son `rid` est dans toutes les lignes
qu'elle produit, quel que soit le flux :

```bash
grep -h '"rid":"<identifiant>"' "$AQR_LOG_DIR"/*.log
```

## Les premières commandes

```bash
# 1. Quelque chose de récurrent, ou une chaîne d'audit rompue ? (sortie 0 = rien, 1 = avertissements, 2 = erreurs ou chaîne rompue)
node web/scripts/log-report.mjs "$AQR_LOG_DIR"

# 2. Les dernières erreurs serveur
grep -h '"level":"error"' "$AQR_LOG_DIR"/app-$(date -u +%F).log | tail -20

# 3. Qui est refusé en ce moment (401, 403, 429)
grep -h '"status":4[0-9][0-9]' "$AQR_LOG_DIR"/access-$(date -u +%F).log | tail -20

# 4. Une analyse précise : début, fin, durée, moteur
grep -h '"session":"<identifiant>"' "$AQR_LOG_DIR"/queue-*.log
```

## Quoi regarder en premier

1. `node web/scripts/log-report.mjs` : il dit si une erreur **revient depuis des jours** (au moins trois
   jours distincts et trois occurrences) et si la chaîne d'audit est intacte. À lancer chaque jour par
   une tâche planifiée ; une sortie non nulle doit alerter (Telegram, supervision).
2. `service.start` / `service.stop` dans `app-…` : le service redémarre-t-il en boucle ?
3. Le message `runtime` au démarrage : version de Node touchée par CVE-2026-111497, coût des mots de passe affaibli.
4. Dans `queue-…` : `analysis.failed`, `analysis.timeout`, `waited_ms` qui grimpe (file saturée).
5. Dans `security-…` : une rafale de `login.failure` ou de `rate_limited` sur la même empreinte d'adresse
   (balayage), `login.locked`, `visibility.change` inattendu.

## Blocages (pièges à robots)

- Voir qui est bloqué : `GET /api/admin/blocks` (administrateur) : empreinte, raison, passages, fin. Jamais l'adresse.
- Lever un blocage : `DELETE /api/admin/blocks/<empreinte>`.
- Un blocage n'existe que si l'adresse réelle est connue (`AQR_TRUST_PROXY=1` derrière un proxy de confiance) ;
  sans cela, les pièges répondent et journalisent (`honeypot.hit`, `honeypot.form`) sans bloquer.
- Dans `security-…` : `honeypot.hit` (route piège), `honeypot.form` (champ leurre), `blocked_request` (adresse déjà bloquée).

## Direct

Le service `aqr live-serve` (Python) écrit son journal sur la console **et** dans `live-AAAA-MM-JJ.log`
du même dossier (une ligne JSON par événement : `session.open`, `session.stats`, `token.replayed`, dégradations…),
conservé 30 jours. Jamais d'audio, de jeton, de texte coranique ni de traduction : ces champs sont remplacés par
`<omis>`, et un compte n'y figure que sous un pseudonyme court. Le rapport `log-report.mjs` le lit avec les autres.

**Clé de signature des jetons** (`AQR_LIVE_KEY`, sinon le fichier local `live-signing.key` du dossier de données, créé
au premier démarrage avec les droits 0600). Elle n'est jamais dans Git (`*.key` est ignoré ; un test le vérifie).
Rotation, à faire au moins une fois par an et à chaque soupçon de fuite :

1. produire une nouvelle clé : `python -c "import secrets; print(secrets.token_urlsafe(32))"` ;
2. la poser à l'identique côté atelier ET côté service du direct : variable `AQR_LIVE_KEY`, ou remplacer le contenu
   de `live-signing.key` (les deux processus lisent le même fichier) ;
3. redémarrer l'atelier puis le service du direct ;
4. effet : les jetons émis avant (60 secondes de vie) ne valent plus, les flux déjà ouverts continuent ; un utilisateur
   qui échoue à démarrer une écoute au moment du changement recommence simplement.

**Plafonds** (`AQR_LIVE_*`) : 16 flux au plus, 2 par compte, 32 connexions non authentifiées, 3 600 s par flux, 120 s de
silence, blocs de 32 000 octets. Ce sont des valeurs de départ ; la valeur finale se fixe d'après une mesure sur la
machine cible (`scripts/measure_live_service.py`).

## Limites connues

- Les écritures sont synchrones et sans file d'attente : suffisant pour un atelier, à revoir si le débit
  de requêtes devait être très élevé.
- Le journal d'audit est **détectable** mais pas **inviolable** : quelqu'un qui contrôle le disque peut
  réécrire toute la chaîne. Pour une garantie plus forte, envoyer `security-…` vers un stockage distant en
  ajout seul (section 15).
- Le rapport de récurrence regroupe par message normalisé ; un message qui change à chaque fois
  (texte libre) ne sera pas regroupé.
