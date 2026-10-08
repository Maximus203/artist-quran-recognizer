# Artist Quran Review — démarrage local

L'interface Next.js appelle **`aqr recognize`**, le moteur Python existant. Elle reste sur `127.0.0.1`. Un essai conserve son audio, sa prédiction originale et les révisions de revue dans `AQR_REVIEW_DIR` (par défaut `%LOCALAPPDATA%\aqr-review`), hors Git. Aucun envoi cloud automatique.

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

## Vérification

```powershell
cd web
npm test
npm run typecheck
npm run build
```
