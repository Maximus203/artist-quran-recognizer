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

Ouvrir l'URL affichée par Next.js. L'atelier lance la cascade (FastConformer partout, Whisper et Muno réécoutent les fenêtres douteuses, arbitre acoustique : ADR-0009) et le segmenteur de récitation ; l'interface ne propose plus de choisir le moteur. `AQR_ASR=fastconformer` (ou `whisper`, `muno-streaming`) force un moteur seul, pour une mesure. La première analyse peut durer plusieurs minutes. Le temps affiché est réel, sans pourcentage simulé. Un échec de modèle, de corpus ou d'extraction apparaît dans la session.

## Écoute exacte et pistes synchronisées

Le lecteur ne joue pas le fichier importé mais sa **copie d'écoute** : le même décodage ffmpeg que le moteur (mono, 16 kHz), en WAV PCM, rangé dans `sessions/<id>/listening/`. Raison : dans un MP3 à débit variable (cas des fichiers extraits de vidéos), le navigateur se positionne à plusieurs secondes de l'instant demandé (mesuré sur 45 min : +7,9 s à 42:22, −10,3 s à 20:00), alors que les temps du JSON sont comptés sur le PCM du moteur. Avec la copie d'écoute, l'écart mesuré est inférieur à 0,05 s et la durée est identique à l'échantillon près. Le badge du lecteur l'indique (« ÉCOUTE = AUDIO DU MOTEUR ») ; si ffmpeg échoue, l'original est joué et le badge passe à « ORIGINAL · POSITION APPROXIMATIVE ».

- La copie est préparée en tâche de fond dès l'import (≈ 20 s pour 45 min), sinon à la première écoute ; elle est régénérée si l'audio source change. `AQR_FFMPEG` désigne l'exécutable (défaut : `ffmpeg` du PATH, comme le moteur).
- Fichiers dérivés : jamais dans le pack ZIP, jamais comptés comme activité de revue (`AQR_SESSION_TTL_S`), supprimés avec la session.
- La forme d'onde vient des crêtes calculées par le serveur (`GET /api/sessions/<id>/peaks`, `aqr.listening-peaks/1`, 50 par seconde) : rien n'est décodé dans le navigateur, même pour 2 h d'audio.
- Les intervalles du moteur sont posés **sur la forme d'onde** (référence du verset quand la place le permet) ; un clic place le lecteur sur leur début. La **fenêtre visible** (fichier entier, 10 min, 2 min, 30 s, 10 s) règle à la fois la forme d'onde et les pistes, qui partagent un seul repère temporel. « Suivre la lecture » garde la tête de lecture au centre.
- « Écouter ce passage », sur la carte, joue exactement l'intervalle affiché puis s'arrête.

## Tester un audio

1. **Nouvel essai** (bouton de la barre du haut) : déposer ou choisir **plusieurs** audios et vidéos d'un coup (MP3, M4A, WAV, OGG, OPUS, FLAC, AAC ou WebM ; 300 Mo maximum par défaut — MP4, MKV, MOV, AVI, M4V ou WebM ; 2 Gio maximum par défaut, seule la piste sonore est analysée). Chaque fichier est importé dès qu'il est choisi et **mis dans la file d'analyse** (`autorun`) ; un glisser-déposer n'importe où dans la page fait la même chose. Un seul fichier s'ouvre tout seul ; plusieurs restent dans la file, visible dans le panneau des sessions. Ou « Enregistrer une récitation » : autoriser l’accès au micro sur `127.0.0.1`, démarrer, surveiller la durée, arrêter, réécouter et recommencer ; « Analyser cette récitation » importe les octets originaux WebM/OGG/M4A et met l'analyse en file. Un refus d’accès ou un micro indisponible affiche une erreur ; aucun fichier n’est créé avant le choix d’analyser.
2. Facultatif (accordéon « Importer aussi un résultat existant ») : un JSON `aqr.recognition/1` du **même audio**. Le hash SHA-256 est contrôlé ; la prédiction importée garde ses octets d'origine ; le moteur ne tourne pas.
3. Le panneau des sessions montre l'état de chaque analyse : en attente (rang dans la file), en cours (estimation du temps restant), terminée non lue (point), lue, en échec, annulée. Ouvrir une session terminée efface son point.
4. Utiliser l'onde, les pistes, la liste des intervalles et le lecteur pour écouter. Les hypothèses déduites et les abstentions ont leurs propres affichages. « Sans temps » ne déplace pas le lecteur.
5. **Signaler** (panneau de droite) : donner un pseudonyme, délimiter le passage (voir « Revue humaine »), choisir des puces, confirmer. La revue se sauvegarde sur cet ordinateur ; vérifier l'indicateur « Enregistré sur cet ordinateur ».
6. Télécharger le pack ZIP complet (onglet « Signalements ») pour le transférer dans un environnement cloud autorisé. Il contient l'audio, la prédiction originale, la revue courante (tous les testeurs), ses révisions et un manifeste d'empreintes SHA-256. Le bilan JSON seul est aussi disponible. Le stockage cloud, les droits sur des voix tierces et une vérité terrain exhaustive restent à établir avant d'annoncer des métriques.

## Interface : design, panneaux, polices

Direction « Encre & lapis » (`docs/design/atelier-direction.md`, tokens dans `docs/design/tokens.css`). `app/tokens.css` en est la copie, **identique** (un test le vérifie) ; aucune feuille ne porte de valeur visuelle en dur. Chaque zone a son composant (`app/atelier/*`) ; la logique pure vit dans `lib/` et est testée.

- **Thème** : suit le système, bascule mémorisée (`aqr.ui.v1` dans le `localStorage`). Un petit script dans `<head>` pose thème, police arabe et taille **avant** le premier rendu (pas de flash).
- **Panneaux** : sessions à gauche, revue humaine à droite, repliables (état mémorisé). Sous 1280 px ce sont des tiroirs (focus piégé, Échap, voile). La pastille du bouton de gauche signale du non lu ou une analyse en cours panneau fermé ; le titre de l'onglet porte le total non lu. Le panneau de revue n'existe que sur une session ouverte.
- **Mobile (375 px)** : le passage actif passe avant la console, le lecteur est ancré en bas, le bouton drapeau du lecteur pose le début/la fin d'un signalement sans ouvrir le tiroir.
- **Rafraîchissement** : la liste est sondée toutes les 3 s onglet visible avec une analyse active (10 s sinon, 15 s en arrière-plan) et au retour de l'onglet. Le point « non lu » ne disparaît que lorsqu'on **ouvre** le résultat (`POST /api/sessions/<id>/viewed`), jamais par le sondage.
- **Raccourcis** : `M` (début puis fin), `P` (point), `L` (boucle), `Échap` (annuler la pose), `Ctrl+Entrée` (confirmer), `Espace` (lecture). Inactifs dans un champ de saisie, désactivables dans « Raccourcis clavier ».

### Polices

- **Latines (SIL OFL 1.1), embarquées** dans `public/fonts/` avec leur texte de licence : Instrument Serif, Atkinson Hyperlegible Next et Mono (woff2, sous-ensemble latin). Aucune requête vers un service de polices : l'atelier fonctionne hors ligne. Repli défini dans les tokens si un fichier manque.
- **Arabes (SIL OFL 1.1), embarquées** : Amiri Quran, Scheherazade New, Noto Naskh Arabic.
- **KFGQPC Uthmanic Hafs V30** (choix du mainteneur) : fichier sous licence « tous droits réservés » du Complexe du Roi Fahd. **Jamais dans Git ni dans `public/`** (le dépôt l'ignore, un test le garantit). Il est servi par `GET /api/fonts/kfgqpc-hafs-v30` depuis le dossier **`AQR_FONTS_DIR`** (défaut explicite : `%LOCALAPPDATA%\aqr-fonts` sous Windows, `$XDG_DATA_HOME/aqr-fonts` ou `~/.local/share/aqr-fonts` ailleurs), nom de fichier `KFGQPC-Hafs-V30.ttf`, liste blanche stricte de noms (aucun chemin n'est construit à partir de la requête), **boucle locale seulement** : même en mode test distant avec jeton, un hôte autorisé ne reçoit jamais la police. Absente, l'option est grisée avec l'explication et la pile retombe sur Amiri Quran. Sans choix mémorisé, Hafs V30 est préférée quand elle est installée. `GET /api/fonts` dit quelles polices locales sont présentes.
- Le sélecteur (« Police arabe » dans la carte du passage) règle police et taille (28 à 72 px par pas de 4), avec aperçu en direct, mémorisé. L'aperçu utilise le début du passage affiché (texte du corpus) ou des lettres arabes qui ne sont pas du Coran.

### Formules et basmala (invariant I1)

La carte du passage montre la **basmala** comme un verset (arabe du corpus, traduction QuranEnc, badge « Basmala ») dès que la sortie JSON porte son texte. **Isti'adha, takbir et âmîn** sont des constantes de l'interface (`lib/formulas.ts` : arabe + traduction française) affichées avec la mention « Formule — hors Mushaf, traduction indicative (non QuranEnc) » : elles ne viennent ni du corpus ni de QuranEnc et ne sont jamais présentées comme telles. Les `[1]` des traductions sont stylés en exposant **à l'affichage seulement** (la chaîne n'est jamais modifiée, I2).

## Revue humaine (`aqr.review/2`)

Trois onglets : **Signaler**, **Signalements** et, avec `?relecteur=1` seulement, **Vérité terrain** (il écrit dans le manifeste de test : les testeurs qui utilisent la machine n'y touchent pas).

- **Délimiter** : un seul bouton « Marquer le début » puis « Marquer la fin » (`M`), un point (`P`), ou **tracer sur l'onde** (mode « Tracer sur l'onde » ou `Maj` + glisser : glisser = plage, toucher = point ; `touch-action: none` en mode tracé). Une plage dure au moins 0,2 s ; les valeurs sont au dixième de seconde. Les poignées de la plage s'ajustent à la souris, au doigt ou aux flèches (0,1 s ; `Maj` : 1 s), ou avec − / + / « caler sur la lecture ».
- **Brouillon** enregistré dès la pose (puis 500 ms après chaque frappe), écoute de la plage (en boucle possible ; l'écoute est **indicative**, elle ne bloque pas la confirmation), 23 puces en 7 familles (`lib/review-presets.ts`, la seule source des libellés), verset attendu (`sourate:verset`, vérifié), commentaire (3 000 caractères). Un signalement se confirme avec au moins une puce ou un commentaire.
- **Suppression** sans boîte de dialogue : « Annuler » pendant 6 s, ensuite elle devient réelle.
- **Testeur** : pseudonyme libre de 2 à 24 caractères (lettres, chiffres, espace, `- _ .`, jamais une adresse e-mail), mémorisé avec les 8 derniers, copié dans chaque signalement. Modifier le signalement d'un autre testeur est permis avec un encart ; son nom reste (`updated_by` note le modificateur).
- **Liste** : filtres testeur et état (ils valent aussi sur l'onde et la piste Revue), clic = saut à l'instant et surlignage de la plage ; losange plein = confirmé, creux = brouillon.

**Modèle.** `aqr.review/2` ajoute à chaque annotation `tags` (puces, ids stables), `tester`, `updated_by?`, `created_at` ; `type` (historique d'`aqr.review/1`) est dérivé du premier tag pour ne pas changer les exports. La lecture est rétro-compatible : une revue `aqr.review/1` se lit avec des `tags` dérivés de `type` et `tester: "inconnu"` (le fichier n'est réécrit qu'au premier enregistrement).

**Écriture multi-testeurs.** `GET /api/sessions/<id>/review` renvoie la revue complète. `PUT /api/sessions/<id>/review` ne **remplace** plus la liste : le client n'envoie que ce qu'il a modifié (`annotations`) et ce qu'il supprime (`deleted_ids`), le serveur **fusionne par `id`** sous verrou (lecture, fusion, écriture) — le dernier `updated_at` gagne par identifiant, `tester` et `created_at` ne changent jamais après la création — et répond `{ saved, review }` avec la revue fusionnée. Le client la rafraîchit aussi toutes les 15 s. Une révision de l'état précédent est conservée à chaque changement réel.

## File d'attente, vidéos, « non lu » et durées (contrat d'API)

Plusieurs analyses peuvent être lancées à la suite (audios et vidéos) : le serveur les met en **file FIFO** et n'en exécute qu'une à la fois (la carte graphique n'aime pas le parallèle). Le client envoie un fichier par requête, autant de fois qu'il veut, et revient plus tard.

| Variable | Rôle | Défaut |
| --- | --- | --- |
| `AQR_MAX_CONCURRENT` | analyses exécutées en même temps (entier ≥ 1 ; invalide = 1). Lue à chaque démarrage d'analyse | `1` |
| `AQR_MAX_VIDEO_UPLOAD_BYTES` | plafond d'une **vidéo** envoyée en flux (`413` au-delà). Une vidéo garde son image sur le disque alors que seul le son sert : 2 Gio couvrent 1 h 30 de 1080p courant | 2 Gio |
| `AQR_MAX_UPLOAD_BYTES` | plafond d'un **audio** en flux, et de tout envoi par formulaire multipart (lu en mémoire) | 300 Mo |
| `AQR_FFPROBE` | exécutable ffprobe (défaut : voisin de `AQR_FFMPEG`, sinon `ffprobe` du PATH, comme le moteur) | — |

### Importer (`POST /api/sessions`)

- **En flux (recommandé, seul adapté à une vidéo)** : le corps est le fichier lui-même, écrit directement sur le disque (jamais lu en mémoire), empreinte calculée au vol.
  ```js
  await fetch("/api/sessions?autorun=1", {
    method: "POST",
    headers: {
      "x-aqr-filename": encodeURIComponent(file.name), // obligatoire (extension reconnue)
      "x-aqr-source-kind": "file",                      // ou "microphone" (facultatif)
      "content-type": file.type || "application/octet-stream",
    },
    body: file, // le navigateur lit le File par morceaux
  });
  ```
- **Formulaire multipart** (compatibilité) : champ `audio` (ou `media`), `result` facultatif (JSON `aqr.recognition/1` du même audio), `source_kind`, `autorun=1`. Lu en mémoire : plafond `AQR_MAX_UPLOAD_BYTES` pour tous les types.
- `?autorun=1` (ou `true` ; ou le champ `autorun` du formulaire) met l'analyse en file dès l'import ; la réponse est alors la session déjà `queued` ou `running`. Si la mise en file échoue (moteur non configuré…), l'import n'est pas perdu : la session reste `ready` et la réponse porte `autorun_error`.
- Réponses : `201` + session ; `400` format non accepté / fichier vide / flux interrompu / résultat d'un autre audio ; `413` au-delà du plafond ; `422` **fichier sans piste audio** (vidéo muette) ou **illisible/corrompu** (audio comme vidéo : refus à l'import, pas un échec de l'analyse plus tard), dans les deux cas rien n'est conservé ; `403` hors accès local.
- Formats : audio MP3, M4A, WAV, OGG, OPUS, FLAC, AAC, WebM ; vidéo MP4, MKV, MOV, AVI, M4V (et WebM). ffprobe sonde le fichier à l'import (piste audio présente, durée de la **piste audio**, pas du conteneur) ; sans ffprobe le fichier est accepté sans durée (et sans estimation) et c'est le moteur qui refusera un fichier sans audio. Helpers côté client : `lib/audio-upload.ts` (`mediaAccept`, `isAcceptedMediaName`, `isVideoName`, `acceptedMediaFiles`, `bindMediaDrop` pour un dépôt multiple).

### États et champs d'une session (`GET /api/sessions`, `GET /api/sessions/<id>` → `session`)

`GET /api/sessions` renvoie un tableau, les plus récentes d'abord. Champs ajoutés (les anciens sont inchangés) :

| Champ | Type | Sens |
| --- | --- | --- |
| `state` | `ready` · `queued` · `running` · `done` · `failed` · `cancelled` | `queued` = en attente de la file |
| `queue_position` | entier ≥ 1 ou `null` | rang dans l'attente (1 = la prochaine) ; calculé à la lecture, `null` hors attente |
| `queued_at` | ISO ou `null` | mise en file ; strictement croissant dans l'ordre de la file, c'est l'ordre FIFO durable (reste renseigné après le départ) |
| `started_at` / `finished_at` | ISO ou `null` | départ réel du processus / fin (réussite, échec ou annulation, y compris d'une analyse annulée avant d'avoir démarré : `started_at` reste `null`) |
| `duration_s` | secondes ou `null` | durée **réelle** du traitement (fin − départ) |
| `audio_duration_s` | secondes ou `null` | durée de l'audio : sonde à l'import, puis valeur exacte du moteur (`source.duration_s`) à la fin |
| `engine` | `cascade` · `fastconformer` · `whisper` · `muno-streaming` ou `null` | moteur de l'analyse |
| `elapsed_s` | secondes ou `null` | temps écoulé depuis le départ (en cours seulement) |
| `eta_s` | secondes ou `null` | **reste à attendre** : en cours = estimation − écoulé (jamais négatif) ; en attente = ce qui la précède + sa propre durée. `null` = « estimation indisponible » |
| `eta_range_s` | `[min, max]` ou `null` | fourchette p10–p90 observée en validation croisée (en cours, ≥ 4 analyses du moteur) |
| `eta_reason` | voir ci-dessous ou `null` | pourquoi `eta_s` est `null` |
| `eta_overrun` | booléen | en cours depuis plus longtemps que prévu : `eta_s` vaut `0` sans que la fin soit proche |
| `viewed_at` | ISO, `null` ou **absent** | ouverture du résultat (voir « non lu ») |
| `unread` | booléen | `state` ∈ {`done`, `failed`} **et** `viewed_at === null` |

`eta_reason` : `no_history` (aucune analyse terminée de ce moteur), `insufficient_history` (moins de 3), `history_too_narrow` (audios de durées trop proches pour lire une pente), `out_of_range` (audio plus de 2× plus long que tout l'historique : pas d'extrapolation), `audio_duration_unknown`, `ahead_unknown` (une analyse devant elle n'a pas d'estimation). **Aucun chiffre n'est jamais inventé.**

**Estimation.** Le facteur temps réel (RTF = durée de traitement / durée audio) n'est pas constant : les modèles se chargent à chaque analyse (≈ 50 s fixes), donc 18 s d'audio coûtent ≈ 60 s (RTF ≈ 3) et 1 h d'audio ≈ 110 s (RTF ≈ 0,03). L'estimation est donc `durée = chargement + coût × audio`, ajustée **par moteur** sur les analyses terminées (droite robuste de Theil–Sen : quelques analyses lancées en parallèle, donc lentes, ne la déplacent pas). Mesure en validation croisée sur les 33 analyses FastConformer réelles : erreur relative médiane **11 %** (contre 38 % pour un RTF médian), p90 28 %. `GET /api/stats` expose le modèle et la dispersion du RTF.

**Non lu.** `viewed_at` est mis à `null` à la fin de chaque analyse (réussite **ou** échec) et posé par `POST /api/sessions/<id>/viewed`, que l'interface appelle quand l'utilisateur **ouvre le résultat**. Un `GET` ne marque jamais comme vu (le sondage de la liste n'efface pas le point). Migration : une session créée avant ce suivi n'a pas de champ `viewed_at` (absent) et est considérée **lue** : aucun point fantôme. Un résultat importé à la main (JSON joint) est créé déjà vu.

### Routes

- `POST /api/sessions/<id>/run` — met en file : `200 { state: "running" | "queued", queue_position }` ; `400` si la session tourne, attend déjà, a déjà un résultat, ou si `AQR_MODELS_DIR` manque. Corps facultatif `{ "asr": "…" }` ; sans moteur, celui de l'atelier (`AQR_ASR`, cascade par défaut) ; un corps illisible ou qui n'est pas un objet JSON est refusé (`400`) au lieu d'être ignoré. `404` si la session n'existe pas.
- `DELETE /api/sessions/<id>/run` — annule : une analyse **en attente quitte la file** sans jamais démarrer, une analyse en cours voit son processus tué ; la suivante démarre. `400` s'il n'y a rien à annuler, `404` si la session n'existe pas.
- `DELETE /api/sessions/<id>` — supprime aussi une session **en attente** (retirée de la file) ; refus (`400`) tant qu'elle tourne, `404` si inconnue. Les lancements, annulations et suppressions sont traités dans l'ordre d'arrivée : jamais de session fantôme recréée par une écriture tardive.
- `POST /api/sessions/<id>/viewed` — idempotent, accès local requis (même garde que les autres mutations) : `200 { id, state, viewed_at, unread }` ; sans effet (`viewed_at` reste `null`) tant que la session n'est ni `done` ni `failed` ; `404` si inconnue.
- `GET /api/stats` — par moteur : `analyses`, `failures`, `audio_total_s`, `processing_total_s`, `rtf` (`median`, `p90`, `mean`, `min`, `max`), `estimate` (`overhead_s`, `seconds_per_audio_s`, `samples`, `audio_max_s`, `loo_median_rel_error`) ou `estimate_unavailable` (raison) ; `queue` (`concurrency`, `running`, `waiting` avec `eta_s`) ; `recent` (10 dernières analyses terminées, avec leur `rtf`). Une « analyse » est une session lancée par l'atelier (`started_at`) ; un résultat importé à la main n'en est pas une. Pur calcul sur les sessions, aucune donnée nouvelle.

### Robustesse

- **Erreurs lisibles** : aucun message d'API ni `session.error` ne contient de chemin local ni de code système brut (« Fichier introuvable sur le disque… », « Session introuvable » en `404`).
- **Redémarrage** : au démarrage du serveur (`instrumentation.ts`, et à la première requête sinon), les sessions `queued` sans traitement reprennent leur place dans l'ordre de `queued_at`. Une session `running` dont le processus est mort passe `failed` (« Le traitement s'est arrêté… », non lue). Un processus d'un serveur précédent encore vivant garde sa place : la file attend sa fin avant de lancer la suivante.
- **Sans course** : deux lancements simultanés (même session ou sessions différentes) ne démarrent jamais deux fois le moteur au-delà de `AQR_MAX_CONCURRENT` ; l'issue d'une analyse n'est jamais écrasée par un écrasement tardif de `session.json` (écritures atomiques, reprise des refus passagers de Windows `EPERM`/`EBUSY` quand un autre lecteur ouvre le fichier).
- **Purge** (`AQR_SESSION_TTL_S`) : une session en attente n'est jamais purgée.

## Performance

L'onglet « Performance » (barre du haut ; pied du tiroir de gauche sur mobile) dit combien de temps prend une analyse et à quelle vitesse : durée moyenne, vitesse médiane (« ×7,1 » = 7 fois plus vite que l'audio), audio traité (dont vidéo), file d'attente, vitesse par moteur (barres d'une seule teinte, nommées et chiffrées, avec une vue en tableau), file en cours avec estimation et dernières analyses. Les tuiles, les moteurs et le tableau sont calculés sur les sessions terminées de la **période choisie** (7 jours, 30 jours, tout) à partir de `GET /api/sessions` ; la file en cours et la précision de l'estimation viennent de `GET /api/stats` (rafraîchi toutes les 5 s onglet visible). Aucun chiffre n'est inventé : une analyse sans durée mesurée n'entre dans aucune moyenne.

## Construire la vérité terrain (onglet « Vérité terrain », `?relecteur=1`)

Une fois la reconnaissance terminée (ou une prédiction importée) sur un fichier **dev** du manifeste :

1. « Proposer les passages du moteur » : les versets reconnus ou supposés proches sont regroupés en passages
   (≤ 110 s) avec une déclaration pré-remplie, à corriger. Ce n'est pas une vérité terrain.
2. Corriger chaque déclaration (« Versets récités, dans l'ordre ») : versets `1:2-1:7`, plage de mots
   `21:56[5-8]` (reprise), formules `amin`, `takbir`, `istiadha`, `basmala` à leur place. Ajuster début et fin
   du passage si besoin, ou ajouter un passage à partir de la position de lecture.
3. « Aligner N passage(s) » : l'alignement forcé du texte du corpus pose le temps de chaque verset (un seul
   chargement du modèle ; ≈ 2 min pour 34 passages d'une prière de 52 min sur RTX 5090). La preuve acoustique
   s'affiche ; en rouge, la déclaration colle mal (reprise oubliée, verset en trop, passage trop court).
4. Écouter chaque verset (▶), puis « Valider après écoute » ou « Exclure » (douteux, non coranique). Un passage
   modifié repasse « à aligner ».
5. « Écrire N passage(s) validé(s) dans le manifeste » avec un identifiant **anonyme** de relecteur (`rel-01`).
   Les passages deviennent des fenêtres annotées de `tests/fixtures/audio/manifest.yaml` (`AQR_MANIFEST` pour
   un autre fichier) : refus pour un fichier test ou en quarantaine. Committer ensuite le manifeste seul.

Fichiers de la session : `validation.json` (déclarations et statuts), `alignment/` (plan, sortie d'alignement,
document des passages validés). Contrat : `docs/ALIGN-OUTPUT.md`.

Les sessions micro sont marquées `source_kind: microphone` dans `session.json`. Le manifeste du pack (`aqr.review-bundle/1`) indique l’empreinte audio, celle de chaque résultat et correction, ainsi que les versions déclarées par le moteur. Les fichiers restent dans `AQR_REVIEW_DIR/sessions/<id>` hors Git et ne sont pas supprimés automatiquement. Pour les réutiliser sur le cloud, conserver le ZIP dans un stockage privé puis ajouter au manifeste versionné `docs/data-lots/lot-N.yaml` uniquement les métadonnées vérifiées (empreinte, durée, catégorie, droits et emplacement privé). Aucun enregistrement micro n’est publié automatiquement.

Le serveur est réservé à un usage local de confiance. Le pack de revue ne modifie jamais la prédiction. Les signalements partiels ne sont pas évalués comme vérité terrain. Les données conservées ne sont pas supprimées automatiquement.

## Mode test distant (optionnel, protégé)

Par défaut l'atelier n'accepte que la boucle locale (`127.0.0.1`, `localhost`, `[::1]`). Pour un test depuis une autre machine (VM, tunnel, proxy), activer explicitement :

| Variable | Rôle | Défaut |
| --- | --- | --- |
| `AQR_ALLOWED_HOSTS` | noms d'hôte supplémentaires acceptés, séparés par des virgules (sans port) | vide |
| `AQR_ACCESS_TOKEN` | jeton d'accès, **obligatoire** pour qu'un hôte supplémentaire soit accepté ; une fois défini il protège aussi le loopback. Choisir ≥ 24 caractères aléatoires | absent |
| `AQR_ACCESS_TTL_S` | durée de vie (s) du cookie d'accès délivré par `/access` (1 à 604800) | 3600 |
| `AQR_MAX_UPLOAD_BYTES` | plafond d'upload d'un audio ou d'un formulaire (refus `413` dès l'en-tête `Content-Length`) ; les vidéos ont `AQR_MAX_VIDEO_UPLOAD_BYTES` (voir « File d'attente ») | 300 Mo |
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

1. `pytest -m slow tests/e2e` : `aqr recognize` réel (CPU ; moteur au choix, Whisper par défaut, voir « Moteur du smoke »). `tests/support/corpus_check.py` (`assert_matches_corpus`, même sémantique que `HomeRenderer.span_text`) contrôle chaque verset nommé : texte égal au corpus (verset entier) ou sous-chaîne exacte des mots `first..last` (verset partiel), plage de mots dans le verset, drapeau `partial` cohérent, sourate 112 uniquement (I3), `UNCERTAIN` sans texte, au moins un verset RECOGNIZED.
2. `npm run smoke:browser` (`web/e2e/browser-smoke.mjs`, `playwright-core`) : import de l'audio, moteur réel, puis lecture de `GET /api/sessions/<id>` (une session `failed` fait échouer immédiatement avec son erreur) ; le résultat passe par le même `corpus_check`, chaque segment RECOGNIZED cliqué affiche le badge « Reconnu » et un texte arabe strictement égal à `interval.text`. Le pack ZIP téléchargé est ouvert et vérifié par `scripts/verify_review_bundle.py` (entrées attendues, SHA-256 recalculés, audio = manifeste = prédiction = fichier source de référence). Il lance `next start` (après `npm run build`) ou vise `AQR_SMOKE_URL` ; Chromium vient de `AQR_SMOKE_CHROMIUM` (défaut `/opt/pw-browsers/chromium`, aucun `playwright install`).

**Ressource absente (audio, ffmpeg, modèles, corpus vérifié par `LOCK.json`, Chromium, build, Python)** : le mode strict est le **défaut partout** (`pytest -m slow tests/e2e`, `npm run smoke:browser`, `scripts/smoke_e2e.sh`) : échec explicite avec la raison (pytest : erreur ; navigateur : code 2), jamais un succès muet. Seul `AQR_SMOKE_STRICT=0`, posé explicitement, autorise le skip : le test est alors sauté avec la raison et un résumé « NON EXÉCUTÉ » le dit en toutes lettres. `node e2e/browser-smoke.mjs --check` ne vérifie que les ressources. `scripts/smoke_e2e.sh` n'accepte que `all`, `cli` ou `browser` (autre valeur : usage, code 2). Le `pytest` ordinaire n'est pas concerné : ces tests portent le marqueur `slow`.

Ces smokes appellent les vrais modèles : plusieurs minutes sur CPU.

### Moteur du smoke (Whisper ou FastConformer)

`AQR_SMOKE_ASR=whisper` (défaut), `fastconformer` ou `muno-streaming` choisit le moteur du smoke **CLI** ; `scripts/smoke_e2e.sh` le transmet aussi au **navigateur**. Le navigateur le lisait déjà sous le nom `AQR_ASR` (inchangé) : `AQR_SMOKE_ASR` est prioritaire, `AQR_ASR` seul reste accepté, et les deux ne doivent pas se contredire (le script refuse, code 2). Une valeur inconnue est un **échec en strict** qui nomme les valeurs acceptées (`whisper | fastconformer | muno-streaming`), jamais un repli silencieux ; avec `AQR_SMOKE_STRICT=0` explicite, elle est sautée et annoncée « NON EXÉCUTÉ ».

- **Modèles du moteur choisi** : le contrôle de ressources porte sur `whisper-base-quran` ou `fastconformer-quran` (plus le segmenteur de récitation), tels qu'épinglés dans `models/LOCK.json`.
- **Interpréteur** : `AQR_PYTHON` est celui du **moteur** (CLI `aqr recognize` et atelier web). FastConformer exige le venv NeMo, qui n'a pas forcément pytest : pytest tourne alors sous `AQR_PYTEST_PYTHON`, sinon sous `AQR_PYTHON` s'il sait importer pytest, sinon sous `python` du PATH. Un interpréteur sans le module du moteur (`nemo` pour FastConformer, `transformers` pour Whisper) est un manque nommé, avec l'interpréteur fautif.

```bash
# Whisper (défaut)
bash scripts/smoke_e2e.sh cli
# FastConformer : l'interpréteur du moteur est le venv NeMo
AQR_SMOKE_ASR=fastconformer AQR_PYTHON=/chemin/venv-nemo/bin/python bash scripts/smoke_e2e.sh cli
# sans le script (pytest sous l'interpréteur de développement) :
AQR_SMOKE_ASR=fastconformer AQR_PYTHON=/chemin/venv-nemo/bin/python pytest -m slow tests/e2e -rs
# navigateur : le même nom (ou l'ancien AQR_ASR)
AQR_SMOKE_ASR=fastconformer AQR_PYTHON=/chemin/venv-nemo/bin/python npm run smoke:browser
```

## Vérification

```powershell
cd web
npm test
npm run typecheck
npm run format:check
npm run build
```
