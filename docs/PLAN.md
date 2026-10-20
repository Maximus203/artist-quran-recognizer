# Plan de réalisation — du squelette à l'utilisation libre

Légende : 🤖 = l'agent (Claude Code) · 👤 = Cherif · 🚦 = porte de validation
(l'agent s'arrête, Cherif décide). Chaque phase a son prompt dans `docs/prompts/`.

| Phase | Objectif | Statut |
|---|---|---|
| 0 | Squelette, invariants, init | ✅ 2026-09-24/25 |
| 1 | Cœur pur : corpus, matcher, décodeur, rendu | ✅ 2026-09-25 (PR #1–#4, `develop` @ 01a4f30) |
| 2 | Robustesse de la recherche + fins de ligne | ✅ 2026-09-25 (PR #5–#6, `develop` @ voir décision-log) |
| 2b | Recherche sur le flux continu (segments partiels, multi-versets, 0 faux verset) | ✅ 2026-10-02 (voir ADR-0004) |
| 3 | Outillage de données (ingestion, pré-annotation, Audacity, split, EveryAyah, mixages) | ✅ 2026-10-04 (PR #11–#18) · lot 1 ingéré (12 fichiers, 8,69 h, split dev/test fait) |
| 4 | Adapters audio : extraction, segmentation, ASR ×2, décodage contraint | ⏳ adapters faits (#20–#24) ; décodage contraint : algorithme seul (ADR-0005), non validé sur audio réel |
| 5 | Pipeline bout-en-bout + CLI → **1ʳᵉ inférence sur tes audios** | ⏳ `aqr recognize` fusionné (#30, voir `docs/RECOGNIZE-OUTPUT.md`) ; essais sur lot 1 sans vérité terrain |
| 6 | Golden set annoté + benchmark v1 + choix de l'ASR | |
| 7 | Rejet du non-Coran (B3 + B5) calibré | |
| 8 | V1 « utilisation libre » : CLI finale + interface web locale | ⏳ atelier Next.js en cours ; validation sur les audios de Cherif et feu vert V1 encore nécessaires |
| V1.1 / V2 | Warsh · anglais · sous-titrage vidéo | |

## Direction du 2026-10-19 (audit) : A → B → C → D
Constat (rapport réel du 2026-10-09) : sur de l'audio que les modèles ont vu à l'entraînement, la
chaîne ne retrouve que 52,6 % des versets et borne leur fin à 0,8 s près, alors que l'ASR seul
identifie 97–100 % des versets : le goulot est la couche de décision, pas le modèle. Aucune vérité
terrain humaine n'existe sur de l'audio réel. Choix de Cherif : usage **non commercial** (Tadabur
CC BY-NC et Muno NPL admissibles), puis dans l'ordre :

| Étape | Objectif | Statut |
|---|---|---|
| A | Vérité terrain semi-automatique : l'humain dit QUOI (versets), l'alignement forcé dit QUAND, l'humain valide à l'oreille dans l'atelier ; 2–3 h d'audio réel validées (prière, assise) + mixages avec vraie parole non coranique | ⏳ outil prêt : alignement forcé (#44), fichier entier par passages, formules, validation à l'oreille dans l'atelier et écriture dans le manifeste (`docs/ALIGN-OUTPUT.md`) ; reste : **2–3 h validées par Cherif** (prière, assise) et mixages avec vraie parole non coranique |
| B | Couche de décision acoustique : vérification CTC des candidats, suivi de position (prédire le verset suivant puis le vérifier), temps au mot près dans `aqr recognize` | ⏳ brique 1 : preuve cumulée par la suite (ADR-0007) — EveryAyah 71,8 % → 91,2 %, 0 faux, voix de Cherif au micro reconnue ; reste : vérification acoustique de la suite, temps au mot |
| C | Fine-tuning du FastConformer : Tadabur + arabe non coranique transcrit (contre « il voit du Coran partout ») + dégradations (réverbération, foule, téléphone), comparé sur les données de l'étape A. EveryAyah retiré : la décision d'usage provisoire interdit d'entraîner dessus | ⏳ données : sources épinglées et manifestes NeMo (`scripts/build_finetune_manifest.py`, `docs/evaluation/finetune-data.md`) ; étiquettes contrôlées par le modèle de base, queue écartée (`docs/evaluation/finetune-label-qc.md`) ; reste : cible sans `<unk>`, dégradations, entraînement |
| D | Détecteur récitation / parole / bruit (B3/B5) et calibrage du rejet du non-Coran (phase 7) | |

Indicateur unique : rappel à 0 faux verset sur l'audio réel dev validé ; chaque PR le fait bouger ou
dit pourquoi.

---

## Phase 2 — Robustesse de la recherche ✅
- 🤖 `.gitattributes` (fins de ligne LF) + renormalisation (PR #5).
- 🤖 Matcher B6 multi-niveaux (ADR-0003) : dictionnaire de corrections Uthmani ↔
  imla'i appris depuis le corpus (pas de règle générique — testé, une règle
  naïve cassait « الرحمن »), index n-grammes de caractères (5-grammes, niveau 1,
  tolérant) + trigrammes de mots corrigés (niveau 2), réalignement fin conservé.
  Testé avec des transcriptions **au format réel des ASR** (orthographe imla'i,
  erreurs d'une lettre, mots manquants/en trop), `scripts/bench_matcher.py`
  (2000 requêtes, graine 42).
- 🤖 Basmala : `is_basmala_only_span` (structure pure, branchement pipeline en phase 4).
- 👤 **Intervention** : coller `prompts/phase-02.md`. Relire le rapport de robustesse.
- 🚦 **Atteint** : top-1 99,80 % exact (cible ≥ 99 %), 98,00 % avec 1 erreur/5 mots
  (cible ≥ 95 %), 98,80/99,70 % mot manquant/en trop, < 3 ms/requête (cible < 50 ms).

## Phase 2b — Recherche sur le flux continu ✅
- 🤖 `FlowVerseMatcher` (ADR-0004) : le Coran est un flux de mots, la requête est alignée
  localement ; spans multi-versets, basmala du verset 1 traitée à part, ambiguïté renvoyée
  au décodeur B7 (adapté aux candidats multi-versets). `scripts/bench_segments.py`.
- 🚦 **Atteint** (graine 7, 600 fenêtres par ligne) : 0 faux verset nommé sur toutes les
  fenêtres (3–6, 7–12, 13–25 mots, avec et sans bruit) ; top-1 98,8 % sur 7–12 mots
  (cible 97 %) ; 98,4 % sur « verset 1 sans basmala » (cible 95 %) ; bancs de la phase 2
  non dégradés ; ≈ 2 ms/requête (cible < 50 ms).

## Phase 3 — Outillage de données ✅ (outillage) · ⏳ (lot 1)
- 🤖 `aqr data ingest | export-labels | import-labels | preannotate | split`
  (`aqr.data`, PR #11–#12, #16), `scripts/fetch_everyayah.py` (empreintes épinglées, PR #13),
  `scripts/make_mix.py` (11 scénarios, vérité exacte à la milliseconde, PR #15). `preannotate` :
  interface seulement (moteur en phase 5), mélanges versets/non-Coran entrelacés (C09–C11).
- 👤 **Intervention** : coller `prompts/phase-03.md`. **En parallèle : collecter le
  1er lot (2–3 h) selon `DATA-COLLECTION.md` et le déposer dans `inbox\`.**
- 🚦 **Atteint** : un mixage synthétique généré, ré-importé (étiquettes → manifeste), et sa vérité
  terrain validée par un test ; banc 2b sur les segments des mixages : 0 faux verset.
- ✅ **Lot 1 ingéré** (8,69 h, 12 fichiers, `a_annoter`) : `audio_lot.py import` puis `aqr data ingest`
  et `aqr data split` (6,15 h dev · 2,55 h test, aucun récitant des deux côtés). Reste côté Cherif :
  l'**annotation** dans Audacity (`aqr data export-labels <id>`), et fournir les clips `specials/`
  (isti'adha, takbir, amin) et `speech/` (français, arabe non coranique) pour les mixages prière,
  assise et khutba. Dataset Hugging Face privé : encore vide (envoi nécessaire pour le cloud).

## Phase 4 — Adapters audio (GPU : RTX 5090 24 Go) ⏳
- ✅ fait : B1 ffmpeg (#20), épinglage des modèles (#21), B4 FastConformer (#22) et Whisper-Tarteel (#23),
  B2 recitation-segmenter-v2 + repli Silero (PR B2), Muno FastConformer streaming (PR de comparaison). ⏳ reste : décodage contraint (ADR-0003).
- 🤖 B1 ffmpeg · B2 recitation-segmenter-v2 (+ repli VAD) · B4 FastConformer-Quran et
  Whisper-Tarteel et Muno Streaming · décodage contraint optionnel (trie coranique + chemin poubelle).
  Tests de contrat pour chaque port, tests `slow` sur de vrais extraits EveryAyah.
- 👤 **Intervention** : coller `prompts/phase-04.md`. Accepter les installations lourdes
  (CUDA/PyTorch/NeMo) si l'agent le demande ; vérifier l'espace disque (~20 Go de modèles).
- 🚦 Chaque adapter passe son contrat ; transcription d'un verset EveryAyah correcte.

## Phase 5 — Pipeline bout-en-bout + CLI (1ʳᵉ inférence)
- 🤖 `aqr recognize <fichier> [--batch-size N] [--format json|srt|vtt] [--translation french_hameedullah]`.
- 👤 **Intervention** : coller `prompts/phase-05.md`. **Tester sur 3 de tes audios**, noter
  ce qui est faux → chaque erreur devient un cas du manifeste.
- 🚦 La CLI traite un fichier réel de bout en bout et produit JSON + SRT.

## Phase 6 — Golden set + benchmark v1
- 🤖 Pré-annotation du 1er lot, génération des fichiers Audacity, rapport de benchmark
  par catégorie, comparaison FastConformer vs Whisper-Tarteel vs décodage contraint.
- 👤 **Intervention (le vrai travail manuel)** : corriger les étiquettes dans Audacity
  (≈ 1 h par heure d'audio), puis coller `prompts/phase-06.md`.
- 🚦 **Décision de Cherif** : quel ASR / quelle configuration devient le défaut.

## Phase 7 — Rejet du non-Coran
- 🤖 B3 LanguageGate + B5 QuranicityGate (ADR-0002), calibration des seuils **sur dev
  uniquement**, mesure finale sur test.
- 👤 **Intervention** : coller `prompts/phase-07.md`. Arbitrer le compromis
  précision/rappel si l'agent présente plusieurs réglages.
- 🚦 0 faux positif sur C09/C10 (test), rappel ≥ 90 % sur C11.

## Phase 8 — V1 « utilisation libre »
- 🤖 Mode dossier (traiter un répertoire entier). Pour l'atelier de revue local, la demande du
  7 octobre 2026 retient Next.js/TypeScript et la CLI Python existante plutôt que FastAPI :
  dépôt audio, lecteur synchronisé, texte Mushaf, signalements et export JSON. Les exports
  SRT/VTT restent disponibles dans la CLI.
- 👤 **Intervention** : coller `prompts/phase-08.md`. **Utilisation réelle pendant une
  semaine** ; chaque erreur → cas de test.
- 🚦 **Feu vert V1 par Cherif** → tag `v1.0.0` sur `main`.

---

## Rituel à chaque fin de phase (👤, 5 minutes)
1. Lire le compte rendu de l'agent : SHA fusionné dans `origin/develop`, sorties réelles
   de `pytest` / `ruff` / `mypy`, métriques.
2. S'il manque une preuve → répondre : « Preuve manquante : <quoi>. Fournis-la avant de
   continuer. »
3. Sinon → coller le prompt de la phase suivante.
