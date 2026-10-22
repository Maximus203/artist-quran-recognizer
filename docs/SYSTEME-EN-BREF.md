# Le système en bref

> Qu'est-ce que c'est, que fait un audio de bout en bout, où en est-on, et qu'est-ce qui n'est pas
> encore prouvé ? Page d'entrée de la documentation. Chaque chiffre porte sa source (fichier ou PR) ;
> aucun n'est une promesse de précision : voir « Ce que ces chiffres ne disent pas ».

## 1. À quoi ça sert

`artist-quran-recognizer` écoute un audio ou une vidéo **quelconque** (récitation, prière, assise ou
cours qui mêle français, arabe courant, hadiths, invocations) et répond à une seule question : **quels
versets du Coran sont récités, de quelle seconde à quelle seconde ?** Tout le reste est ignoré. Pour chaque
verset trouvé, le système restitue le **texte exact du Mushaf** (celui du corpus, jamais celui d'un modèle)
et la **traduction officielle** (QuranEnc, sans modification, avec sa source). Sources : `docs/spec-v1.md`,
`docs/ARCHITECTURE.md`.

Il se présente de deux façons :

- une **ligne de commande** (`aqr recognize fichier.mp3`) qui produit un fichier JSON (et des sous-titres
  SRT/VTT) : contrat dans `docs/RECOGNIZE-OUTPUT.md` ;
- un **atelier web** local (dossier `web/`) où plusieurs testeurs (comptes, audios globaux ou privés) déposent des audios et vidéos, écoutent, voient les
  versets sur une ligne de temps et signalent ce qui est faux : voir `docs/ARCHITECTURE-ATELIER.md`.

Usage prévu : **non commercial**, en local, hors ligne une fois les modèles téléchargés (décision de Cherif
du 2026-10-19, `docs/PLAN.md`).

## 2. Ce qui se passe quand on dépose un audio

```
  fichier audio ou vidéo (MP3, M4A, WAV, MP4…)
        |
  1. EXTRAIRE      ffmpeg → son mono 16 kHz
        |
  2. DÉCOUPER      en morceaux de parole (pauses de récitation)
        |
  3. ÉCOUTER       un modèle de reconnaissance transcrit chaque morceau (FastConformer),
        |          puis Whisper et Muno réécoutent SEULEMENT les morceaux douteux  (ADR-0009)
        |
  4. CHERCHER      la transcription est comparée au texte du Coran (recherche sur le flux
        |          continu des mots, tolérante aux erreurs du modèle)                (ADR-0004)
        |
  5. CONFIRMER     preuve par la suite : des versets courts qui s'enchaînent dans le Mushaf
        |          se confirment entre eux                                           (ADR-0007)
        |          preuve acoustique : le TEXTE DU CORPUS est réaligné sur le son ;
        |          s'il ne colle pas à l'audio, rien n'est nommé                     (ADR-0006, 0008)
        |
  6. DÉCIDER       chaque passage reçoit un statut : reconnu / supposé / incertain / abstention
        |
  7. RESTITUER     texte arabe du corpus + traduction QuranEnc + temps (début, fin, parfois au mot)
        |
  JSON `aqr.recognition/1`  (+ SRT / VTT)  →  atelier web : onde, pistes, revue humaine
```

Le choix du moteur a disparu de l'interface : la **cascade** est le comportement par défaut (ADR-0009).
Un moteur seul reste possible en ligne de commande pour faire une mesure (`--asr`).

## 3. Les règles qui ne bougent jamais (invariants)

Elles sont écrites dans `docs/ARCHITECTURE.md` (sept invariants ; `AGENTS.md` rappelle I1 à I5) et chaque
changement doit les respecter.

| # | En clair | Pourquoi c'est important |
|---|---|---|
| I1 | Le texte arabe affiché vient **toujours du corpus**, jamais d'un modèle. Aucune IA générative dans la chaîne (ADR-0001). | Le modèle peut mal entendre ; l'affichage reste exact par construction. |
| I2 | La traduction est celle de **QuranEnc, telle quelle**, avec son identifiant, sa version et son attribution. | Aucune reformulation silencieuse. Même une erreur de la source est montrée (`docs/KNOWN-ISSUES.md`, KI-1). |
| I3 | **Nommer un faux verset est pire que n'en nommer aucun.** | Dans le doute, le système s'abstient : on préfère rater un verset que se tromper. |
| I4 | La parole qui n'est pas du Coran (français, hadiths, invocations) ne doit produire **aucun verset**. | Constat honnête : aujourd'hui elle sort en « abstention », pas encore avec une étiquette « non coranique » (`docs/RECOGNIZE-OUTPUT.md`, « Ce qui n'est pas fait »). |
| I5 | Chaque verset porte un **statut de preuve** : *reconnu* (entendu et vérifié), *supposé* (déduit d'un trou entre deux versets reconnus, jamais entendu), *incertain* (plusieurs versets possibles, ni texte ni traduction). | Le lecteur sait toujours sur quoi repose ce qu'il lit. |
| I6 | La **riwaya** (mode de lecture) est un paramètre, pas une constante. | Seul le Hafs est géré. Une récitation en Warsh est aujourd'hui reconnue comme du Hafs ; la sortie le dit (riwaya « supposée Hafs, non vérifiée », PR #58). |
| I7 | Chaque brique est **remplaçable** derrière une interface testée. | On peut changer de modèle sans réécrire le reste. |

## 4. Où en est-on réellement

**Ce qui est fait.** Le moteur complet fonctionne de bout en bout sur GPU, et l'atelier web permet d'importer
plusieurs fichiers (audio et vidéo), de les mettre en file d'attente, d'écouter avec une position exacte et
de signaler des erreurs (détails dans les notes de version, `docs/RELEASE-NOTES.md`).

**La direction choisie le 2026-10-19 : A, puis B, puis C, puis D** (`docs/PLAN.md`). Le constat de départ
(rapport du 2026-10-09, `docs/evaluation/rapport-reel-2026-10-09.md`) : sur de l'audio qu'ils ont
vraisemblablement vu à l'entraînement, les modèles retrouvaient 52,6 % des versets, alors que l'ASR seul
identifie 97 à 100 % des versets (ADR-0006) : **le goulot était la couche de décision, pas le modèle**.

| Étape | Ce que c'est | État |
|---|---|---|
| **A** — vérité terrain | L'humain dit *quoi* est récité, l'alignement forcé dit *quand*, l'humain valide à l'oreille. | Outil prêt dans l'atelier (PR #44, #45). **Reste : 2 à 3 h d'audio réel validées par Cherif.** Il n'existe donc **pas encore de vérité terrain validée par un humain** sur de l'audio réel. |
| **B** — décision acoustique | Preuve par la suite (ADR-0007), vérification acoustique des suites et temps au mot (ADR-0008), cascade de modèles arbitrée par l'audio (ADR-0009). | Trois briques faites. Reste : comparaison relative des suites concurrentes (homonymes), suivi de position, seuils calibrés sur l'étape A. |
| **C** — fine-tuning | Réentraîner le modèle de reconnaissance (autres voix, bruit, arabe non coranique). | **Aucun fine-tuning n'a été fait.** Seules les données sont préparées (PR #46, #48, #51, #53). |
| **D** — détecteur parole / récitation | Détecter et étiqueter la parole non coranique, calibrer le rejet. | Pas commencé. |

**Point à retenir : toute l'amélioration mesurée vient de l'architecture de décision (étape B), pas d'un
modèle réentraîné.** Les mêmes modèles, mieux exploités, retrouvent plus de versets sans en inventer.

## 5. Les chiffres mesurés, avec leurs limites

| Mesure | Résultat | Source |
|---|---|---|
| EveryAyah (3 récitants × 10 sourates, 216 versets) : versets *reconnus* | 71,8 % (avant ADR-0007) → 91,2 % (ADR-0007) → 96,8 % (ADR-0008) → **97,7 % (211/216)** (séance du 20 oct.) ; **0 faux verset** à chaque étape | `docs/evaluation/chain-proof-2026-10-19.md`, `acoustic-check-2026-10-20.md`, `nuit-2026-10-20.md` |
| Même jeu avec la cascade (30 fichiers, split dev) | 211 → **216/216** versets distincts | `docs/evaluation/cascade-2026-10-20.md` |
| Lot 1 (12 audios réels, 8,7 h) : versets *reconnus* | 618 (7 oct.) → 680 (après ADR-0007) → **740** (séance du 20 oct.) | `docs/evaluation/nuit-2026-10-20.md` |
| Cascade contre FastConformer seul, lots 1 et 2 (split dev) | Aucun verset perdu ; +10 versets distincts (lot 1), +5 (lot 2) ; aucun ajouté sur les fichiers sans Coran récité ; **coût en temps ×2,85** (821 s → 2 337 s) | `docs/evaluation/cascade-2026-10-20.md`, ADR-0009 |
| Voix de Cherif au micro (basmala puis 55:1-4) | Avant : aucun verset nommé. Maintenant : 55:1-4 reconnu avec les trois moteurs | `docs/evaluation/nuit-2026-10-20.md` |
| Récitations sénégalaises lentes (lot 2, 0,4 à 0,7 mot/s) | Bien suivies en général ; un fichier (lot2-07, récitation en public) reste presque muet : 2 versets sur 6 min. Le débit seul ne l'explique pas : la prise de son en public et l'ornementation sont les suspects, **non vérifiés** (à écouter) | `docs/evaluation/lot2-premiers-essais.md` §6, `nuit-2026-10-20.md` |
| Tafsir en wolof (lot 2) | Aucun faux verset sur 1 943 fenêtres ; très peu de citations retenues (souvent 2 à 4 mots, écartées par la règle de preuve I3) | PR #52, `lot2-premiers-essais.md` |

### Ce que ces chiffres ne disent pas
- **Ce ne sont pas des taux de précision.** Pour les lots 1 et 2, aucune vérité terrain humaine n'existe :
  « 740 versets reconnus » veut dire « 740 versets nommés », pas « 740 versets justes ». Un verset de plus
  n'est pas forcément un verset juste (`nuit-2026-10-20.md`, « Limites »).
- **EveryAyah est un plafond optimiste** : ces enregistrements ont très probablement servi à entraîner les
  modèles. Les « 0 faux verset » y sont mesurés par construction (les versets attendus sont connus).
- **Les seuils ne sont pas calibrés** sur une vérité humaine ; ils le seront avec l'étape A.
- **Les fichiers du split « test » ne servent à aucun réglage** : seuls des comptes en sont relevés, sans
  examen (protocole : `docs/evaluation/protocole-reglage-evaluation.md`).
- **Le coût de la cascade** est réel : ×2,85 en temps sur des fichiers parlés (jusqu'à ×3,2 sur le lot 1),
  faible sur une récitation continue.

## 6. Limites connues

Elles sont listées dans `docs/KNOWN-ISSUES.md` et dans les rapports :

- **KI-1 — traduction française de la sourate 42 (QuranEnc)** : la source contient une phrase dupliquée en
  42:3 et 42:4. Le système la restitue telle que reçue (I2) ; le texte arabe n'est pas touché.
- **KI-2 — droits des audios du lot 1** : décision de Cherif attendue (`docs/data-lots/RIGHTS.md`).
- **KI-3 — le repli Silero** (découpeur de secours) n'est pas fiable par défaut ; ne pas le présenter comme
  équivalent au découpeur principal (`docs/evaluation/silero-fallback.md`).
- **Warsh** : une récitation en Warsh est reconnue comme du Hafs, sans détection possible aujourd'hui (deux
  signaux testés, tous deux négatifs : `docs/evaluation/riwaya-2026-10-20.md`). La sortie affiche un
  avertissement « riwaya supposée Hafs ».
- **Parole non coranique** : elle ne produit pas de verset, mais n'a pas encore d'étiquette dédiée (étape D).
- **Citations courtes dans un cours** (2 à 4 mots) : volontairement écartées tant que la preuve est
  insuffisante (I3).
- **Un mot isolé** peut encore être nommé dans une répétition de cours (« كلا » → 75:26 [1-1]) : point à
  surveiller (`cascade-2026-10-20.md`).

## 7. Pour aller plus loin

| Je veux… | Je lis… |
|---|---|
| comprendre l'architecture du moteur | `docs/ARCHITECTURE.md` |
| comprendre l'atelier web | `docs/ARCHITECTURE-ATELIER.md` |
| voir ce qui a changé et quand | `docs/RELEASE-NOTES.md` |
| connaître le plan et les phases | `docs/PLAN.md` |
| savoir comment on mesure | `docs/EVALUATION-METRICS.md` |
| savoir pourquoi telle décision | les ADR, `docs/adr/0001` à `0009` |
