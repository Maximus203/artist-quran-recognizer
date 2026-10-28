---
name: quran-tr
description: >
  Utiliser Quran TR pour localiser chaque verset récité dans un audio ou une vidéo (début et fin
  en secondes), obtenir le texte arabe exact du Mushaf et la traduction française officielle,
  ou générer des sous-titres (SRT, WebVTT, ASS, JSON). À utiliser dès qu'il faut savoir QUELS
  versets du Coran sont récités dans un fichier, à quel moment, ou produire des sous-titres
  d'une récitation. Fonctionne par le serveur MCP « quran-tr » ou par l'API REST /api/v1.
---

# Quran TR — utiliser l'API et le MCP

Quran TR est un outil local : il écoute un audio, trouve les versets du Coran récités, donne leur
début et leur fin, et restitue le **texte exact du Mushaf** (Tanzil) et la **traduction officielle**
(QuranEnc). Tout ce qui n'est pas du Coran (français, hadith, dou'a, silence) est ignoré.

## Règles d'or (à respecter dans tes réponses)

1. **Cite le texte arabe et la traduction tels que l'outil les renvoie**, mot pour mot. Ne les
   réécris pas, ne les complète pas de mémoire, ne les « corrige » pas. Si un champ est vide, dis
   qu'il est vide.
2. **Regarde le statut de preuve de chaque verset** : `recognized` (reconnu, sûr), `inferred`
   (déduit du contexte), `uncertain` (incertain). Ne présente jamais un `uncertain` comme certain.
3. **Un verset absent n'est pas une erreur** : l'outil préfère ne rien nommer plutôt que nommer un
   faux verset. Ne comble pas les trous.
4. **Ne partage jamais le jeton** (`qtr_…`) : ni dans une réponse, ni dans un fichier, ni dans un
   journal. Il agit au nom du compte de son propriétaire.
5. **Les essais sont privés par défaut.** Ne passe `visibility: "global"` que si l'utilisateur
   demande explicitement de partager.

## Obtenir l'accès

L'utilisateur crée un jeton dans Quran TR : **Compte → API & MCP → Créer un jeton** (lecture seule
ou écriture). Il le copie une seule fois. Adresse de base : celle de l'atelier, ex.
`http://127.0.0.1:3000` (ou l'adresse du tunnel).

- **MCP** (recommandé pour un agent) — Claude Code :

  ```bash
  claude mcp add --transport http quran-tr http://127.0.0.1:3000/mcp \
    --header "Authorization: Bearer qtr_VOTRE_JETON"
  ```

- **API REST** : en-tête `Authorization: Bearer qtr_…` sur `/api/v1/…`.

## Flux type : de l'audio aux versets

1. **Importer** (jeton en écriture) : outil MCP `create_recording` (audio en base64, 25 Mo au plus)
   ou `POST /api/v1/recordings?autorun=1` avec le fichier en corps brut et l'en-tête
   `x-aqr-filename: <nom%20encodé.mp3>` (pour un gros fichier ou une vidéo).
2. **Attendre** : interroger `get_recording` (ou `GET /api/v1/recordings/{id}`) toutes les 10 à 30
   secondes jusqu'à l'état `done`. États : `ready`, `queued`, `running`, `done`, `failed`,
   `cancelled`. L'analyse peut durer plusieurs minutes pour un long audio ; ne boucle pas plus vite
   que toutes les 5 secondes.
3. **Lire** : `get_recording` renvoie, pour l'essai terminé, la liste `verses` :
   `ref` (`sourate:verset`), `start_s`, `end_s`, `status`, `arabic`, `translation`,
   `translation_source`.
4. **Sous-titres** (facultatif) : `export_subtitles` avec `format` = `srt`, `vtt`, `ass` ou `json` et
   toutes les options de l'atelier (`content` ar/fr/ar_fr, durées, longueur de ligne, décalage,
   police, karaoké…). Le champ `content` est le fichier complet. Les options et leurs valeurs
   permises : `get_export_options` ou `GET /api/v1/export/options`.
5. **Vidéo** (facultatif) — pour découper, appeler d'abord `suggest_video_ranges` : chaque plage commence avant la
   récitation et finit après (aucune voix coupée) ; lire `warnings` et signaler les passages `inferred`. Puis : `export_video` avec les mêmes réglages que le formulaire de l'atelier —
   `orientation` (`16:9`, `9:16`, `1:1`, `source`), `arabic_size` et `translation_size` (points ou
   `small|medium|large|xlarge`), `show_translation`, `fill` (le texte occupe la zone libre),
   `text_position` (0 haut à 100 bas, ou `top|middle|bottom`), `show_wave`, `accent` (`{h,s,l,a}`),
   `file_name`, `background` (un fond proposé, `source` ou
   `color`), `fps` (30 ou 60), `resolution` (360, 480, 720, 1080, 1440 ou 2160 : côté court de l'image),
   `ranges` (`[{start, end}]` en secondes : UNE vidéo par plage) ou `per_verse: true` (une vidéo par
   verset reconnu) — puis `get_video_export` toutes les 10 s jusqu'à `done` et téléchargement de chaque
   entrée de `download_paths` avec le jeton. Une image de fond personnelle s'envoie par l'API REST (multipart).
   Le rendu dure environ la moitié de la durée de l'audio.

## Outils MCP

| Outil | Rôle | Droit |
|---|---|---|
| `whoami` | Compte connecté et droits du jeton | lecture |
| `list_recordings` | Liste des essais (`q`, `state`, `limit`, `cursor`) | lecture |
| `get_recording` | État et versets d'un essai (`id`) | lecture |
| `get_export_options` | Catalogue des options d'export (sous-titres et vidéo) | lecture |
| `export_subtitles` | Sous-titres d'un essai terminé (`id`, `format`, `options`) | lecture |
| `suggest_video_ranges` | Plages protégées à exporter (marges avant/après, silence) | lecture |
| `export_video` | Demande la vidéo MP4 (format, tailles, fond…) : renvoie un job | lecture |
| `get_video_export` | État du job ; `download_path` quand il est `done` | lecture |
| `get_verse` | Texte exact et traduction d'un verset (`ref` = `2:255`) | lecture |
| `create_recording` | Importer un audio et lancer l'analyse | écriture |
| `update_recording` | Renommer, changer la portée (privé / global) ou archiver | écriture |
| `delete_recording` | Supprimer définitivement (exige `confirm: true`) | écriture |
| `run_analysis` / `cancel_analysis` | Lancer, relancer ou annuler l'analyse | écriture |
| `set_favorite` | Mettre ou retirer des favoris | écriture |
| `get_review` / `save_review`, `get_decisions` / `save_decisions` | Lire et enregistrer la revue et les décisions de relecture | lecture / écriture |
| `get_stats`, `get_preferences` / `set_preferences` | Statistiques et préférences du compte | lecture / écriture |

## API REST (`/api/v1`)

| Méthode et chemin | Rôle |
|---|---|
| `GET /api/v1/me` | Identité et droits du jeton |
| `GET /api/v1/recordings` | Liste paginée (`q`, `state`, `limit`, `cursor`, `scope`) |
| `POST /api/v1/recordings` | Import : corps brut + `x-aqr-filename`, ou multipart (`audio`) ; `?autorun=1`, `?visibility=private\|global`, `?name=` |
| `GET /api/v1/recordings/{id}` | Essai et résultat complet (`result.intervals`) |
| `POST /api/v1/recordings/{id}/export/subtitles` | Corps `{"options":{"format":"srt"}}` ; `?raw=1` répond le fichier |
| `GET /api/v1/export/options` | Catalogue des options de sous-titres et de vidéo, valeurs permises, défauts |
| `POST /api/v1/recordings/{id}/export/video/jobs` | Export vidéo : JSON `{"options":{…}}` ou multipart (`options` + `background_image` PNG/JPEG/WebP) → `202` + job |
| `GET /api/v1/recordings/{id}/export/video/jobs/{job}` | État (`queued`, `running` + avancement, `done`, `failed` + erreur) |
| `GET /api/v1/recordings/{id}/export/video/jobs/{job}/file` | Le MP4 (conservé une heure) |
| `GET /api/v1/recordings/{id}/audio`, `…/peaks`, `…/video`, `…/bundle` | Audio d'origine, onde, vidéo source, pack d'archive |
| `GET/POST /api/v1/recordings/{id}/review`, `…/decisions` | Signalements et décisions de correction avant export |
| `PUT/DELETE /api/v1/recordings/{id}/favorite`, `PATCH …/{id}` | Favori ; nom, portée (`private`/`global`), archivage |
| `GET /api/me/stats`, `GET /api/stats`, `GET /api/corpus/verse?ref=2:255` | Statistiques, statistiques globales, texte d'un verset |
| `DELETE /api/v1/recordings/{id}` | Suppression (jeton en écriture) |

Erreurs : `401` jeton absent, invalide, révoqué ou expiré ; `403` jeton en lecture seule ou action
interdite ; `404` essai inexistant **ou privé d'un autre compte** ; `413` fichier trop gros ou quota
dépassé ; `409` export impossible (passages ambigus non résolus) ou vidéo pas prête ; `429` deux exports vidéo déjà en cours ; `503` aucun Chrome/Edge pour le rendu vidéo.

## Interpréter le résultat

- `verses[].status` : `recognized` > `inferred` > `uncertain` (voir règle 2).
- `non_quran_or_abstained` : nombre de passages non coraniques ou non nommés — c'est normal.
- Les temps sont en secondes depuis le début du fichier.
- Un verset peut être partiel (`partial`) : l'audio n'en contient qu'une partie.
