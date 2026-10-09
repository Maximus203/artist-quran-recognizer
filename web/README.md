# Artist Quran Review — démarrage local

L'interface Next.js appelle **`aqr recognize`**, le moteur Python existant. Elle reste sur `127.0.0.1`. Un essai conserve son audio, sa prédiction originale et les révisions de revue dans `AQR_REVIEW_DIR` (par défaut `%LOCALAPPDATA%\aqr-review` sous Windows, `$XDG_DATA_HOME/aqr-review` ou `~/.local/share/aqr-review` ailleurs), hors Git. Aucun envoi cloud automatique.

## Préparer

Depuis la racine du dépôt, installer les dépendances Python et le corpus selon `AGENTS.md`. Les modèles restent hors dépôt dans `AQR_MODELS_DIR`. Dans `web/`, exécuter `npm ci`.

Sous PowerShell :

```powershell
$env:AQR_PYTHON = 'D:\01-Dev\Perso\artist-quran-recognizer\.venv\Scripts\python.exe'
$env:AQR_MODELS_DIR = 'D:\01-Dev\Data\aqr-models'
$env:AQR_CORPUS_DIR = 'D:\01-Dev\Perso\artist-quran-recognizer\data\corpus'
$env:AQR_REVIEW_DIR = 'D:\01-Dev\Data\aqr-review'
cd web
npm run dev
```

Ouvrir l'URL affichée par Next.js. L'atelier lance FastConformer et le segmenteur de récitation par défaut ; `AQR_ASR=whisper` choisit Whisper. Ce choix reste provisoire (décision en phase 6). La première analyse peut durer plusieurs minutes. Le temps affiché est réel, sans pourcentage simulé. Un échec de modèle, de corpus ou d'extraction apparaît dans la session.

## Tester un audio

1. Choisir un audio local (MP3, M4A, WAV, OGG, OPUS, FLAC, AAC ou WebM ; 300 Mo maximum par défaut), ou cliquer « Enregistrer une récitation ». Pour le micro, autoriser l’accès sur `127.0.0.1`, démarrer, surveiller la durée, arrêter, réécouter et recommencer si nécessaire. « Analyser cette récitation » importe alors les octets originaux WebM/OGG/M4A et lance le moteur réel. Un refus d’accès ou un micro indisponible affiche une erreur ; aucun fichier n’est créé avant le choix d’analyser.
2. Facultatif : ajouter un JSON `aqr.recognition/1` existant du **même audio**. Le hash SHA-256 est contrôlé ; la prédiction importée garde ses octets d'origine.
3. Pour un fichier choisi, cliquer « Importer dans l'atelier », puis « Lancer le vrai moteur Python » si aucun JSON n'a été joint. Le bouton « Analyser cette récitation » du micro effectue ces deux étapes.
4. Utiliser la piste, la liste et le lecteur pour écouter. Les hypothèses déduites et les abstentions ont leurs propres affichages. « Sans temps » ne déplace pas le lecteur.
5. « Signaler ici » pour un point, « Sélectionner une plage » pour une durée. Décrire le problème, écouter, confirmer. La revue se sauvegarde localement ; vérifier l'indicateur « Enregistré localement ».
6. Télécharger le pack ZIP complet pour le transférer dans un environnement cloud autorisé. Il contient l'audio, la prédiction originale, la revue courante, ses révisions et un manifeste d'empreintes SHA-256. Le bilan JSON seul est aussi disponible. Le stockage cloud, les droits sur des voix tierces et une vérité terrain exhaustive restent à établir avant d'annoncer des métriques.

Les sessions micro sont marquées `source_kind: microphone` dans `session.json`. Le manifeste du pack (`aqr.review-bundle/1`) indique l’empreinte audio, celle de chaque résultat et correction, ainsi que les versions déclarées par le moteur. Les fichiers restent dans `AQR_REVIEW_DIR/sessions/<id>` hors Git et ne sont pas supprimés automatiquement. Pour les réutiliser sur le cloud, conserver le ZIP dans un stockage privé puis ajouter au manifeste versionné `docs/data-lots/lot-N.yaml` uniquement les métadonnées vérifiées (empreinte, durée, catégorie, droits et emplacement privé). Aucun enregistrement micro n’est publié automatiquement.

Le serveur est réservé à un usage local de confiance. Le pack de revue ne modifie jamais la prédiction. Les signalements partiels ne sont pas évalués comme vérité terrain. Les données conservées ne sont pas supprimées automatiquement.

## Mode test distant (optionnel, protégé)

Par défaut l'atelier n'accepte que la boucle locale (`127.0.0.1`, `localhost`, `[::1]`). Pour un test depuis une autre machine (VM, tunnel, proxy), activer explicitement :

| Variable | Rôle | Défaut |
| --- | --- | --- |
| `AQR_ALLOWED_HOSTS` | noms d'hôte supplémentaires acceptés, séparés par des virgules (sans port) | vide |
| `AQR_ACCESS_TOKEN` | jeton d'accès, **obligatoire** pour qu'un hôte supplémentaire soit accepté ; une fois défini il protège aussi le loopback. Choisir ≥ 24 caractères aléatoires | absent |
| `AQR_ACCESS_TTL_S` | durée de vie (s) du cookie d'accès délivré par `/access` (1 à 604800) | 3600 |
| `AQR_MAX_UPLOAD_BYTES` | plafond d'upload (refus `413` dès l'en-tête `Content-Length`, `400` sinon) | 300 Mo |
| `AQR_SESSION_TTL_S` | supprime à chaque import les sessions **inactives** depuis plus de N secondes (jamais celles en cours) ; voir « Règle d'activité » ci-dessous | `0` = désactivé |

Le jeton se présente par l'en-tête `x-aqr-token`, `Authorization: Bearer …` (scripts, tests) ou par un cookie `HttpOnly` signé (HMAC, expiration incluse) obtenu en saisissant le jeton sur `/access` ; la comparaison est à temps constant. Sans jeton valide, l'API répond `403` et la page redirige vers `/access`. Les mutations (`POST`/`DELETE`) exigent en plus une origine identique ou un hôte autorisé de même protocole et port.

```bash
AQR_ALLOWED_HOSTS=atelier.exemple.test AQR_ACCESS_TOKEN="$(openssl rand -hex 16)" \
AQR_ACCESS_TTL_S=1800 AQR_SESSION_TTL_S=86400 \
npx next start --hostname 0.0.0.0 --port 3097
```

À placer derrière HTTPS (le cookie est `Secure` quand l'URL est en `https:`). Ne pas exposer sur Internet sans reverse proxy : pas de limitation de débit intégrée, et les audios déposés restent des données privées. Les identifiants de session doivent être des UUID : toute autre forme (`..`, séparateurs) est rejetée.

### Règle d'activité et suppression

Avec `AQR_SESSION_TTL_S`, une session n'est supprimée que si **aucune activité** n'a eu lieu depuis plus de N secondes. L'activité est le plus récent de :

- la date de modification de n'importe quel fichier ou dossier de la session, sous-dossiers compris (audio, résultat, `review.json`, `revisions/`, `exports/`, écritures `.tmp`) ;
- `updated_at` de la revue et `finished_at` de la session (une date postérieure à l'instant présent est ignorée).

Une revue enregistrée récemment (« Enregistré localement ») garde donc la session **et tout son historique de révisions**, même si l'audio a été importé il y a des semaines ; elle expire seulement après N secondes sans nouvelle activité. L'activité est relue juste avant la suppression, pour qu'un enregistrement concurrent sauve la session. Une session en cours, un dossier étranger ou un JSON corrompu ne sont jamais supprimés par cette purge. Lire une session (liste, lecteur audio, `GET`) n'est pas une activité : seule une écriture retarde la purge. Un dossier sans `session.json` n'est jamais purgé, et un fichier daté dans le futur garde la session tant que l'horloge n'a pas rattrapé cette date. Une session dont le traitement appartient encore à ce serveur (y compris annulée, avant la fin de son processus) n'est ni purgée ni supprimée tant qu'il n'est pas terminé.

`DELETE /api/sessions/<id>` supprime une session : `400` si elle tourne, `409` si elle porte un travail de revue (au moins une annotation, une révision, ou une `review.json` illisible), `204` sinon. `DELETE /api/sessions/<id>?force=1` supprime malgré le travail de revue (jamais une session en cours). L'interface n'appelle pas cette route (« Arrêter le traitement » cible `/run`) : elle sert aux scripts et aux tests distants.

## Smoke de bout en bout (CLI + navigateur)

`scripts/smoke_e2e.sh` récupère (si besoin) les 4 versets de la sourate 112 via `scripts/fetch_everyayah.py` dans `$AQR_AUDIO_DIR` (hors dépôt), puis lance :

1. `pytest -m slow tests/e2e` : `aqr recognize` réel (Whisper, CPU). `tests/support/corpus_check.py` (`assert_matches_corpus`, même sémantique que `HomeRenderer.span_text`) contrôle chaque verset nommé : texte égal au corpus (verset entier) ou sous-chaîne exacte des mots `first..last` (verset partiel), plage de mots dans le verset, drapeau `partial` cohérent, sourate 112 uniquement (I3), `UNCERTAIN` sans texte, au moins un verset RECOGNIZED.
2. `npm run smoke:browser` (`web/e2e/browser-smoke.mjs`, `playwright-core`) : import de l'audio, moteur réel, puis lecture de `GET /api/sessions/<id>` (une session `failed` fait échouer immédiatement avec son erreur) ; le résultat passe par le même `corpus_check`, chaque segment RECOGNIZED cliqué affiche le badge « Reconnu » et un texte arabe strictement égal à `interval.text`. Le pack ZIP téléchargé est ouvert et vérifié par `scripts/verify_review_bundle.py` (entrées attendues, SHA-256 recalculés, audio = manifeste = prédiction = fichier source de référence). Il lance `next start` (après `npm run build`) ou vise `AQR_SMOKE_URL` ; Chromium vient de `AQR_SMOKE_CHROMIUM` (défaut `/opt/pw-browsers/chromium`, aucun `playwright install`).

**Ressource absente (audio, ffmpeg, modèles, corpus vérifié par `LOCK.json`, Chromium, build, Python)** : le mode strict est le **défaut partout** (`pytest -m slow tests/e2e`, `npm run smoke:browser`, `scripts/smoke_e2e.sh`) : échec explicite avec la raison (pytest : erreur ; navigateur : code 2), jamais un succès muet. Seul `AQR_SMOKE_STRICT=0`, posé explicitement, autorise le skip : le test est alors sauté avec la raison et un résumé « NON EXÉCUTÉ » le dit en toutes lettres. `node e2e/browser-smoke.mjs --check` ne vérifie que les ressources. `scripts/smoke_e2e.sh` n'accepte que `all`, `cli` ou `browser` (autre valeur : usage, code 2). Le `pytest` ordinaire n'est pas concerné : ces tests portent le marqueur `slow`.

Ces smokes appellent les vrais modèles : plusieurs minutes sur CPU.

## Vérification

```powershell
cd web
npm test
npm run typecheck
npm run format:check
npm run build
```
