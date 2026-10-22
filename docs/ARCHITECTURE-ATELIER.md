# Architecture de l'atelier web

> L'atelier (dossier `web/`) est l'application où l'on dépose des audios, on suit leur analyse, on écoute
> les versets trouvés et on signale les erreurs. Ce document décrit ce qui **existe aujourd'hui**, puis, dans
> une section à part clairement marquée, ce qui est **en cours de construction** (phase 2).
> Source de vérité détaillée : `web/README.md` (contrats d'API, variables) et le code de `web/lib/`.
> L'architecture du **moteur** (Python) est dans `docs/ARCHITECTURE.md`.

## 1. En deux phrases

L'atelier est une application **Next.js 16 (App Router, React 19, TypeScript)** qui ne contient **aucune
reconnaissance** : pour chaque analyse, elle lance le moteur Python existant (`python -m aqr.cli recognize`)
comme un processus séparé, relit son fichier JSON `aqr.recognition/1`, et l'affiche. Tout est stocké sur le
disque de la machine, dans un dossier hors Git ; aucune base de données, aucun envoi vers le cloud.

## 2. Vue d'ensemble

```
 Navigateur (React 19)                          Serveur Next.js (Node)                    Disque / moteur
 ─────────────────────                          ───────────────────────                   ───────────────
  panneau Sessions  ──── POST /api/sessions ───▶  import en flux, ffprobe  ───────────▶  sessions/<id>/source.<ext>
  onde + pistes     ◀── GET  …/peaks ──────────   copie d'écoute (ffmpeg)  ───────────▶  sessions/<id>/listening/
  lecteur           ◀── GET  …/audio ──────────   (WAV PCM mono 16 kHz)
  carte du passage                                  │ ?autorun=1
  revue humaine     ── PUT  …/review ──────────▶   file FIFO (queue.ts) ──▶ jobs.ts ──▶  python -m aqr.cli recognize
                    ◀── GET  …/review ─────────    fusion par id, sous verrou                │  (GPU, cascade)
  Performance       ◀── GET /api/stats                                                        ▼
                                                  session.json ◀── issue consignée ◀──  prediction.recognition.json
```

## 3. Où est quoi

| Zone | Fichiers | Rôle |
|---|---|---|
| Pages | `web/app/page.tsx`, `review-app.tsx`, `app/atelier/*` | Une seule page : barre du haut, panneau Sessions à gauche, console au centre, revue humaine à droite. Un composant par zone. |
| Routes API | `web/app/api/**/route.ts` | Voir §4. Les routes de données exigent un accès local autorisé (§9). |
| File d'attente | `web/lib/queue.ts` | File FIFO pure (sans disque ni processus). |
| Lancement | `web/lib/jobs.ts`, `python.ts` | Démarre le processus du moteur, consigne l'issue, annule, reprend après redémarrage. |
| Stockage | `web/lib/store.ts`, `session-meta.ts` | Lecture et écriture atomique de `session.json`, revue, révisions, purge. |
| Écoute | `web/lib/listening.ts` | Copie d'écoute et crêtes de la forme d'onde (§6). |
| Revue | `web/lib/review.ts`, `review-update.ts`, `review-presets.ts` | Schéma `aqr.review/2`, fusion multi-testeurs, puces. |
| Estimation | `web/lib/estimate.ts`, `performance.ts` | Durée prévue d'une analyse et page Performance. |
| Sécurité | `web/lib/local-request.ts` | Contrôle des hôtes, origine et jeton (§9). |
| Polices | `web/lib/font-files.ts`, `quran-fonts.ts`, `app/api/fonts/*` | Polices arabes, dont la Hafs hors Git (§10). |
| Design | `web/app/tokens.css`, `docs/design/` | Direction « Encre & lapis », variables de style centralisées. |

Principe de code : la logique est dans `web/lib/` sous forme de fonctions **pures et testées** ; les composants
ne font que l'afficher.

## 4. Les routes API

| Route | Rôle |
|---|---|
| `GET /api/sessions` · `POST /api/sessions` | Liste (les plus récentes d'abord) · import d'un fichier (envoi en flux recommandé ; `?autorun=1` met l'analyse en file). |
| `GET /api/sessions/<id>` · `DELETE …` | Session, résultat et revue · suppression (refusée si elle tourne ; `409` si elle porte un travail de revue, sauf `?force=1`). |
| `POST /api/sessions/<id>/run` · `DELETE …/run` | Mettre en file une analyse · l'annuler (en attente : elle quitte la file ; en cours : le processus est arrêté). |
| `POST /api/sessions/<id>/viewed` | Marquer le résultat comme ouvert (efface le point « non lu »). |
| `GET /api/sessions/<id>/audio` | Audio du lecteur : la copie d'écoute (§6). |
| `GET /api/sessions/<id>/peaks` | Crêtes de la forme d'onde, `aqr.listening-peaks/1`, 50 par seconde. |
| `GET` / `PUT /api/sessions/<id>/review` | Lire la revue · enregistrer (fusion par identifiant, §7). |
| `GET /api/sessions/<id>/export` · `…/bundle` | Bilan JSON seul · pack ZIP complet. |
| `GET` / `POST /api/sessions/<id>/validation` | Vérité terrain (onglet réservé, `?relecteur=1`). |
| `GET /api/stats` | Vitesse par moteur, file en cours, précision de l'estimation. |
| `GET /api/fonts` · `GET /api/fonts/<nom>` | Polices locales présentes · service de la police Hafs (boucle locale seulement). |
| `POST /api/access` · page `/access` | Échange du jeton d'accès contre un cookie (mode test distant). |

## 5. La file d'attente FIFO

**Pourquoi.** La carte graphique supporte mal deux analyses en parallèle. L'atelier met donc les analyses en
file et n'en exécute qu'**une à la fois** (`AQR_MAX_CONCURRENT`, 1 par défaut). Cherif peut déposer plusieurs
audios et vidéos d'un coup et revenir plus tard (PR #64).

```
  import ?autorun=1 ──▶ state = queued  (queued_at, strictement croissant)
                              │   rang calculé à la lecture : queue_position
                              ▼
                   [ file FIFO en mémoire : queue.ts ]
                              │  une place se libère
                              ▼
          jobs.ts : lance le processus Python ──▶ state = running  (started_at)
                              │  fin du processus
                              ▼
        done | failed | cancelled   (finished_at, duration_s, viewed_at = null → « non lu »)
```

Points de conception (commentaires de `queue.ts` et `jobs.ts`) :

- **La file ne persiste rien.** L'ordre durable est `queued_at` dans `session.json`. Au démarrage du serveur
  (`web/instrumentation.ts`), les sessions `queued` reprennent leur place dans cet ordre ; une session
  `running` dont le processus est mort passe `failed` avec un message lisible.
- **Pas de course.** Tout ce qui est synchrone dans la file (ajouter, retirer, démarrer) s'exécute sans
  `await` : deux appels simultanés ne peuvent pas démarrer deux fois la même tâche ni dépasser la
  concurrence. Un seul rédacteur consigne l'issue d'une analyse.
- **Annuler** une analyse en attente la retire de la file sans qu'elle démarre ; annuler une analyse en
  cours arrête son processus et la suivante démarre.
- **L'estimation de durée** (`eta_s`) vient de l'historique réel, par moteur : `durée = chargement des
  modèles + coût × durée de l'audio`, ajustée par une droite robuste. Sans historique suffisant, la valeur
  est `null` avec sa raison (« estimation indisponible ») : **aucun chiffre n'est inventé**. Validation
  croisée sur 33 analyses FastConformer réelles : erreur relative médiane 11 % (PR #64, `web/README.md`).

## 6. La copie d'écoute (audio du lecteur)

**Problème mesuré** (PR #60). Dans un MP3 à débit variable, le navigateur se positionne à plusieurs secondes
de l'instant demandé : sur un fichier de 45 min, un saut à 42:22 jouait l'audio de 42:30 (+7,9 s), un saut à
20:00 celui de 19:49 (−10,3 s). Or les temps du JSON sont comptés sur le son décodé par le moteur : le clic sur
un verset n'amenait pas aux bons mots.

**Solution.** Le lecteur ne joue pas le fichier importé mais sa **copie d'écoute** : le même décodage ffmpeg
que le moteur (mono, 16 kHz), écrit en WAV PCM dans `sessions/<id>/listening/` (`web/lib/listening.ts`).
Un WAV se positionne à l'échantillon près et son temps 0 est celui du moteur. Mesuré après correctif : écart
inférieur à 0,05 s, durée identique à l'échantillon près.

- Préparée en tâche de fond dès l'import (≈ 20 s pour 45 min), sinon à la première écoute ; régénérée si la
  source change.
- **Fichiers dérivés** : jamais dans le pack ZIP, jamais comptés comme activité de revue, supprimés avec la
  session.
- Si ffmpeg échoue, l'original est joué et le badge du lecteur passe à « ORIGINAL · POSITION APPROXIMATIVE ».
- La forme d'onde vient des crêtes calculées par le **serveur** : rien n'est décodé dans le navigateur, même
  pour 2 h d'audio. Un seul repère de temps (`web/lib/timeline.ts`) sert l'onde, les pistes et la tête de
  lecture.

## 7. Le modèle de revue `aqr.review/2`

La revue humaine est l'ensemble des **signalements** posés par les testeurs sur une session (« ce verset est
faux », « il manque un verset », « le temps est décalé »…).

- Chaque signalement : un **point** ou une **plage** de temps, des **puces** (23 puces en 7 familles, une seule
  source : `web/lib/review-presets.ts`), un verset attendu facultatif (`sourate:verset`), un commentaire (3 000
  caractères), un statut *brouillon* ou *confirmé*, le **pseudonyme du testeur** (2 à 24 caractères, jamais
  une adresse e-mail) et ses dates.
- **Compatibilité** : une revue `aqr.review/1` se lit toujours (puces dérivées de l'ancien type, testeur
  « inconnu ») ; on n'écrit plus que la v2.
- **Plusieurs testeurs, sans écrasement.** `PUT …/review` n'envoie pas la liste entière : le client envoie ce
  qu'il a modifié (`annotations`) et ce qu'il supprime (`deleted_ids`) ; le serveur **fusionne par
  identifiant sous verrou** (lecture, fusion, écriture) ; le dernier `updated_at` gagne par identifiant ;
  l'auteur et la date de création ne changent jamais. Une **révision** de l'état précédent est conservée à
  chaque changement réel.
- **La revue ne modifie jamais la prédiction** du moteur, et les signalements partiels ne sont pas évalués
  comme vérité terrain.

## 8. Stockage sur disque

Tout vit dans `AQR_REVIEW_DIR` (défaut : `%LOCALAPPDATA%\aqr-review` sous Windows, `~/.local/share/aqr-review`
ailleurs), **hors Git**, jamais supprimé automatiquement (sauf option `AQR_SESSION_TTL_S`, §9).

```
AQR_REVIEW_DIR/
└── sessions/
    └── <id>/                       identifiant = UUID strict (toute autre forme est rejetée)
        ├── session.json            état, dates, moteur, durées, viewed_at, empreinte SHA-256 de l'audio
        ├── source.<ext>            l'audio ou la vidéo importé(e), tel quel
        ├── prediction.recognition.json   la sortie du moteur, jamais modifiée
        ├── review.json             la revue courante (tous les testeurs), aqr.review/2
        ├── revisions/              une révision à chaque changement réel de la revue
        ├── exports/                packs ZIP générés à la demande
        ├── validation.json, alignment/   vérité terrain (onglet réservé)
        └── listening/              copie d'écoute et crêtes (dérivés, régénérables)
```

Écritures **atomiques** (fichier temporaire puis renommage, avec reprise des refus passagers de Windows
`EPERM` / `EBUSY`). Le **pack ZIP** contient l'audio, la prédiction originale, la revue courante, ses
révisions et un manifeste d'empreintes SHA-256 (`aqr.review-bundle/1`), vérifiable par
`scripts/verify_review_bundle.py`.

## 9. Sécurité

L'atelier est conçu pour un **usage local de confiance** : il n'écoute que `127.0.0.1`.

| Protection | Comment |
|---|---|
| Boucle locale par défaut | Seuls `127.0.0.1`, `localhost` et `[::1]` sont acceptés. |
| Contrôle de l'en-tête **Host** | Le nom d'hôte annoncé par le navigateur (`Host`, et `X-Forwarded-Host` derrière un proxy) doit lui aussi être autorisé. Sans cela, une page tierce dont le nom résout vers la boucle locale (**DNS rebinding**) pourrait *lire* l'atelier. Constaté puis corrigé (PR #68). |
| Contrôle de l'**origine** | Les écritures (`POST`, `PUT`, `DELETE`) exigent une origine identique ou un hôte autorisé de même protocole et port. |
| Mode test distant (optionnel) | `AQR_ALLOWED_HOSTS` ajoute des hôtes, **acceptés seulement si** `AQR_ACCESS_TOKEN` est défini (refus par défaut). Le jeton se présente par en-tête, `Bearer`, ou cookie `HttpOnly` signé (HMAC, avec expiration, `AQR_ACCESS_TTL_S`) obtenu sur `/access`. Comparaison à temps constant. |
| Identifiants de session | UUID stricts ; tout chemin (`..`, séparateurs) est rejeté. |
| Plafonds d'envoi | `AQR_MAX_UPLOAD_BYTES` (audio, 300 Mo par défaut), `AQR_MAX_VIDEO_UPLOAD_BYTES` (vidéo, 2 Gio) ; `413` dès l'en-tête. |
| Messages d'erreur | Aucun chemin local ni code système brut n'est montré à l'utilisateur. |
| Purge optionnelle | `AQR_SESSION_TTL_S` supprime les sessions **inactives** ; une revue enregistrée récemment garde la session et son historique ; une session en cours ou en attente n'est jamais purgée. |

Limite assumée : pas de limitation de débit intégrée. **Ne pas exposer l'atelier sur Internet** sans reverse
proxy ; les audios déposés restent des données privées.

## 10. Polices arabes

- **Embarquées** (licence SIL OFL 1.1, dans `web/public/fonts/` avec leur texte de licence) : Amiri Quran,
  Scheherazade New, Noto Naskh Arabic ; polices latines Instrument Serif et Atkinson Hyperlegible. Aucune
  requête vers un service de polices : l'atelier fonctionne **hors ligne**.
- **KFGQPC Uthmanic Hafs V30** (choix du mainteneur) : fichier sous licence « tous droits réservés » du
  Complexe du Roi Fahd, donc **jamais dans Git ni dans `public/`** (le dépôt l'ignore, un test le garantit).
  Il est servi par `GET /api/fonts/kfgqpc-hafs-v30` depuis le dossier `AQR_FONTS_DIR` (nom de fichier
  `KFGQPC-Hafs-V30.ttf`, liste blanche stricte de noms), **boucle locale uniquement** : même en mode test
  distant, un hôte autorisé ne reçoit jamais la police. Absente, l'option est grisée avec l'explication et
  l'affichage retombe sur Amiri Quran.
- Le choix de police et de taille est mémorisé **dans le navigateur** (`aqr.ui.v1`).

## 11. Flux de données : un texte arabe affiché, d'où vient-il ?

```
  moteur Python ──▶ JSON : { ref: "55:3", words: [1,2], text: "…", translation: {…} }
                                 │
                                 │ text = lu DANS LE CORPUS Tanzil par la référence (I1)
                                 │ translation = QuranEnc telle que reçue + id + version + attribution (I2)
                                 ▼
  atelier ──▶ affiche tel quel. Il ne fabrique jamais de texte coranique.
              Exceptions affichées comme telles : isti'adha, takbir, âmîn = constantes d'interface
              « Formule — hors Mushaf, traduction indicative (non QuranEnc) » (web/lib/formulas.ts).
              Les [1] des notes de traduction sont stylés en exposant À L'AFFICHAGE seulement.
```

La **basmala** est montrée comme un verset (texte du verset 1:1 du corpus, traduction QuranEnc, badge
« Basmala », PR #65). Seuls les intervalles de nature « verset » comptent comme versets reconnus.

## 12. Variables d'environnement

| Variable | Rôle | Défaut |
|---|---|---|
| `AQR_PYTHON` | interpréteur du moteur | `python` |
| `AQR_MODELS_DIR` | dossier des modèles (hors Git) | — (obligatoire pour analyser) |
| `AQR_CORPUS_DIR` | corpus Tanzil | `data/corpus` du dépôt |
| `AQR_REVIEW_DIR` | dossier des sessions | voir §8 |
| `AQR_FONTS_DIR` | dossier de la police Hafs | `%LOCALAPPDATA%\aqr-fonts` / `~/.local/share/aqr-fonts` |
| `AQR_ASR` | force un moteur seul (mesure) | cascade |
| `AQR_MAX_CONCURRENT` | analyses simultanées | 1 |
| `AQR_FFMPEG`, `AQR_FFPROBE` | exécutables ffmpeg / ffprobe | du `PATH` |
| `AQR_MAX_UPLOAD_BYTES`, `AQR_MAX_VIDEO_UPLOAD_BYTES` | plafonds d'envoi | 300 Mo, 2 Gio |
| `AQR_ALLOWED_HOSTS`, `AQR_ACCESS_TOKEN`, `AQR_ACCESS_TTL_S` | mode test distant | vides, 3 600 s |
| `AQR_SESSION_TTL_S` | purge des sessions inactives | 0 (désactivée) |

## 13. Comptes, partage et préférences (phase 2) — **en cours de construction**

> **Rien de ce qui suit n'existe encore.** Cette section décrit le plan, pour que le prochain contributeur
> sache où va l'architecture ; elle sera réécrite quand chaque élément sera livré (et chaque livraison aura
> sa note dans `docs/RELEASE-NOTES.md`).

**Situation actuelle (à remplacer).** Il n'y a ni compte ni mot de passe : l'atelier est mono-machine, les
sessions sont des dossiers, le « testeur » n'est qu'un pseudonyme libre mémorisé dans le navigateur, et les
préférences d'affichage (thème, police, taille, panneaux) vivent dans le `localStorage` du navigateur.

**Ce qui est prévu :**

| Élément | Intention |
|---|---|
| **Comptes** | Inscription et connexion. |
| **Base SQLite** | Premier stockage structuré : comptes, propriété des sessions, préférences, favoris. Les fichiers lourds (audio, prédiction, revue) resteraient sur le disque. |
| **Audios globaux ou privés** | Par défaut, un audio est visible de tous ; son propriétaire peut le rendre privé. |
| **Préférences par utilisateur, côté serveur** | Thème, police arabe, taille, panneaux : conservés avec le compte, plus seulement dans un navigateur. |
| **Favoris et archivage** | Mettre une session en favori ; l'archiver sans la supprimer. |
| **Pages « Sessions » et « Documentation »** | Une page dédiée à la liste des sessions ; un onglet qui affiche cette documentation (`docs/docs-index.json`). |

**Ce que cela changera pour la sécurité** (à traiter avant livraison, non décidé) : mots de passe, sessions
d'authentification, séparation entre utilisateurs, et l'exposition au-delà de la boucle locale, qui
supposera la même rigueur que le mode test distant (§9) et davantage.
