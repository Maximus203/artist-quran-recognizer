# API et MCP de Quran TR

Quran TR (l'ancien « Atelier de revue ») peut être utilisé par des applications et des agents IA,
même quand il tourne seulement sur la machine locale. Une entrée est réservée à cet usage : des
**jetons d'API** (`qtr_…`), une API REST sous `/api/v1`, et un serveur **MCP** sous `/mcp`.

## Ce qu'un jeton est (et n'est pas)

- Un jeton identifie une application ou un agent qui agit **au nom d'un compte** : il voit les
  essais de ce compte (les siens et les essais partagés), jamais ceux privés des autres.
- Il n'ouvre **jamais** l'administration, la gestion des comptes ni la création d'autres jetons :
  ces actions exigent la connexion par identifiant et mot de passe.
- Deux droits : **lecture seule** (lister, lire les versets, générer des sous-titres) et **écriture**
  (importer, lancer une analyse, supprimer ses propres essais).
- Création, liste et révocation : page **Compte → API & MCP** (ou `POST/GET/DELETE /api/me/tokens`
  par connexion). Le jeton n'est affiché qu'**une fois** ; la base ne garde que son empreinte
  SHA-256. Durée de validité facultative (1 à 365 jours), 20 jetons actifs au plus par compte.
- Un jeton révoqué, expiré, ou dont le compte est désactivé répond `401` immédiatement.

## Accès depuis une autre machine ou un tunnel

En local, l'adresse est celle de l'atelier (`http://127.0.0.1:3000`). Avec le tunnel Cloudflare, le
jeton d'API tient lieu de jeton d'accès (`AQR_ACCESS_TOKEN`) pour ces routes : l'hôte public doit
seulement figurer dans `AQR_PUBLIC_ORIGIN` / `AQR_ALLOWED_HOSTS`. Le jeton est un secret : à
transmettre par un canal sûr, jamais dans une adresse.

## API REST

Tous les appels portent `Authorization: Bearer qtr_…`.

| Méthode et chemin | Rôle |
|---|---|
| `GET /api/v1/me` | Compte et droits du jeton |
| `GET /api/v1/recordings` | Liste (`q`, `state`, `limit`, `cursor`, `scope`) |
| `POST /api/v1/recordings` | Import : corps brut + `x-aqr-filename`, ou multipart (`audio`) ; `?autorun=1`, `?visibility=private\|global`, `?name=` |
| `POST /api/uploads` puis `PUT /api/uploads/{id}/chunks/{n}` et `POST /api/uploads/{id}/complete` | Import par morceaux (connexion lente, gros fichiers) : session du navigateur (cookie), pas de jeton d'API pour l'instant ; voir `docs/RELEASE-NOTES.md` |
| `GET /api/v1/recordings/{id}` | Essai et résultat complet |
| `POST /api/v1/recordings/{id}/export/subtitles` | Sous-titres (`{"options":{"format":"srt"}}`) |
| `DELETE /api/v1/recordings/{id}` | Suppression (écriture) |
| `GET /api/v1/export/options` | Catalogue des options de sous-titres et de vidéo |
| `POST /api/v1/recordings/{id}/export/video/jobs` | Export vidéo (JSON ou multipart avec `background_image`) → `202` + job |
| `GET …/export/video/jobs/{job}` et `…/file` | Suivi du job, puis le MP4 (conservé une heure) |
| `DELETE …/export/video/jobs/{job}` | Annule un export en attente ou en cours (`409` s'il est déjà terminé) |
| `GET /api/me/stats`, `/api/stats`, `/api/corpus/verse?ref=` | Statistiques et texte d'un verset |

`/api/v1/recordings` est un alias stable de `/api/sessions` : mêmes routes, mêmes droits, mêmes
erreurs (`401`, `403`, `404` — un essai privé d'un autre compte répond `404`, `409`, `413`).
Un jeton ne peut atteindre que `/api/sessions`, `/api/v1` et `/mcp`.

## MCP

Transport « Streamable HTTP » sans état, réponses JSON : `POST {adresse}/mcp`. Un jeton est
obligatoire. Outils :

| Outil | Rôle | Droit |
|---|---|---|
| `whoami` | Compte et droits | lecture |
| `list_recordings` | Liste des essais | lecture |
| `get_recording` | État et versets (référence, début/fin, statut de preuve, arabe, traduction) | lecture |
| `get_export_options` | Options d'export (sous-titres, vidéo), valeurs permises, défauts | lecture |
| `export_subtitles` | SRT, WebVTT, ASS, JSON, avec toutes les options | lecture |
| `suggest_video_ranges` | Plages protégées (marge avant/après, aimantées au silence) : à appeler avant `export_video` | lecture |
| `export_video` / `get_video_export` | Vidéo MP4 : demande puis suivi, `download_paths` (une par plage) à la fin | lecture |
| `get_verse` | Texte exact et traduction d'un verset du corpus | lecture |
| `create_recording` | Import en base64 (25 Mo au plus) et analyse | écriture |
| `update_recording` | Renommer, changer la portée (privé / global) ou archiver | écriture |
| `delete_recording` | Supprimer définitivement (exige `confirm: true`) | écriture |
| `run_analysis` / `cancel_analysis` | Lancer, relancer ou annuler l'analyse | écriture |
| `set_favorite` | Mettre ou retirer des favoris | écriture |
| `get_review` / `save_review`, `get_decisions` / `save_decisions` | Lire et enregistrer la revue et les décisions de relecture | lecture / écriture |
| `get_stats`, `get_preferences` / `set_preferences` | Statistiques et préférences du compte | lecture / écriture |

Les outils passent par l'API (même origine) : un outil n'a jamais plus de droits que l'API. Le texte
arabe et la traduction viennent du résultat (corpus et QuranEnc), jamais d'un modèle (I1, I2) ; le
statut de preuve (`recognized`, `inferred`, `uncertain`) est transmis tel quel (I5).

Brancher Claude Code :

```bash
claude mcp add --transport http quran-tr http://127.0.0.1:3000/mcp --header "Authorization: Bearer qtr_VOTRE_JETON"
```

## Export vidéo par l'API

La vidéo est rendue par **le même code que le formulaire de l'atelier** (canvas et WebCodecs), dans
un Chrome ou Edge sans interface que le serveur lance : une seule mise en page, aucun second moteur.
Le navigateur de rendu s'identifie avec le jeton de l'appelant (jamais plus de droits que lui) et
passe par la page technique `/render/video`. Il faut donc Chrome ou Edge sur la machine
(`AQR_CHROME` pour désigner l'exécutable ; sinon l'installation standard est cherchée). Un compte
a au plus deux exports actifs, rendus un par un ; le MP4 est gardé une heure. Réglages : format
(`16:9`, `9:16`, `1:1`, `source`), taille de l'arabe et de la traduction, traduction affichée ou non,
remplissage de l'espace, hauteur du texte, onde, couleur d'accent, nom du fichier,
fond (dix-sept choix proposés, vidéo d'origine, couleur unie, ou image envoyée).

**Qualité et parties.** `fps` : 30 (défaut) ou 60 (plus fluide, fichier environ deux fois plus lourd) ;
`resolution` : côté court de l'image, 360, 480, 720, 1080 (défaut), 1440 ou 2160 (720 = 1280×720 en 16:9,
720×1280 en 9:16). `ranges` : `[{ "start": 12, "end": 40 }, …]` en secondes de l'audio, **une vidéo par
plage** (50 au plus, 0,5 s au moins, une fin au-delà de la durée est ramenée à la durée) ; `per_verse: true` :
une vidéo par verset reconnu (exclusif avec `ranges`). Sans plage, une seule vidéo de tout l'audio.

**Découpe protégée (aucune voix coupée).** `suggest: "verse"` ou `"passage"` découpe automatiquement : chaque plage commence `lead_in` secondes avant la récitation (0,6 par défaut) et finit `tail_out` secondes après (0,4), aimantée au silence le plus proche (`snap_to_silence`), sans empiéter sur la récitation voisine ; les passages incertains ne sont jamais proposés. `pad_ranges: true` applique les mêmes marges à ses propres `ranges`. Pour voir les plages avant d'exporter : `GET /api/v1/recordings/{id}/export/suggestions?lead_in=&tail_out=&snap=&group=&merge_gap=&silences=1` → `ranges` (`start`, `end`, `core_start`, `core_end`, `lead_in`, `tail_out`, `refs`, `status`, `snapped`, `warnings`), `silence_count`, `notes`, `options`, `session` (type audio/vidéo, durée). 

**Plages nommées, avancement, imagettes.** Chaque plage peut porter un `name` (80 caractères au plus) :
il remplace l'intervalle dans le nom de son fichier (« session — 2.255.mp4 », le deux-points devient un point) ;
la découpe automatique (`suggest`) nomme d'elle-même chaque fichier par sa référence. Pendant le rendu, le job
publie `progress` (« Vidéo 2/5 : rendu 64 % ») et `files_done` / `files_total`. Pour une session vidéo,
`GET /api/v1/recordings/{id}/thumbnails?count=40&width=96` renvoie une planche JPEG horizontale de `count`
imagettes (1 à 120) larges de `width` px (32 à 320) ; l'imagette i montre l'instant (i + 0,5) × durée / count
(en-têtes `X-Aqr-Thumb-Count`, `X-Aqr-Thumb-Every`). 409 `no_video` pour une session audio, 400 hors bornes.
Un silence, pour l'aimantation (`snap_to_silence`, `snapped`, `silences=1`), est au moins 12 dB sous le niveau médian de la voix pendant la récitation ; une marge s'arrête toujours avant une abstention ou un passage non coranique (avertissement dans `warnings`). Les erreurs de validation sont en français (« lead_in : 5 au plus », « option inconnue « per_vers » ») ; un outil MCP appelé avec un argument qu'il ne connaît pas répond par une erreur qui le nomme, sans rien exécuter.
L'écran d'export affiche, dans « Même export par l'API », le JSON `export_video` exact de ses réglages. Le job
terminé liste ses fichiers dans `downloads` (`index`, `name`, `url`) : `…/file` pour la première vidéo,
`…/file?index=N` pour les suivantes. Un export est plus long à 60 im/s et en 1440p ou 4K (mesuré : 3 s
de 4K à 60 im/s en 14 s).

## Compétence pour l'agent

`/agent/quran-tr/SKILL.md` (fichier : `web/public/agent/quran-tr/SKILL.md`) explique à un agent le
flux, les outils, l'interprétation des statuts et les règles de citation. Téléchargeable depuis la
page **API & MCP**.

## Où est le code

`web/lib/api-tokens.ts` (jetons, droits), `web/lib/route-guard.ts` (identification par jeton),
`web/lib/mcp.ts` et `web/app/api/mcp/route.ts` (MCP), `web/next.config.ts` (adresses `/api/v1`,
`/mcp`), `web/db/migrations/003_jetons_api.sql`, `web/app/atelier/account-api.tsx` (page).
