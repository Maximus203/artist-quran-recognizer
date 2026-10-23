# Architecture de l'atelier web

> L'atelier (dossier `web/`) est l'application où l'on dépose des audios, on suit leur analyse, on écoute
> les versets trouvés et on signale les erreurs, à plusieurs testeurs (comptes, audios globaux ou privés,
> préférences enregistrées côté serveur : §13). Ce document décrit ce qui **existe aujourd'hui**.
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
| Pages | `web/app/(app)/*`, `app/login`, `app/register`, `review-app.tsx`, `app/atelier/*` | L'atelier (`/` : barre du haut, panneau Sessions à gauche, console au centre, revue humaine à droite) et les pages Sessions, Performance, Documentation, Compte, plus connexion et inscription. Un composant par zone. |
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
| `GET …/export/readiness` · `POST …/export/subtitles` | « Prêt à exporter ? » (passages ambigus, une page à la fois) · sous-titres SRT, WebVTT, ASS, JSON, aperçu (ADR-0014, §7 bis). |
| `GET` / `PUT /api/sessions/<id>/decisions` · `GET /api/corpus/verse` | Calque de décisions humaines (jamais la prédiction) · un verset lu dans le corpus. |
| `GET` / `POST /api/sessions/<id>/validation` | Vérité terrain (administrateurs seulement). |
| `/api/auth/*`, `/api/me*`, `/api/admin/users`, `/api/docs*`, `PATCH /api/sessions/<id>`, `…/favorite`, `POST /api/sessions/bulk` | Comptes, préférences, statistiques, documentation, renommage/portée/archivage, actions groupées : contrat complet dans `web/README.md` (§13 ci-dessous). |
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

### 6 bis. Le rendu des longs audios : un coût proportionnel à l'écran, pas au fichier

**Problème mesuré** (PR « fluidité des longs audios », banc `web/e2e/perf-measure.mjs`). Un audio de 2 h 14
compte 3 128 intervalles. L'interface créait un nœud par intervalle partout : 2 × 3 128 boutons sur l'onde et les
pistes (chacun avec deux pseudo-éléments), 3 128 lignes dans la liste, 1 612 graduations au zoom 30 s, soit
**22 400 nœuds** au repos. Chaque saut entre versets coûtait 0,5 à 1,7 s (mise en page, style, peinture,
test de survol), la lecture tombait à 1 ou 20 images par seconde, l'ouverture prenait 2,5 à 4 s.

**Règle d'architecture : le DOM ne dépend que de ce que l'écran montre.** Trois mécanismes, tous des fonctions
pures testées dans `web/lib/` :

| Mécanisme | Fichier | Ce qu'il fait |
|---|---|---|
| Index temporel | `interval-index.ts` | « Quel intervalle couvre cet instant ? », « lesquels touchent cette fenêtre ? », « le plus proche » en O(log n). Mémorisé par résultat (`WeakMap`). `activeIndex` (appelé à chaque image) l'utilise : fini le `findIndex` sur 3 000 intervalles. |
| Fenêtre de rendu de la timeline | `timeline-window.ts` | Seuls les segments qui touchent la vue (plus une demi-vue de marge de chaque côté) existent dans le DOM, et ceux trop étroits pour être distingués (< 4 px) se fondent en **blocs** de même style (151 blocs au lieu de 3 128 sur « Fichier entier »). Un clic sur un bloc désigne l'intervalle le plus proche du temps cliqué ; l'intervalle choisi n'est jamais fondu (il garde son contour). La fenêtre ne change que quand la vue en sort : le défilement ordinaire ne redessine rien. |
| Liste virtualisée | `virtual-list.ts`, `app/atelier/intervals-list.tsx` | Hauteur de ligne fixe (CSS : 44 px, 72 px sur petit écran), ≈ 25 lignes dans le DOM. Au clavier : une seule ligne porte la tabulation (la focalisée, sinon la choisie, sinon celle qui joue), flèches / Début / Fin / Page suivante / Page précédente déplacent le focus ; chaque ligne annonce `aria-posinset` et `aria-setsize` (taille réelle de la liste). |

Autres décisions de rendu, chacune mesurée :

- **Lecture** (`lib/clock.ts`, `use-player.ts`) : la position n'est publiée qu'à ~60 Hz même sur un écran à 144
  ou 240 Hz (chaque publication déclenche mise en page, peinture et composition) ; la fin d'une plage écoutée
  reste vérifiée à chaque image. Les **textes** (position, longueur provisoire) lisent une horloge à 20 Hz
  (`useClock`) ; la tête de lecture, elle, suit en direct hors de React, déplacée par `transform` (couche
  propre) et non par `left`.
- **Couleurs du canvas** résolues une fois par thème : chaque `getComputedStyle` forçait un recalcul de style de
  toute la page.
- **Crêtes** : `GET …/peaks` répond `ETag` + `Cache-Control: private, no-cache` (304 sans corps à la réouverture
  d'une session au lieu de 2,3 Mo).
- Les rappels passés aux lignes et aux segments ont une identité stable (`useCallback`, `ref`) : un changement
  de sélection ne redessine que les deux éléments concernés (composants mémorisés).

**Mesurer.** `node web/e2e/perf-measure.mjs --url <serveur de production> --session <id>` (build de
production sur une COPIE des sessions, jamais les données du mainteneur) rejoue ouverture, 50 sauts, rafale,
touches, lecture, surlignage, glisser, changement de fenêtre et fuites, et rapporte images, tâches longues,
latence geste → image peinte, commits React, nœuds DOM, écouteurs, mémoire (`web/README.md`).

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

## 7 bis. Les décisions humaines et l'export des sous-titres

Une correction à l'oreille ne réécrit jamais la prédiction : elle est un **calque** (`decisions.json`,
`aqr.decisions/1`, `docs/DECISIONS.md`, ADR-0014) accroché à l'intervalle du moteur par son **empreinte**
(sha256 de ce que le moteur a dit, temps en millisecondes), jamais par sa position. Après une nouvelle analyse, une
décision dont le passage est identique reste appliquée ; les autres deviennent **orphelines** et l'atelier
les montre au lieu de les appliquer en silence.

```
 navigateur ── GET readiness / PUT decisions / POST subtitles ──▶ routes (droits : voir · modifier)
                                                                    │ lib/export-engine.ts : au plus 3 processus,
                                                                    │ mémoire des réponses identiques
                                                                    ▼
                                         python -m aqr.cli export-readiness | export-subtitles | corpus-verse
                                         (corpus, QuranEnc en cache : le web n'a ni l'un ni l'autre)
```

Pourquoi le moteur en Python : le serveur n'a pas le corpus, et un second rendu en TypeScript finirait par
diverger. Le serveur construit la ligne de commande, valide les options (`lib/export-options.ts`, même défauts
que le moteur), traduit les codes de sortie (3 → `409 unresolved_items`) et écrit `decisions.json` avec le
lecteur strict (`lib/decisions.ts`, mêmes cas de test que `src/aqr/decisions/`). Les étiquettes de revue qui
bloquent l'export sont une propriété des puces (`blocksExport`, `lib/review-presets.ts`), transmises au moteur.

**Les écrans** (`/s/<id>/exporter` et `/s/<id>/exporter/corriger?item=<clé>`, routes sous `(app)/s/[id]/`). Ils
respectent le coût du DOM de §6 bis : l'atelier n'est pas modifié, hormis le bouton d'entrée dans l'en-tête de session
(`session-head.tsx`) et la touche E (`review-app.tsx`). Tout le code vit dans `web/app/atelier/export/` (composants
clients), `web/lib/export-*.ts` (règles pures, testées sans navigateur : textes, choix de décision, voisins d'un passage,
brouillon, préférences, mesure d'écoute) et `web/app/export.css` (préfixe `ex-`, uniquement des jetons de `tokens.css`).
La liste est paginée par dix côté moteur : le navigateur ne reçoit jamais plus de dix lignes. Un seul `<audio>` sert
toute la page. L'écoute d'un passage est mesurée sur la position lue directement sur l'`<audio>` toutes les 100 ms
(`ListenMeter`), pas sur les images dessinées : un onglet ou un volet masqué ne fausse pas le « écouté ». Les actions
de décision partent en `PUT /decisions` par lots ; hors connexion, elles attendent dans le navigateur (`lib/export-draft.ts`) et un message le dit ; elles partent
avec la décision suivante.

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
        ├── decisions.json          les décisions humaines à l'oreille, aqr.decisions/1 (ADR-0014)
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
| Plafonds d'envoi | `AQR_MAX_UPLOAD_BYTES` (audio, 500 Mo par défaut), `AQR_MAX_VIDEO_UPLOAD_BYTES` (vidéo, 2 Gio) ; `413` dès l'en-tête. |
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

### Traduction du passage et surlignage en direct

La carte « Passage actif » montre la traduction **de la plage de mots affichée en arabe**, pas du verset entier,
et surligne en lecture le mot arabe récité et le segment de traduction qui le contient. Tout vient de champs
**additifs** du résultat (`docs/RECOGNIZE-OUTPUT.md`) ; sans eux, l'atelier garde son comportement d'avant.

```
  résultat (par verset) : words [a,b] · text (corpus) · word_times [[début,fin]…] + word_times_source
                          translation { text (QuranEnc, intact), scope, segments[], fragment{words,text,…} }
                                 │
   lib/translation-fragment.ts ──┤ scope "fragment" et fragment valide → on montre le fragment seul, découpé en
                                 │ segments SEULEMENT si les segments le recomposent exactement (aux espaces près) ;
                                 │ sinon (scope "verse", champ absent ou mal formé) → verset entier + étiquette
                                 │ « Traduction du verset entier » ; les « … » aux bords sont un décor d'affichage
   lib/live-highlight.ts ────────┤ word_times validés (un couple par mot, débuts qui ne reculent pas) ET texte arabe
                                 │ qui contient autant de mots que `words` (un signe de pause ۖ ۚ n'est pas un mot) ;
                                 │ sinon aucun mot n'est surligné
   temps de lecture (store) ─────┘ mot en cours = dernier mot dont le début ≤ t (recherche binaire, sans mémoire :
                                   un retour en arrière, une boucle ou une reprise se recale à l'image suivante)
```

- **Honnêteté** : sans temps de mots valides, ou si le texte ne s'aligne pas, **aucun faux mot** : seul le passage
  entier est teinté pendant la lecture. Avec `word_times_source: "interpolated"`, une note dit que le surlignage est
  estimé. Le texte arabe et la traduction ne sont jamais modifiés ; seuls des `<span>` les découpent à l'affichage.
- **Reprise dans un même verset** : l'intervalle de la reprise (`repetition: true`) a sa propre plage de mots ; quand
  le temps revient en arrière, la carte change d'intervalle et la traduction repart là où la reprise démarre.
- **Accessibilité** : le mot et le segment en cours portent `aria-current` (fond teinté **et** trait sous le texte,
  jamais la couleur seule ; contours système en mode contraste forcé) ; changer d'attribut n'est pas annoncé par les
  lecteurs d'écran. Aucun défilement automatique ni animation sous `prefers-reduced-motion`.
- **Interaction** : lecture à l'arrêt, un clic sur un mot arabe place le lecteur au début de ce mot (jamais pendant
  une sélection de texte). Interrupteur « Surligner en direct » sur la carte et dans le compte (`liveHighlight`,
  enregistré côté serveur, activé par défaut).

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
| `AQR_MAX_UPLOAD_BYTES`, `AQR_MAX_VIDEO_UPLOAD_BYTES` | plafonds d'envoi | 500 Mo, 2 Gio |
| `AQR_USER_QUOTA_BYTES` | quota de stockage par compte (`0` = illimité) | 5 Gio |
| `AQR_DB_PATH`, `AQR_SIGNUP`, `AQR_SIGNUP_CODE`, `AQR_TRUST_PROXY`, `AQR_TIMEZONE`, `AQR_REPO_URL` | base, inscription, proxy, fuseau des noms, dépôt des liens de notes de version | voir `web/README.md` |
| `AQR_ALLOWED_HOSTS`, `AQR_ACCESS_TOKEN`, `AQR_ACCESS_TTL_S` | mode test distant | vides, 3 600 s |
| `AQR_SESSION_TTL_S` | purge des sessions inactives | 0 (désactivée) |

## 13. Comptes, partage et préférences (phase 2) — livré

Plusieurs testeurs utilisent le même atelier. Tout ce qui suit **existe** (PR #70 pour le socle serveur, PR de
l'interface de la phase 2 pour les écrans). Le contrat détaillé d'API est dans `web/README.md`, section
« Comptes, partage et préférences » ; le design dans `docs/design/phase2.md`.

**Ce qui est livré**

| Élément | Comment |
|---|---|
| **Comptes** | Pseudonyme + mot de passe, **aucun compte pré-créé** : le premier inscrit est administrateur. Pages `/login` et `/register` (inscription `open` · `closed` · `code`, interrupteur serveur `AQR_SIGNUP`). Connexion par cookie `HttpOnly` ; mot de passe haché (scrypt). Le mode distant par jeton (`/access`, `AQR_ACCESS_TOKEN`) reste une couche réseau **en plus**. |
| **Base SQLite** | `AQR_DB_PATH` : comptes, propriété et portée des sessions, préférences, favoris, « non lu ». Les fichiers lourds (audio, prédiction, revue) restent sur le disque. Migrations versionnées. |
| **Global ou privé** | Un audio est **global** par défaut (visible de tous les testeurs, avec ses performances) ou **privé** (visible de son seul propriétaire, **administrateurs compris** : un privé d'un autre répond `404`). Choix à l'import (carte « Qui peut voir cet essai ? »), modifiable par le propriétaire ; privé → global demande une confirmation. |
| **Préférences côté serveur** | 15 clés (`web/lib/preferences-schema.ts`, l'unique source) : thème, police et taille arabes, traduction, surlignage en direct, fenêtre visible, suivi de lecture, panneaux, filtre de la liste, vitesse, volume, raccourcis, onglet de revue, portée des nouveaux essais. Lues dans `app/layout.tsx` et posées sur `<html>` **avant le premier rendu** (aucun clignotement, sur tout appareil). Écrites par `PATCH` groupé (anti-rebond 600 ms) ; `localStorage` ne garde que le cache de la page de connexion et ce qui n'a pas pu partir. |
| **Sessions à l'échelle** | `GET /api/sessions` pagine par curseur et filtre côté serveur. Barre de gauche allégée (file, 5 favoris, 8 récentes, « Voir toutes les sessions ») ; page `/sessions` : recherche, portée, filtres état/moteur/date (dans l'adresse), tri, groupes par date, « Charger plus » (20 par lot), sélection multiple et actions groupées. |
| **Favoris, archivage, renommage** | Étoile par utilisateur ; archivage réversible (toast « Annuler ») ; renommage au double-clic ou au crayon ; nom par défaut calculé par le serveur et ligne « Contenu détecté ». |
| **Revue multi-testeurs** | L'auteur d'un signalement est le **compte** (plus de saisie libre). Un testeur ne modifie pas le signalement d'un autre (l'interface le grise, le serveur le refuse : `rejected`). La **vérité terrain** est réservée aux administrateurs. |
| **Documentation** | `/docs` et `/docs/<slug>` : navigation par document (liste blanche `docs/docs-index.json`), sommaire, rendu Markdown **sans HTML brut** (`react-markdown`, GFM), liens `.md` réécrits ; `/docs/release-notes` : chronologie lue dans `docs/RELEASE-NOTES.md`. |
| **Statistiques et stockage** | `/compte/statistiques` et `/performance?vue=moi` : mes tests, mon audio, ma vitesse, mon espace ; `/performance` global ajoute la colonne « Testeur » et le stockage du serveur. Quota par compte (5 Gio par défaut) avec alerte à 80 %, import refusé avant l'envoi s'il dépasse l'espace libre. |
| **Page Compte** | `/compte` (préférences, enregistrées toutes seules, avec pastille annoncée aux lecteurs d'écran), `/compte/statistiques`, `/compte/securite` (changer le mot de passe ; les autres connexions sont fermées). |

**Pages** (`web/app/(app)/…` : le fournisseur du compte reste monté d'une page à l'autre) : `/` (atelier : revue de la
session `?session=<id>` ou Nouvel essai), `/sessions`, `/performance`, `/docs`, `/compte`. Hors du groupe :
`/login`, `/register`, `/access`.

**Découpage du code côté navigateur** : `lib/api-client.ts` (erreurs lisibles, 401 → connexion) · `lib/prefs-sync.ts`
(anti-rebond, reprise, cache) · `lib/sessions-filter.ts` (filtre ↔ adresse ↔ API) · `lib/session-feed.ts` et
`session-groups.ts` (liste paginée qui vit, groupes par date) · `lib/storage-meter.ts` (jauge, refus avant envoi) ·
`lib/docs-view.ts` et `release-notes.ts` (documentation) · `lib/review-access.ts` (qui peut modifier quoi).

**Limites connues**

- Pas de page d'administration des comptes (`/api/admin/users` existe, sans écran) ni de réinitialisation de mot de
  passe par l'interface ; pas de suppression de compte.
- La barre de stockage ne distingue pas audio et vidéo (le serveur ne mesure que le total).
- Les limiteurs de débit vivent en mémoire d'un seul processus (voir `web/README.md`).
- « Récentes » = les plus récentes importées (le serveur ne garde pas encore la date de dernière ouverture).
