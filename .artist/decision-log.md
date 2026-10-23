# Journal des décisions — artist-quran-recognizer

## 2026-09-24
- Pas d'entraînement de zéro ni de LLM génératif : assemblage de briques existantes (ADR-0001).
- Texte arabe et traduction consultés, jamais générés (invariants I1, I2).
- Riwaya Hafs en V1, Warsh en V1.1. Paramètre `riwaya` présent dès le départ.
- Traduction FR par défaut : Hamidullah (révision du Complexe du Roi Fahd) via QuranEnc, non modifiée.
- Méthode : TDD brique par brique. Le cœur logique est pur et testé sans modèle.
- Rejet de l'arabe non coranique par double transcription (ADR-0002, statut proposé).

## 2026-09-25 — Brique `CorpusRepository` (Tanzil)
- **Découpage en mots Uthmani ≠ simple-clean sur ~363/6236 versets** (ex. "يَـٰٓأَيُّهَا"
  fusionné en un seul mot Uthmani vs "يا أيها" séparé en simple-clean). Vérifié sur le
  corpus téléchargé le 2026-09-25 (script `scripts/fetch_corpus.py`).
- **Décision** : `words(ref)` et toute indexation par mot (WordSpan, matching B6) se
  basent **uniquement sur la tokenisation Uthmani** (texte splitté par espace). Le
  fichier simple-clean reste téléchargé et son checksum épinglé (LOCK.json) pour la
  provenance et un contrôle croisé ponctuel, mais n'est jamais la source des index de
  mots. Ça évite un bug d'alignement WordSpan/rendu sur 5,8 % du corpus, cohérent avec
  I1 (rendu toujours depuis le corpus) et I3 (précision prime).
- **Convention Tanzil à connaître pour B6/B7/B9** : le texte du verset 1 de chaque
  sourate (sauf At-Tawbah, 9) inclut la basmala concaténée dans la même chaîne — donc
  `words(ref)` sur un verset 1 retourne 4 mots de basmala en plus du contenu réel du
  verset. À prendre en compte dans le matcher et le rendu par lots.
- Corpus Hafs Tanzil Uthmani + simple-clean téléchargés et épinglés (CC-BY-3.0),
  6236 versets vérifiés. `data/corpus/` gitignoré (poids) ; seul `LOCK.json` versionné.

## 2026-09-25 — Brique `NgramVerseMatcher` (B6)
- **Bug trouvé en écrivant P3** (transcription exacte de 2:255 devait matcher à
  score 1.0, obtenait 0.93) : le texte Tanzil sépare par des espaces non seulement
  les mots mais aussi les marques de pause isolées (ۖ ۗ ۚ ۛ...) — 8 sur 2:255 à elles
  seules, dans le fichier Uthmani **et** simple-clean malgré `marks=false` sur ce
  dernier. `words()` les comptait comme des « mots ».
- **Correction** : `TanzilCorpusRepository.words()` exclut désormais tout token dont
  `normalize_arabic()` est vide (aucune lettre arabe) — `text()` reste inchangé
  (rendu fidèle, I1, les marques de pause en font partie du Mushaf affiché).
- Index B6 : n-grammes de mots (trigrammes, replis uni/bigramme pour les ~quelques
  versets < 3 mots comme 55:64) construits sur `words()` (Uthmani, jamais
  simple-clean, cf. décision précédente). Pas de seuil de rejet codé en dur dans le
  matcher : l'absence de recouvrement de n-gramme suffit pour F3/F4, le seuil de
  confiance final reste une décision calibrée de la brique appelante (I3).
- Perf mesurée : construction de l'index sur 6236 versets + 6 tests ≈ 0,85 s ;
  une requête après échauffement < 50 ms (budget NF3 respecté).

## 2026-09-25 — Brique `ViterbiSequenceDecoder` (B7)
- États = candidats (VerseRef) proposés par le matcher à chaque étape ; poids de
  transition dans `DecoderWeights` (next_verse, repetition, one_verse_gap,
  arbitrary_jump) — objet de configuration, pas de constante éparpillée.
- `min_recognized_score` (défaut 0.75) filtre les candidats avant même le Viterbi :
  porte d'entrée pour I3/F5 (un mot isolé faiblement ressemblant ne doit jamais
  atteindre RECOGNIZED), sans mêler ce seuil à la logique de transition.
- `uncertainty_ratio` (défaut 0.92) : si le 2ᵉ meilleur chemin à une étape est trop
  proche du meilleur, statut UNCERTAIN + liste des candidats à égalité (P9 sans
  contexte) ; avec un contexte fort (transition next_verse vs arbitrary_jump), l'écart
  devient large et RECOGNIZED l'emporte naturellement (P9 avec contexte).
- Post-traitement en deux passes après le chemin optimal : fusion des répétitions
  consécutives d'un même verset (P8, une seule détection à plage fusionnée) puis
  comblement des trous d'exactement un verset (P6, INFERRED, temps interpolé si les
  bornes temporelles le permettent) — les sauts plus larges ou vers une autre sourate
  (P7) ne déclenchent aucun comblement.
- Testé en pur (sans corpus, mécanique de transition/fusion/comblement) et contre le
  corpus réel (P5-P9, F5) + une propriété Hypothesis : toute suite consécutive propre
  tirée du Mushaf est restituée à l'identique, RECOGNIZED, sans fusion ni trou.

## 2026-09-25 — Brique `Renderer` (B9) + `QuranEncTranslationRepository`
- **Port `Renderer` ajouté à `domain/ports.py`** : absent du fichier malgré
  l'architecture (§3 le liste). `BatchOptions`/`RenderedBatch` complètent le port.
- Pas de dossier dédié prévu dans l'arbre `docs/ARCHITECTURE.md` §6 pour B9 (oubli de
  la doc) : créé `src/aqr/rendering/` par cohérence avec `matching/`/`decoding/` (un
  dossier par brique pure).
- `HomeRenderer` lit toujours le texte via `CorpusRepository.text(ref)` (I1) — la
  `Detection` ne porte qu'une référence, jamais de texte, donc l'invariant est
  garanti par construction, pas seulement par convention.
- `QuranEncTranslationRepository` : cache local par (traduction, sourate) — un seul
  appel API renvoie toute la sourate (`/translation/sura/<id>/<n>`), réutilisé pour
  chaque verset. Checksum sidecar (`<n>.sha256`) vérifié à chaque lecture (F8).
  Slugs FR confirmés sur quranenc.com : `french_hameedullah` (Hamidullah, défaut),
  `french_rashid` (Rachid Maach), `french_montada` (Centre Nûr).
- Attribution/version ne sont pas dans la réponse API (juste `arabic_text`/
  `translation`/`footnotes`) : portées par un petit registre `TRANSLATION_METADATA`
  dans l'adapter, un seul endroit (I2).

## 2026-09-25 — Phase 2 : robustesse du matcher (ADR-0003)
- **Constat vérifié indépendamment** (pas seulement recopié du prompt) : sur le
  corpus épinglé, 3843/6236 versets (61,6 %) ont au moins un mot dont la forme
  imla'i normalisée (`normalize_arabic`) est absente du vocabulaire Uthmani indexé
  par `NgramVerseMatcher` ; 7297/78248 mots (9,3 %). `NgramVerseMatcher` ne
  retrouvait donc correctement que du texte reconstruit depuis le corpus
  lui-même — jamais testé contre une vraie sortie d'ASR (orthographe imla'i).
- **Règle de caractères générique essayée puis rejetée** : mapper systématiquement
  l'alef supérieur (dagger alef, ٰ) vers un ا plein corrige la majorité des cas
  (سموت -> سماوات) mais casse « الرحمن » (jamais « الرحمان », y compris dans la
  basmala — 159 occurrences dans le seul texte simple-clean) : l'orthographe
  moderne retient elle-même certaines graphies courtes historiques. Une règle
  aveugle aurait *dégradé* le matching sur ce mot, très fréquent.
- **Décision : dictionnaire de corrections appris depuis le corpus lui-même**
  (`aqr.corpus.imlai_corrections.build_word_corrections`), pas une règle générique.
  Pour chaque verset où Uthmani et simple-clean ont le même nombre de mots
  (alignement position par position fiable — exclut les ~363 versets déjà connus
  pour diverger, cf. brique B6 du 2026-09-25), on compare `normalize_arabic(mot
  Uthmani)` à `normalize_arabic(mot simple-clean)` ; en cas d'écart, la forme
  imla'i majoritaire observée devient la correction. Table dérivée déterministe
  du corpus épinglé (LOCK.json), jamais committée : reconstruite à l'init du
  matcher, comme son index (même budget de temps, cf. mesure ci-dessous).
- **Matcher à deux niveaux (ADR-0003)** : index n-grammes de *caractères* (5-grammes
  sur le texte squeletté sans espaces) en premier niveau, tolérant au bruit lettre
  par lettre ; index trigrammes de *mots* corrigés en second niveau ; les deux
  alimentent le même réalignement fin (`difflib`) pour le score final et le
  `WordSpan` — aucun seuil de rejet en dur, comme avant.
- **2ᵉ bug trouvé en testant `build_word_corrections`** : le vote majoritaire
  n'enregistrait que les paires où la forme Uthmani ET la forme imla'i différaient
  — donc pour un mot presque toujours bien aligné (« الذين », 810 occurrences), les
  810 votes « identité » étaient ignorés et le seul (rare) mauvais alignement
  position-par-position devenait *la* correction retenue, cassant ce mot très
  fréquent (corrigé à tort vers « اللذين »). Fix : compter aussi les votes
  d'identité, ne retenir une correction que si elle est réellement majoritaire.
- **Mesure après correction** : taux de mots hors du vocabulaire Uthmani corrigé
  9,3 % → 1,07 %. Résiduel dominant connu : le « يا » vocatif, fusionné au mot
  suivant en Uthmani (« يَـٰٓأَيُّهَا ») mais séparé en imla'i (« يا أيها ») — aucune
  substitution mot-à-mot ne peut le corriger puisqu'il n'existe jamais comme mot
  Uthmani isolé dans un verset aligné ; c'est l'index de caractères (sans espaces,
  donc insensible à la frontière de mot) qui l'absorbe.
- **Résultats réels du banc de robustesse** (`scripts/bench_matcher.py`, 2000
  requêtes, graine 42, corpus réel) :
  | Scénario | Top-1 | Latence moyenne |
  |---|---|---|
  | Orthographe imla'i exacte | 99,80 % | 1,85 ms |
  | 1 erreur de lettre / 5 mots | 98,00 % | 1,79 ms |
  | 1 mot manquant | 98,80 % | 1,84 ms |
  | 1 mot en trop | 99,70 % | 2,21 ms |

  Cibles de la phase (≥ 99 % exact, ≥ 95 % avec 1 erreur/5 mots, < 50 ms) dépassées
  sur les quatre scénarios. Un top-1 est compté correct si la référence est la
  bonne OU si son texte est rigoureusement identique à la cible (versets répétés
  mot pour mot, ex. le refrain d'Ar-Rahman, 55:13/16/18/21/23/25/28/30 ×31) : sans
  contexte, aucun matcher ne peut départager deux versets au texte identique — la
  désambiguïsation par contexte est le rôle du décodeur B7 (déjà testé, P9), pas
  de ce niveau. Sans cet ajustement, ces ambiguïtés réelles faisaient chuter le
  score exact-imla'i mesuré à 98,7 % sur un échantillon de 300.
- **Basmala (item 4)** : `aqr.domain.quran_structure.is_basmala_only_span` détecte
  qu'une plage de mots reconnue ne couvre que la basmala concaténée en tête du
  verset 1 (convention Tanzil, toutes sourates sauf At-Tawbah/9) — jamais pour
  1:1 (Al-Fatiha), où la basmala EST le verset. Utilitaire pur, prêt pour le
  pipeline (B7/B9) qui l'utilisera pour étiqueter `NonQuranKind.BASMALA` au lieu
  d'un verset 1 partiellement reconnu — le branchement réel attend B1-B5 (phase 4).

## 2026-10-02 — Phase 2b : recherche sur le flux continu (ADR-0004)
- **Constat de la revue externe vérifié** : le matcher notait contre le verset entier ; fenêtres
  partielles, multi-versets et verset 1 sans basmala mal notés, faux versets ≥ 0,75 (I3).
- **Décision** : `FlowVerseMatcher` remplace `NgramVerseMatcher` (alignement local sur le flux,
  score = couverture de la requête × preuve, basmala du verset 1 = unité à part). Détail et
  conséquences : `docs/adr/0004-recherche-sur-flux-continu.md`.
- **Paramètre `evidence_words` (5)** : sans pénalité de longueur, un mot rare isolé aurait un
  score de 1,0 (le reste du verset n'est plus pénalisé) et franchirait le seuil (F5). La preuve
  croît linéairement jusqu'à 5 mots expliqués. Mesuré : 0 faux verset sur 12 000 fenêtres de
  3–25 mots (graines 7 et 11) ; coût : ~35 % des fenêtres de 3–6 mots restent UNCERTAIN, ce qui
  est voulu (formules répétées, I3).
- **Tie-break « bornes de verset »** : à score égal, le segment qui épouse un verset entier passe
  devant celui qui coupe un verset plus long (ex. 33:3 vs fin de 4:81). Sans lui, le banc
  « top-1 » de la phase 2 tombait à 98,7 % sur texte exact (ordre arbitraire dans l'égalité).
- **Basmala en tête** : détection tolérante (4 mots dans l'ordre, un parasite toléré). Sans cette
  tolérance, « mot manquant » dans la basmala faisait tomber le banc de phase 2 à 97,25 %.
  Requêtes de 1-2 mots : les mots entiers complètent les n-grammes (cas « basmala + الم »).
- **Performance** : première version 25-37 ms sur 25 mots ; mot de ≤ 3 lettres = identité
  seulement (la distance admissible est 0) + groupes de diagonales sous 30 % du meilleur non
  raffinés -> 2-3 ms, résultats identiques.
- **Invariant de domaine levé** : `Detection` RECOGNIZED peut avoir `time_interpolated=True`
  (frontière entre versets d'un même segment estimée ; le segment reste mesuré). Test mis à jour.
- **Dette de typage** : `mypy` signalait 4 erreurs (génériques `dict`, `Any` renvoyé par
  `response.read()`), invisibles tant qu'il était bloqué sur le poste Windows ; corrigées ici.
- **Résultats** (`scripts/bench_segments.py`, graine 7, texte exact) : 3–6 mots top-1 90,7 %
  (65,8 % avant), 7–12 mots 98,8 % (87,0 %), 13–25 mots 99,7 % (98,0 %), verset 1 sans basmala
  98,4 % (71,7 %) ; faux versets nommés : 0 partout (10, 5, 0, 4 avant). Banc phase 2 :
  99,85 / 99,35 / 99,00 / 99,60 % (avant : 99,80 / 98,00 / 98,80 / 99,70 %).
- **« Partiels »** : quelques détections RECOGNIZED recouvrent les bons versets sans les égaler
  (un verset de plus ou de moins à une borne de fenêtre, < 1 %). Pas de faux verset, mais à
  surveiller en phase 6 sur de vrais audios.

## 2026-10-04 — Phase 3 : outillage de données (noyau, ingest, split)
- **Manifeste** (`aqr.data.manifest`) : même format YAML que `docs/TEST-CORPUS.md` /
  `tests/acceptance/test_manifest.py` (`expected` avec `t`, `ref`, `words`, `status` ; `non_quran`
  avec `kind`), enrichi de `sha256`, `categorie`, `recitant`, `langues`, `duree_s`, `statut`
  (`a_annoter` | `annote`), `split` (`dev` | `test`), `origine` (`reel` | `mix`) et `boundaries`
  (`exact` | `approximate`, pour les coupures estimées d'un mix). Écriture atomique, idempotente ;
  statuts de vérité limités à `recognized`/`inferred` côté étiquettes (pas d'`uncertain` en
  vérité terrain). Un cas porte `words: all` ou une plage `a-b` (index de `CorpusRepository.words`).
- **Fiche** : schéma strict, toutes les erreurs remontées d'un coup (clé inconnue = erreur, pas
  d'oubli silencieux d'une faute de frappe). `recitant` = identifiant anonyme, normalisé en
  minuscules (`imam_A` et `imam_a` = même groupe de découpage, sinon fuite dev/test possible).
- **Ingest** : idempotence par SHA-256 (un contenu redéposé sous un autre nom n'est pas
  dupliqué ; son WAV dérivé manquant est régénéré) ; un fichier en erreur n'arrête pas les
  autres ; l'original et sa fiche sont déplacés (pas copiés) dans `<catégorie>/` seulement après
  conversion réussie. Convertisseur injectable (tests sans ffmpeg) ; ffmpeg réel testé.
- **Split** : récitants ordonnés par hachage salé (déterministe, indépendant de l'ordre),
  affectation gloutonne vers `dev_ratio` pondérée par la durée. **Une affectation écrite n'est
  jamais modifiée** : les lots arrivent au fil de l'eau, un récitant ne doit pas migrer de dev à
  test. Un manifeste qui contiendrait déjà un récitant des deux côtés est refusé (erreur).
- Dépendance de typage `types-pyyaml` ajoutée aux extras `dev` (mypy strict sur `aqr.data`).
- **Étiquettes Audacity** (`aqr.data.labels`) : `début<TAB>fin<TAB>étiquette`, temps au microseconde ;
  verset `67:4|recognized`, plage `2:255[1-9]|recognized` ou `[5]`, zone `NON_QURAN:<nature>`.
  Aller-retour exact (propriété Hypothesis sur des temps à la milliseconde, toutes les natures
  non coraniques). Lignes vides, `#` et sélections spectrales (`\`) ignorées ; **toutes** les
  erreurs d'un fichier sont remontées avec leur numéro de ligne. `uncertain` refusé : une vérité
  terrain est tranchée. Import refusé si une étiquette dépasse la durée de l'audio (+ tolérance).
- **`export-labels` ne remplace jamais un fichier existant** (il peut contenir des corrections
  manuelles faites dans Audacity) sans `force` explicite.
- **`preannotate` : interface seulement** (`PreAnnotator`, `PreAnnotation`) — le moteur est
  branché en phase 5. `PreAnnotation` entrelace librement versets et zones non coraniques : les
  assises/prêches (C09/C11) citent un verset ou un hadith au milieu de français, les khutbas
  (C10/C11) citent versets et hadiths en arabe ; aucune hypothèse de contenu pur. Testé avec un
  faux annotateur (français → citation 2:255[1-9] → hadith arabe → français) relu à l'identique.
- **EveryAyah** (`aqr.data.everyayah`, `scripts/fetch_everyayah.py`) : sous-ensemble configurable
  (récitants × sourates, défaut 3 × 10 : Alafasy, Husary, Abdul Basit ; sourates 1, 67, 97, 103,
  108–110, 112–114). Empreintes SHA-256 **épinglées au premier téléchargement** dans
  `everyayah/LOCK.json` : un fichier local altéré ou un contenu distant qui a changé depuis est
  une erreur explicite (jamais une substitution silencieuse) ; une page HTML renvoyée à la place
  d'un MP3 est rejetée ; un échec réseau sur un fichier n'arrête pas le lot ; relance idempotente
  (0 retéléchargement). Vérifié en réel (Alafasy, sourate 112 : 5 fichiers, 2ᵉ passage 0/5).
- **Constat utile aux mixages** : sur EveryAyah les fichiers `SSSVVV.mp3` du verset 1 ne contiennent
  **pas** la basmala (`112001.mp3` ≈ 3 s) — elle est dans `bismillah.mp3` séparé. « Verset 1 avec
  basmala » = `bismillah.mp3` + verset 1 ; « sans basmala » = le fichier seul. Exception : 1:1
  (la basmala est le verset).
- **Mixages synthétiques** (`aqr.data.mixer`, `scripts/make_mix.py`) : 11 scénarios reproductibles
  (graine → même audio, même vérité) mappés aux catégories du corpus : murattal continu (C01), saut
  de sourate (C03), verset brouillé → `inferred` (C04), répétition/i'ada (C05), arrêt au waqf puis
  reprise (C06), plusieurs versets courts d'un souffle (C01, segments **contigus**), verset 1 avec
  et sans basmala (C01), prière (C08 : takbir, isti'adha, Fatiha 1:1-7, amin, sourate, takbir),
  assise FR (C09 : français → citation → hadith arabe → français), khutba (C10/C11).
- **Vérité exacte à la milliseconde** : toutes les longueurs sont des multiples de 16 échantillons
  (1 ms à 16 kHz) ; les temps sont calculés depuis les échantillons, jamais mesurés. Un test relit
  l'audio et vérifie que chaque verset complet se trouve à l'endroit annoncé (fréquence du ton).
- **Seule exception, déclarée** : la coupure *interne* d'un verset (partiel : waqf, reprise) est
  estimée au prorata des lettres puis collée au silence le plus proche (fenêtre `snap_window_s`) ;
  le mix porte alors `boundaries: approximate` et une tolérance de cas élargie
  (`approximate_tolerance_ms`). Les clips EveryAyah n'ont pas d'horodatage mots.
- **Convention de vérité du verset 1** (sourates ≠ 1, 9, dont le texte Tanzil porte la basmala en
  tête) : avec basmala (`bismillah.mp3` + verset) = `words: all` ; sans basmala (fichier EveryAyah
  seul, qui ne la contient pas) = `words: 5-N`. Pour 1:1, la basmala est le verset.
- **Sources manquantes = scénario écarté avec sa raison, jamais inventé** : isti'adha, takbir, amin
  (`specials/`) et parole non coranique FR/AR (`speech/`) ne viennent pas d'EveryAyah et sont à
  fournir (ou à découper des audios annotés) ; sans eux, prière/assise/khutba sont écartés et
  signalés. Un scénario qui ne peut produire qu'un seul mix distinct (peu de verses disponibles)
  ne produit pas de doublons exacts (`variété insuffisante`).
- **Banc 2b réutilisé** : `mix_segment_cases` transforme les mixages en `SegmentCase` (imla'i,
  suites contiguës = multi-versets, brouillés exclus, versets à découpage mots Uthmani≠simple-clean
  écartés). Test : tous les types (partiel, multi_versets, verset 1 avec/sans basmala, verset entier,
  isti'adha/takbir/amin, inferred) présents et **0 faux verset** nommé. Mesure réelle sur des
  mixages EveryAyah (Alafasy, sourates 1/112–114, graine 7) : 93 segments, 0 faux verset ;
  top-1 100 % sur multi-versets (6), partiels (3), verset 1 avec (4) / sans basmala (10).
- **CLI `aqr data`** (`aqr.cli`) : `ingest`, `export-labels`, `import-labels`, `preannotate`, `split`
  (`--dry-run`). Chemins : `$AQR_AUDIO_DIR` (ou `--audio-dir`) ; manifeste = `--manifest`, puis
  `$AQR_MANIFEST`, puis `tests/fixtures/audio/manifest.yaml`, puis `<audio_dir>/manifest.yaml`.
  Codes de sortie : 0 succès · 1 erreur sur les données · 2 usage impossible (variable manquante,
  moteur de pré-annotation indisponible). `main()` reçoit `env`/`out`/`err`/`convert` : testable sans
  ffmpeg ni variables réelles. Vérifié en réel (ffmpeg, clip EveryAyah) : ingest idempotent
  (2ᵉ passage 0 ajouté), WAV 16 kHz mono, split, aller-retour d'étiquettes.
- **Lot 1 non ingéré** : `HF_TOKEN` et `AQR_HF_DATASET` absents de l'environnement de cette session
  (vérifié aux trois niveaux Windows). Aucun audio récupéré ailleurs. À faire : `python
  scripts/audio_lot.py fetch --lot 1` puis `aqr data ingest` et `aqr data split`.
- **Constat hors périmètre, à trancher** : la PR #9 (phase 2b, session cloud) a fusionné dans
  l'historique public de `develop` un message de commit contenant `Co-Authored-By`, `Claude-Session`
  et un `Co-authored-by` — contraire à la règle de signature d'AGENTS.md (les hooks n'étaient pas
  encore installés). Non réécrit : modifier `develop` exigerait un force-push.
- **Lot 1 ingéré (2026-10-04)** : les audios étaient déjà sur le poste de travail
  (`D:\01-Dev\Data\aqr-audio`, mise en forme `lot-1-upload/lot-1/lot1-NN.mp3`) ; le dataset Hugging
  Face privé `printf0cherif/aqr-audio-private` ne contenait que `.gitattributes` (vérifié dans le
  navigateur connecté) — l'envoi n'avait jamais eu lieu, ce qui expliquait l'échec du `fetch`
  côté cloud, indépendamment des variables d'environnement. `audio_lot.py import` (sans réseau,
  sha256 vérifié, 12/12) puis `aqr data ingest` (ffmpeg réel, 37 s) : 12 cas, durées WAV = manifeste
  (8,69 h au total), 16 kHz mono. `aqr data split` : dev 6,15 h (6 récitants) / test 2,55 h
  (5 récitants), sans fuite. Cas `a_annoter` : l'annotation Audacity reste à faire (≈ 1 h par heure).
- **`fetch_corpus` vérifie le lock** (PR #17) : plus de réécriture silencieuse ; `--repin` explicite.
- **Historique** : le message de la PR #9 (signatures d'IA) a été réécrit sur `develop` (force-push
  avec garde `--force-with-lease`, arbres identiques, 0 signature restante sur toutes les branches
  distantes) ; la branche de PR `claude/awesome-johnson-hy80tv` supprimée. Les commits d'origine
  restent atteignables via `refs/pull/9/head` (propre à GitHub, non supprimable).

## 2026-10-05 — Phase 4 : adapters audio (début)
- **Pile lourde installée et vérifiée sur le RTX 5090 Laptop (24 Go, Blackwell sm_120)** : PyTorch
  `2.11.0+cu128` depuis l'index `https://download.pytorch.org/whl/cu128` (6 min), `transformers` 5.18,
  `nemo_toolkit[asr]` 3.0.0 (2 min), numpy 2.4, soundfile. Vérifié : noyau CUDA réel exécuté (matmul
  4096², `arch_list` contient `sm_120`), `import nemo.collections.asr` OK, `pip check` propre. Piège
  documenté (README) : un GPU Blackwell exige PyTorch ≥ 2.7 en CUDA 12.8 — installer torch AVANT
  l'extra `[asr]`, sinon pip peut tirer une roue CPU/sans sm_120.
- **B1 `FfmpegAudioExtractor`** (`aqr.adapters.ffmpeg_extractor`) : tout format ffmpeg -> `array('f')`
  mono 16 kHz (sans numpy), erreurs typées en français (`AudioExtractionError` : ffmpeg absent,
  fichier illisible, piste audio absente — la vidéo muette est reconnue via ffprobe plutôt qu'en
  parsant un message ffmpeg fragile). 28,5 min de MP3 en 3,3 s (≈ ×500 temps réel).
- **Défaut du contrat trouvé sur de vraies données** : un MP3 du lot 1 donnait des échantillons
  jusqu'à **1,43** (décodeurs flottants > 0 dBFS ; 0,3 % des échantillons) alors que le port promet
  [-1, 1]. Essayé et **rejeté** : `alimiter` (n'agit pas, le rééchantillonnage suit) et le passage par
  s16 dans la chaîne ffmpeg (corrige le pic mais **baisse le niveau de 3 dB**, RMS 0,25 -> 0,177 : le
  mixage mono n'a pas la même loi). Retenu : signal exact + `clamp_full_scale` (écrêtage des seuls
  dépassements, aucune normalisation, pas de copie s'il n'y a rien à écrêter ; numpy si présent).
- **Socle des tests de contrat** : `tests/support/{audio,fakes}.py` (fichiers générés : sinus, silence,
  MP3, vidéo avec/sans piste audio) ; `pythonpath` pytest étendu à la racine pour `tests.support`.
  Contrat B1 rejoué contre le fake ET ffmpeg réel (rapide : pas de marqueur `slow`).
- **Infrastructure des modèles** (`aqr.models`, `scripts/fetch_models.py`, `models/LOCK.json`
  versionné) : même discipline que le corpus. Premier passage = téléchargement de la tête du dépôt
  puis **épinglage** (révision Git + SHA-256 par fichier, recoupé avec l'empreinte LFS annoncée par
  le serveur) ; ensuite le LOCK fait foi : contenu distant différent, fichier local altéré ou
  téléchargement corrompu = erreur explicite ; fichier écrit dans un `.part` puis installé
  seulement s'il est conforme ; `--repin` explicite pour accepter une nouvelle version. `.gitignore`
  : `models/*` + exception `models/LOCK.json` (aucun poids dans git).
- **Constats sur les dépôts réels** (vérifiés par l'API Hugging Face) : le dépôt FastConformer
  contient **9 checkpoints** (`phase1_top3/…` à `phase3_full/…`, nommés par WER) — retenu
  `phase3_full/phase3_full_wer0.0014.nemo` (459 Mo, le dernier de l'entraînement progressif) ; le
  modèle Whisper-Tarteel n'a **qu'un `pytorch_model.bin`** (pickle, pas de safetensors) : épinglé par
  empreinte, à charger avec `weights_only` ; le segmenteur est un `model.safetensors` de 2,3 Go.
  Licences : FastConformer CC-BY-4.0, Whisper Apache-2.0, segmenteur MIT.
- **Téléchargés et épinglés (2026-10-05)** dans `D:\01-Dev\Data\aqr-models` : fastconformer-quran
  @ b33af7936f9a (459 Mo), whisper-base-quran @ 5c3c53fdf927 (292 Mo), recitation-segmenter
  @ 5ee90364e709 (2322 Mo) ; 4 min 41 s ; 2ᵉ passage 3 s, rien retéléchargé. `AQR_MODELS_DIR` n'est pas
  défini de façon persistante (passé par commande ou `--models-dir`).
- **B4 `FastConformerQuranASR`** (`aqr.adapters.fastconformer`) : NeMo hybride RNNT/CTC, checkpoint
  `phase3_full` épinglé, vérification SHA-256 avant chargement (un `.nemo` est une archive qui
  s'exécute), mots horodatés (résolution = trame de 80 ms), temps absolus dans le clip, texte brut
  jamais modifié (I1), `transcribe_batch` pour regrouper les segments en un appel GPU. Contrat du
  port rejoué contre un fake ET le vrai modèle (marqueur `slow`, ressources lues dans
  `AQR_MODELS_DIR`/`AQR_AUDIO_DIR`, test sauté si absentes).
- **Format RÉEL de sortie relevé (216 versets EveryAyah, 3 récitants, 40,7 min)** : texte arabe
  brut en orthographe imla'i ; **voyelles dans 85 % des sorties seulement** (« قُلْ هُوَ اللَّهُ
  أَحَدٌ » mais « الصمد », « بسم الله الرحمن الرحيم » nus) ; pas de ponctuation ; le **dernier mot est
  parfois tronqué** (« النَّاسِ » -> « النَّ ») ; quelques mots inventés (« وَالْعَفْرِ » pour
  « وَالْعَصْرِ ») ; la basmala d'Abdul Basit sort vide ou mutilée. Échantillon de 80 sorties
  versionné (`tests/fixtures/asr/fastconformer_everyayah.json`, texte et temps seulement) et rejoué
  par `tests/unit/test_matcher_real_asr.py` : le matcher (B6) doit y retrouver le bon verset
  (>= 93 %) et **ne jamais nommer un faux verset** au-dessus du seuil du décodeur (I3).
- **Mesure ASR -> matcher** (`scripts/capture_asr_samples.py`, 216 versets) : top-1 **97,2 %**
  (Alafasy 95,8 / Husary 98,6 / Abdul Basit 97,2), nommés justes au seuil 0,75 : 79,2 % (le reste
  est UNCERTAIN : versets très courts/ambigus, voulu), **0 faux verset nommé**, vitesse **RTF 0,017-
  0,018 (~×57 temps réel)** sur RTX 5090, chargement du modèle 7 s.
- **Silence numérique -> hallucination** : sur 3 s de zéros le modèle émet « الم » (une lettre
  coranique isolée) — c'est « il voit du Coran partout » (I3/I4) à l'échelle d'un mot. Garde
  d'énergie configurable (`silence_rms`) : un segment de silence absolu n'est jamais envoyé ; ne
  protège PAS du bruit réel (rôle de B2 et du QuranicityGate B5, phase 7).
- **Marge de contexte : essayée, mesurée, désactivée.** Hypothèse (troncature de fin de mot due aux
  bords nets) confirmée sur 6 cas mais **infirmée à l'échelle** : top-1 97,2 % sans marge contre
  96,8 % (0,3 s + bruit 1e-3), 96,3 % (0,3 s de zéros), 94,9 % (0,3 s + 3e-3), 94,0 % (0,5 s + 2e-3) —
  la marge corrige des troncatures mais provoque d'autres hallucinations aux bords. Défaut 0, réglage
  conservé (`context_pad_s`, `pad_noise`) pour re-mesurer avec du vrai contexte audio. Leçon : un
  essai manuel sur quelques cas ne tranche pas, la mesure sur l'ensemble si.
- **Confiance** : l'entropie NeMo donne 0,38-0,66 même sur une transcription parfaite (non
  calibrée) ; `max_prob` retenu. La confiance de l'ASR n'est PAS le critère d'acceptation (c'est le
  score du matcher, calibré, I3) ; elle reste exposée telle quelle, bornée à [0, 1], 0.0 si absente.
- **Décodeur `ctc` par défaut** (provisoire, phase 6) : les temps de mots CTC sont contigus, ceux du
  RNNT ont des trous et des mots d'une trame (« اللَّهُ » 1.04-1.12).
- **À corriger côté mixeur (constat EveryAyah)** : `bismillah.mp3` n'existe pas pour
  `Abdul_Basit_Murattal_192kbps` (404) ; `DiskClipProvider.bismillah` lèverait une erreur pour les
  scénarios « verset 1 avec basmala » avec ce récitant.
- **B4 challenger `WhisperTarteelASR`** (`aqr.adapters.whisper_tarteel`) : Whisper-base fine-tuné,
  `pytorch_model.bin` épinglé et vérifié avant chargement, chargé par `transformers` (weights_only).
  La `generation_config` du dépôt est obsolète (pas de langue/tâche : `generate(language=…)` lève) :
  complétée à partir du tokenizer (`<|ar|>`, `<|transcribe|>`, `<|notimestamps|>` lus, pas écrits en
  dur). transformers 5 a supprimé `forced_decoder_ids`. Fenêtre d'entrée de 30 s : un segment plus long
  est refusé (à découper en amont par B2).
- **Horodatages par mot de Whisper-Tarteel : inutilisables, essayés puis écartés.** DTW des attentions
  croisées avec 3 jeux de têtes (openai-base, dernière couche, deux dernières couches), via `generate`
  et via le pipeline `return_timestamps="word"`, avec et sans `num_frames` : dans tous les cas les mots
  s'entassent dans la 1ʳᵉ fraction de seconde et le dernier absorbe le reste (« أَحَدٌ » 0,18->2,9 s).
  Le modèle, affiné sur des clips d'un verset, a perdu l'alignement. Décision : le **texte** vient de
  Whisper, les **temps de mots sont estimés** au prorata des lettres dans le segment et déclarés
  (`engine` ... `/times-estimated`) ; la seule mesure de temps fiable est celle du segment (B2) ou du
  FastConformer.
- **Comparaison sur EveryAyah (même matcher, 3 récitants)** : Whisper-Tarteel **top-1 100 %** (212
  versets <= 30 s), **100 % de sorties vocalisées**, 84,4 % nommés justes au seuil, 0 faux verset,
  RTF 0,084 (~x12 temps réel) ; FastConformer **97,2 %**, 85 % vocalisées, 79,2 % nommés, 0 faux, RTF
  0,017 (~x57). **Réserve de méthode** : les deux modèles ont été entraînés sur EveryAyah
  (`tarteel-ai/everyayah`) — ce banc est un **plafond optimiste**, pas une mesure de généralisation ;
  le choix du moteur par défaut se fera sur du vrai audio (phase 6). Whisper est plus précis en
  texte mais 5x plus lent, sans horodatage de mots et limité à 30 s ; le FastConformer est rapide,
  horodate les mots et expose les logits CTC (décodage contraint).
- Échantillons de 80 sorties réelles par moteur versionnés (`tests/fixtures/asr/*_everyayah.json`),
  rejoués par `test_matcher_real_asr.py` (bon verset retrouvé, 0 faux verset au-dessus du seuil).

## Phase 4 — B2 segmenteur (recitation-segmenter-v2 + repli Silero VAD)
- `RecitationSegmenterV2` (principal, modèle épinglé et vérifié par `models/LOCK.json`) et
  `SileroVadSegmenter` derrière le même port ; `FallbackSegmenter` bascule sur Silero si le principal
  est indisponible (RuntimeError/OSError/ImportError) mais ne masque pas une `ValueError` (erreur de
  logique). Réglages (silence/parole minimale, marge, seuil VAD) en configuration, pas en dur.
- **Mesure sur 10 min d'audio (RTX 5090)** : recitation-segmenter-v2 ~4-4,9 s (RTF ~0,007, bf16) ;
  Silero ~11-12 s (RTF ~0,019, CPU). Les deux retrouvent les 3 versets de test à IoU >= 0,8.
- Vérité terrain du contrat : les spans vrais bornent la **parole** (énergie), pas la durée du MP3 —
  la queue de silence (~1 s, RMS 0,004) du dernier verset EveryAyah n'est pas de la parole ; les deux
  segmenteurs la rejetaient à raison.
- Dépendances : `recitations-segmenter==1.0.0` et `silero-vad==6.2.3` dans l'extra `segmenter`, à
  installer avec `--no-deps` après `[asr]` (leurs contraintes torch entrent en conflit avec le pin
  Blackwell cu128).

## 2026-10-06 — Reprise : état vérifié, essais reproductibles, défauts documentés
- **Incohérence de mon rapport précédent, résolue** : la dernière PR fusionnée est la **#24**
  (`d9795b2`, 2026-10-05), pas la #9. La #9 est `c877d9b` sur `develop` (son message a été réécrit
  après coup, cf. entrée du 2026-10-04 ; le SHA `67f4797` renvoyé à la fusion n'existe plus). Les
  PR #10 à #24 sont toutes fusionnées dans `develop` (liste GitHub vérifiée) ; aucune n'est ouverte.
  Ma branche locale d'origine (`3673360`, pré-squash) est conservée localement sous
  `archive/pr9-pre-squash` ; son contenu est celui de la #9.
- **Lot 1 : empreintes vérifiées sur le dataset public** (`scripts/fetch_public_lot.py`, nouveau,
  sans jeton, révision épinglée `f00ebced79755213c0d2050566126602454f5517`) : 12/12 conformes. Le bloc
  `hf_dataset` de `docs/data-lots/lot-1.yaml` épingle dépôt et révision. `scripts/audio_lot.py fetch`
  reste pour un dataset privé (jeton, disposition `lot-1/<id>.mp3`) ; le dataset actuel est à plat.
- **Droits** : le dataset public contredit « usage interne, jamais redistribué » ; consigné dans
  `docs/data-lots/RIGHTS.md` (décision de Cherif). Visibilité inchangée, aucun jeton créé, aucune
  republication.
- **Essais v0** (lot1-05/06/09, Whisper-Tarteel + recitation-segmenter-v2, CPU) : script et sorties
  retrouvés et versionnés (`scripts/repro/`, `docs/evaluation/trials/`, rapport
  `docs/evaluation/lot1-trials.md`). Sorties **expurgées** : aucune transcription brute. Pas de
  vérité terrain : aucun taux.
- **QuranEnc** : anomalie documentée (`docs/KNOWN-ISSUES.md` KI-1, audit rejouable
  `scripts/audit_quranenc.py`) : `french_hameedullah` 42:3 dupliqué et 42:4 contaminé ; rien n'est
  réécrit (I2). Le 75:35 de `french_rashid` signalé par l'heuristique est un faux positif vérifié.

## 2026-10-06 — Environnement de test reproductible

- **Constat** (venv neuf, `pip install -e ".[dev]"`, base d9795b2) : 28 échecs/erreurs pytest et 2
  erreurs mypy. Chaque cas diagnostiqué, aucune régression de code :
  - 17 `test_fastconformer_adapter` + 8 `test_whisper_adapter` + 3 `test_speech_segmenter_contract[fake]`
    : `ModuleNotFoundError: numpy`. **Dépendance d'environnement non déclarée** (numpy seulement dans
    l'extra `audio`, alors que les tests exercent du code qui l'importe). Corrigé : `numpy` dans `dev`.
  - mypy `huggingface_hub` introuvable (`hf_hub.py:17`) : **dépendance d'environnement** (paquet
    absent de `dev`, importé paresseusement).
  - mypy « Unused type: ignore » (`segmenters.py:91`) : **défaut préexistant de configuration** — le
    `ignore` n'est utile que si transformers est installé ; l'ancienne config est verte avec les
    lourdes dépendances et rouge sans (vérifié des deux côtés).
- **Décision** : overrides mypy par module (`follow_imports = "skip"`, `ignore_missing_imports`) pour
  huggingface_hub, torch, transformers, silero_vad, recitations_segmenter, nemo, et suppression du
  `type: ignore`. Résultat identique installés ou non. `soundfile` et `huggingface_hub` non ajoutés à
  `dev` (non importés par les tests). Aucun skip/exclusion ajouté ; les 4 skips restants sont
  l'`importorskip("silero_vad")` existant (extra `segmenter`).
- Résultat : 383 passed, 4 skipped, 16 deselected ; ruff et mypy verts dans un venv neuf et mypy vert
  avec torch/transformers. Détail : `docs/REPRODUCIBILITY.md`.

## 2026-10-06 — Repli Silero : limite mesurée, défauts inchangés
- Mesure de fond (sans vérité terrain, aucun taux de précision) sur 2 extraits de 3 min : le repli
  Silero par défaut fragmente la récitation à pauses longues (lot1-05 : 30 segments, 53 % < 1 s, contre
  7 segments de 11 à 28 s pour recitation-segmenter-v2) ; aucun `min_silence_ms` de {100, 300, 500, 800}
  ne convient aux deux extraits (lot1-06 : segments jusqu'à 131 s à 500/800 ms).
- Décision : défauts NON modifiés (pas de calibrage sans vérité terrain) ; limite rendue visible
  (docstrings, `RELIABLE_BY_DEFAULT = False` gardé par test). Propositions et chiffres :
  `docs/evaluation/silero-fallback.md`. v2 non mesuré sur le second extrait (budget CPU).

## 2026-10-06 — Décodeur : répétitions, trous, rendu des passages partiels
- **Défaut du décodeur (pré-existant, trouvé en relisant pour le pipeline)** : `_merge_repetitions`
  fusionnait deux détections consécutives du même verset en prenant l'**union des temps**, même quand
  les mêmes mots étaient redits (reprise) ou qu'un long intervalle séparait les deux passages : le
  temps annoncé couvrait alors des passages non reconnus. Nouvelle règle : mots redits
  (`first_word <= last_word` précédent) → **deux détections**, la seconde `is_repetition=True`, chacune
  avec son temps (playbook P8 : « deux détections marquées répétition ») ; moitiés contiguës →
  fusion seulement si l'écart temporel ≤ `merge_max_gap_s` (5 s, **provisoire**, à calibrer sur des
  annotations humaines, phase 6).
- **Hypothèse d'un verset manquant** : `INFERRED` n'est supposé que si l'écart ≤ `infer_max_gap_s`
  (180 s, provisoire). Au-delà : aucune hypothèse (autre chose a été dit). `INFERRED` n'est jamais
  promu en reconnu.
- **Domaine** : `Detection.is_repetition` (RECOGNIZED seulement). `engine_version` du décodeur : v2.
- **Rendu (B9)** : l'item JSON porte `words`, `partial`, `repetition` ; `text` = sous-chaîne EXACTE du
  Mushaf pour les mots couverts (marques de pause comprises), le verset entier si tout est couvert ;
  la traduction garde `scope: "verse"` (non découpable). Sous-titres : un verset `UNCERTAIN` n'est
  jamais nommé par son texte (`[incertain : 55:13 | 55:16]`), un `INFERRED` est préfixé `[déduit]`.
  Les tests du renderer utilisaient des spans d'un mot pour des versets entiers : corrigés (spans
  complets), sans quoi le texte partiel rendu aurait été tronqué.

## 2026-10-06 — Décodage contraint (ADR-0005)
- Vérifié d'abord : **absent** (aucun trie ni chemin poubelle dans `src/`). Implémenté sous forme de
  preuve acoustique sur treillis CTC (`aqr.decoding.ctc_constrained`) plutôt qu'un décodeur de
  faisceau sur trie : testable sans modèle, comparable au chemin libre (= chemin poubelle).
- **Non validé sur audio réel** : pas de NeMo/GPU ici. Pas de seuil par défaut (porte désactivée),
  pas de taux. Reste à faire : exposer le treillis du FastConformer + l'encodeur de symboles, puis
  calibrer le seuil sur des annotations humaines.

## 2026-10-06 — `aqr recognize` (pipeline B1→B2→fenêtres→B4→B6→B7→B9)
- **Vérifié d'abord** : aucun pipeline ni commande `recognize` n'existait (`cli.py` = `aqr data`).
- **Principes** (AGENTS I3/I4/I5) : une fenêtre n'est jamais un verset par défaut → **abstention** avec
  raison (`silence`, `empty_transcript`, `no_candidate`, `below_threshold`) ; formules (takbir, isti'adha,
  amin) et basmala d'ouverture → `non_quran` ; un verset manquant reste `INFERRED` (décodeur) ; l'ambigu
  reste `UNCERTAIN` et n'est jamais nommé dans la sortie (ni texte ni traduction).
- **Fenêtres** : les segments > 25 s (Whisper : 30 s) sont coupés au creux d'énergie le plus proche de la
  coupe idéale, pas à intervalle fixe (essai v0 : découpe dure) ; morceaux contigus.
- **Temps = ceux des passages** : chaque détection porte le temps de ses fenêtres. Défaut corrigé dans le
  décodeur : une observation écartée entre deux moitiés d'un même verset interdit leur fusion (sinon le
  temps annoncé couvrirait un passage non reconnu).
- **Basmala** : « 1:1 non suivi de 1:2 » ou plage de mots ne couvrant que la basmala d'un verset 1 →
  `non_quran/basmala` (la basmala d'ouverture d'une sourate n'est pas la récitation d'un verset).
- **Limite assumée de rappel** : les versets de 1-2 mots (1:3, 112:2…) isolés passent sous le seuil
  (`evidence_words`) → abstention. Préféré à un faux verset ; une acceptation guidée par le contexte est
  à mesurer sur des annotations (phase 6).
- **Segmenteur** : défaut = segmenteur de récitation, **sans repli silencieux** ; Silero seulement sur
  demande (`--segmenter silero` ou `--allow-fallback-segmenter`) et toujours signalé dans `warnings`.
- **`--constrained`** refusé (code 2) : voir ADR-0005.
- **Défauts de config** (`--asr whisper`) : provisoire, Whisper est le seul ASR exécutable sans NeMo/GPU ;
  le choix du moteur par défaut dépend de la phase 6 (vérité terrain).
- Similarité de mots extraite de `FlowVerseMatcher` (`aqr.matching.similarity`) pour les formules.
- **Exécutions réelles via `aqr recognize`** (lot1-05/06/09, Whisper + segmenteur de récitation, CPU) :
  `docs/evaluation/lot1-cli-runs.md` + sorties expurgées. Sans vérité terrain : aucun taux. Constats :
  la fusion bornée (`merge_max_gap_s`) fragmente les longues pauses de la récitation en détections
  partielles distinctes (provisoire, à calibrer) ; l'isti'adha mal transcrite par l'ASR reste une abstention
  (pas de reconnaissance partielle de formule, par prudence) ; 1 chevauchement légitime (verset `inferred`
  couvrant l'abstention qu'il explique).
## 2026-10-07 — Atelier local Artist Quran Review
- La demande actuelle choisit Next.js/React/TypeScript, GSAP et wavesurfer.js à la place de la page FastAPI envisagée dans l'ancien plan phase 8. Le serveur Next.js tourne sur `127.0.0.1` et appelle `aqr.cli recognize` comme processus Python réel ; il n'implémente aucun second moteur.
- Chaque import crée un identifiant aléatoire et conserve l'audio hors Git (`AQR_REVIEW_DIR`). L'import d'une prédiction exige le SHA-256 exact de l'audio ; les octets JSON initiaux sont conservés. Les révisions de revue sont séparées et ne changent pas la sortie du moteur.
- Un signalement point/plage, même confirmé, reste une observation partielle. L'export indique explicitement que les métriques sont indisponibles. Un transfert cloud n'est pas automatique : les droits des audios et la destination admissible doivent être vérifiés ; aucun audio n'entre dans Git.
- L'interface affiche les statuts existants sans transformer une abstention en « non-Coran », ni présenter un verset `inferred` comme entendu. Un résultat expurgé indique que le texte n'est pas inclus.

## 2026-10-08 — Dépôt audio global et lecteur personnalisé
- Un fichier audio déposé sur n'importe quelle zone de la page démarre un import de session. Le dépôt choisit le premier fichier dont l'extension est acceptée par l'API ; un JSON éventuellement présent dans le sélecteur reste réservé à l'import manuel, pour éviter de l'associer implicitement à un autre audio.
- Le lecteur personnalisé pilote le même élément `<audio>` que wavesurfer.js et les pistes. La durée du média est mise en état React dès que les métadonnées sont disponibles, y compris lorsqu'elles précèdent l'installation des écouteurs.
- En développement, Next.js peut reconstruire l'URL de requête en `localhost` alors que l'origine de la page reste `127.0.0.1`. La mutation accepte ces deux alias seulement si protocole et port coïncident ; les origines tierces et les ports différents restent refusés.

## 2026-10-08 — Capture micro pour la revue
- La capture reste temporaire dans le navigateur jusqu'au choix explicite « Analyser cette récitation ». Arrêter ouvre une préécoute ; recommencer remplace cette prise. Les pistes micro sont fermées à l'arrêt, en cas d'erreur et lors du démontage du composant.
- La prise choisie suit l'import de session existant avec `source_kind: microphone`, puis le même endpoint `/run` que les fichiers importés. Le moteur ne reçoit aucune hypothèse de verset issue de l'interface. Si le lancement échoue, l'audio reste dans la session et le bouton de relance existant reste disponible.
- Selon le choix du mainteneur, les octets de l'audio, le résultat du moteur et les corrections restent dans le corpus privé hors Git. Le pack ZIP exporte les empreintes et les versions déclarées par le moteur ; seul un manifeste expurgé rejoint Git après qualification des droits et des catégories. Aucun nouvel enregistrement n'est envoyé automatiquement vers un dataset cloud.

## 2026-10-08 — Réparation responsive de l'atelier

- L'état `preview` appliquait la classe `recorder-preview` au conteneur micro, déjà utilisée par le lecteur interne : la règle flex comprimait tous les enfants en une seule rangée. Les états du conteneur utilisent désormais `is-*` et le conteneur une grille à une colonne.
- L'introduction donne plus de largeur à l'import sur grand écran et s'empile sous 1180 px. Les largeurs des colonnes sont bornées avec `minmax(0, ...)` pour éviter la croissance par contenu. Les noms longs de session se tronquent dans l'en-tête ; les commandes conservent leur accès et leur libellé complet dans les attributs du lecteur.

## 2026-10-09 — B3 : métriques de transcription et rapport vitesse / exactitude
- `scripts/evaluate.py` est étendu (pas de second script) : rapport `aqr.evaluation/2` en deux blocs, `vitesse` (temps mur, facteur temps réel, pic de RAM, CPU/cœurs) et `exactitude` (localisation existante inchangée + identification + WER/CER), avec SHA git, empreintes `models/LOCK.json`, empreinte du manifeste, split, seuils et version de normalisation. Les clés existantes (`aggregate`, `cases`…) sont conservées.
- WER/CER en lettres normalisées contre le texte Tanzil des versets attendus, en deux variantes toujours nommées : `tolerante` (normalisation + dictionnaire imla'i sur la référence, CER sans espaces) et `strict-lettres` (normalisation seule, espaces comptés — remplacé, voir 2026-10-09 : correctif strict-lettres de la PR #38). Hypothèse : un ASR écrit en imla'i, le dictionnaire (ADR-0003) ramène la référence Uthmani à sa graphie ; la variante stricte sert de plancher qui ne cache pas cet écart. Agrégation par sommes d'erreurs.
- Identification sans horodatage : sourate, verset exact (par verset attendu), plage exacte (par cas : suite identique), non reconnus, faux positifs sur silence et hors cible. Seul `recognized` compte (I3, I5) ; faux positif = verset `recognized` dans un cas sans verset attendu (I4).
- `--baseline` refuse (code 2, aucune écriture) si le manifeste (fichier ou cas évalués), le split, le schéma ou la normalisation diffèrent ; les différences de git, modèles, seuils, machine sont listées, pas refusées (c'est ce qu'on compare). `--split test` exige toujours `--final`.
- Honnêteté des champs : la transcription brute et le pic de RAM ne sont pas écrits par `aqr recognize` aujourd'hui ; ils entrent par `--transcripts` (`aqr.transcript/1`). Absents, ils sont « non mesuré », jamais estimés. Reste à faire (brique séparée) : faire écrire ce fichier par le CLI / l'atelier.
- Avertissements fixes dans chaque rapport : « identification de verset != validation du tajwid » et « plafond optimiste si audio EveryAyah » (+ comptage heuristique des cas EveryAyah / mixés).
- Corpus de référence (branche `feat/ref-corpus-builder`, schéma figé v1 non encore fusionné) : c'est un manifeste ordinaire (`AudioCase` + bloc `ref` dans `extra`), lu sans modification. Seul couplage : si `ref.condition` vaut `silence` ou `off_target` pour un cas sans verset attendu, il fixe la classe du cas ; le code ne dépend pas de `aqr.data.refcorpus` (branche non fusionnée). Un cas `non_quran` sans aucune zone `non_quran` reste refusé par `evaluate_case` (annotation vide) : le constructeur doit y écrire une zone.

## 2026-10-09 — B3 (correctif PR #38) : `strict-lettres` implémentée selon la spec
- Constat : la « stricte » de la première version n'était que la tolérante sans dictionnaire (référence ET hypothèse passaient par `normalize_arabic`, donc tous les replis `أ إ آ`→`ا`, `ى`→`ي`, `ة`→`ه`, `ؤ`→`و`, `ئ`→`ي` s'appliquaient) avec un CER qui comptait les espaces. Or la spec de normalisation (docs/evaluation/normalisation.md §3, PR #36) définit `strict-lettres` : NFC, signes et tatweel supprimés, non-arabe → espace, espaces compactés, aucun repli sauf `ٱ`→`ا`, `ء` conservé, pas d'`imlai_corrections`.
- Correctif : `_normalize(text, char_map)` factorisée dans `aqr.corpus.normalize` ; `normalize_arabic` garde `_CHAR_MAP` (contrat et `NORMALIZATION_VERSION` inchangés, NFC avant suppression des signes) ; `normalize_strict_letters` / `tokenize_strict_letters` = fonctions distinctes avec la table `{ٱ: ا}`, jamais un drapeau. Le repli de `ٱ` précède le filtre non arabe (U+0671 est hors des plages conservées). NFC avant suppression des signes : `ا`+U+0654 devient `أ` (lettre conservée en stricte), pas un `ا` nu.
- `aqr.eval.transcription` : table `VARIANT_NORMALIZERS` variante → (normaliseur, tokenizer), utilisée pour la référence et l'hypothèse.
- Décision CER : lettres SANS espaces dans les deux variantes. Ainsi l'écart tolérante/stricte ne vient que de la normalisation (replis de lettres, dictionnaire imla'i), jamais des espaces ; une coupure de mots différente coûte au WER, jamais au CER. Le test « CER compte les espaces en stricte » est remplacé par `test_cer_ignore_les_espaces_dans_les_deux_variantes` (seul test existant modifié, justifié par cette décision).
- Hypothèse documentée : la référence reste les mots Uthmani du corpus (comme avant). La stricte est donc un PLANCHER : elle compte aussi les conventions du Mushaf absentes d'une orthographe imla'i (madda `ءَا` contre `آ`, hamza combinant, alef suscrit supprimé contre alef plein, `ى` contre `ي`). Mesure du 2026-10-09, corpus épinglé, hypothèse = texte imla'i du corpus (ASR parfait en imla'i) : tolérante WER 1,55 % / CER 0,27 % ; stricte WER 18,79 % / CER 5,07 % ; Mushaf recopié : stricte 0 %. Ne pas lire la stricte comme un taux d'erreur de l'ASR ; elle ne règle aucun seuil.
- Traçabilité : `STRICT_NORMALIZATION_VERSION = "aqr.normalize-strict/1"` entre dans l'empreinte de normalisation et dans le bloc `normalization` du rapport (`strict_version`) ; `compare_reports` refuse une base qui en diffère ou qui en manque (les rapports d'avant ce correctif portaient des scores « stricts » qui n'en étaient pas). Le message de refus nomme les versions tolérante et stricte.
- Aucun autre appelant de l'ancienne variante stricte dans le dépôt (`scripts/evaluate.py` itère sur `VARIANTS`).
- Relecture indépendante (PR #38) : le refus `--baseline` ne liste plus que les parties de la normalisation qui diffèrent et écrit « absente » pour une valeur manquante (base d'avant le correctif). Décomposition de l'écart stricte/tolérante reproduite le 2026-10-09 (70 798 mots, 5 873 versets à nombres de mots égaux) : 12 658 mots diffèrent en stricte, 5 933 absorbés par les replis seuls, 6 542 par le dictionnaire, 183 par aucun des deux. La description de la variante dans le rapport dit « plancher d'orthographe du Mushaf, pas un taux d'erreur de l'ASR ».

## 2026-10-09 — Quarantaine d'un récitant dont le jeu test a été exposé
- **Problème** : la règle 3 du protocole (`docs/evaluation/protocole-reglage-evaluation.md`) disait qu'un cas
  `test` observé pendant le réglage était « sorti du jeu `test` » sans dire où il va. L'envoyer en `dev`
  contredit le découpage par récitants disjoints (une affectation écrite n'est jamais modifiée) et reviendrait à
  choisir le jeu de réglage d'après ce qu'on a vu du test (sélection a posteriori).
- **Décision** : TOUT le groupe du récitant (parents, mixes, dérivés `<parent>--<label>`) passe en split
  `quarantaine`, jamais en `dev`. C'est un état, pas un jeu : `DataConfig.quarantine_split`, volontairement absent
  de `DataConfig.splits`. Sens unique, définitif ; la mesure finale suivante se fait sur de nouveaux récitants.
- **Code** : `quarantine_recitant(cases, recitant)` (`src/aqr/data/split.py`, `dataclasses.replace`) : idempotent,
  refuse un récitant inconnu, sans affectation ou en `dev` (un mélange dev/test reste une fuite à corriger dans le
  manifeste). `assign_splits` exclut la quarantaine du ratio et ne lève pas ; elle reste une erreur si un récitant est
  en quarantaine ET ailleurs. `scripts/evaluate.py --split quarantaine` est refusé (code 2), `--final` compris.
- **Aucun récitant n'est mis en quarantaine par ce changement** : le motif (date, récitant anonymisé, cause de
  l'exposition, cas touchés) se consigne ici au premier cas réel.
- **À reporter sur #40** (`feat/ref-corpus-builder`, `src/aqr/data/refcorpus.py`, non modifié ici) :
  `validate_ref_manifest` n'accepte que `cfg.splits` ; il doit accepter aussi `cfg.quarantine_split` et signaler
  un récitant en quarantaine ET en dev/test (son contrôle de fuite ne regarde que dev/test). Sa règle « un dérivé
  a le récitant et le split de son parent » couvre déjà le groupe entier.
- **Suite de revue** : `aqr data quarantine <récitant> [--dry-run]` écrit le manifeste ; `aqr data split`
  affiche la quarantaine et y remplit les cas sans split ; `preannotate` refuse aussi la quarantaine.
  **La quarantaine suit la voix** : `mixer.materialize` écrit `mix-<reciter>` (minuscules), autre nom pour la
  même voix ; on a préféré l'accepter dans le code (`voice_key`, `DataConfig.mix_recitant_prefix`) plutôt que
  nuancer la doc, car un mix de la voix exposée restant en `dev` aurait été une fuite. Contrepartie : nommer
  `<reciter>` met aussi en quarantaine ses `mix-<reciter>` déjà en `dev`, et le résumé de la commande liste les
  récitants touchés. `Manifest.upsert` garde le split existant quand le nouveau cas n'en a pas (une
  re-matérialisation ne défait pas une quarantaine) ; un split explicite s'applique toujours.

## 2026-10-09 — Décision d'usage des audios aux droits non établis (provisoire)
- **Statut : provisoire — en attente de confirmation écrite du mainteneur.** Confirmation reçue : non. Texte et
  portée : `docs/data-lots/ref-corpus-provenance.md`, section « Décision d'usage ».
- **Qui** : le mainteneur seul. **Permis provisoirement** : évaluation interne locale, audio hors dépôt, aucune
  redistribution, réglage de la configuration (seuils, décodeur) sur `dev`. **Interdit** : versionner, republier,
  entraîner/affiner un modèle sur ces audios, tout usage de `RetaSy/quranic_audio_dataset`. **Portée** : EveryAyah,
  lots Hugging Face lus pour le corpus de référence, lot 1 (évaluation interne locale seulement).
- **Contradictions levées** : (a) « non clairement autorisé = non autorisé » vs « usage interne d'évaluation » :
  la seconde n'est permise que par la décision, qui est l'unique exception ; (b) `scripts/fetch_everyayah.py`
  télécharge par défaut (3 récitants × 10 sourates, hors dépôt) : documenté, script inchangé, un téléchargement
  n'est pas une autorisation ; (c) le lot 1 n'est pas un précédent (`RIGHTS.md`, `lot-1.yaml`, protocole) ; (d)
  libellé de licence canonique `droits non établis : usage interne d'évaluation uniquement, jamais redistribué
  (docs/data-lots/ref-corpus-provenance.md)`, l'ancien libellé du lot 1 étant documenté comme hérité.
- **Précisions de revue** : la fusion de la PR ne vaut PAS confirmation du mainteneur ; « Qui lance quoi » (le
  mainteneur, ou un contributeur/agent dans un environnement qu'il maîtrise et à sa demande ; un agent cloud
  seulement sur demande explicite pour le lancement) ; tout rapport chiffré mentionne le caractère provisoire
  (`protocole`, « Biais à écrire dans tout rapport ») alors que `scripts/evaluate.py` ne l'affiche pas encore.
  Libellés hérités documentés : lot 1 et mixer (`synthétique : …`), non réécrits.
- **Hypothèse à confirmer** : « régler un modèle » interdit = toucher aux poids d'un modèle ; le calibrage de nos
  seuils sur `dev` (protocole) est classé évaluation interne.
- **Ouvert pour le mainteneur** : confirmer par écrit ; trancher les trois décisions de `RIGHTS.md` ; dire si le
  téléchargement de la copie publique du lot 1 par un agent cloud (`fetch_public_lot.py`) est admis ; aligner le
  libellé hérité (12 cas de `tests/fixtures/audio/manifest.yaml`, `scripts/audio_lot.py`) une fois la décision 3 prise.

## 2026-10-09 — Lot de reconnaissance vérifiable : `run.json`, purge, écriture atomique (PR #41)
- Constats vérifiés sur `8df685c` : `recognize_batch.py` écrivait `<id>.json` dans `--out-dir` sans nettoyer. (a) Un cas en échec ajoutait une ligne d'erreur sans supprimer l'ancien `<id>.json` (autre moteur, autre code), l'écriture n'était pas atomique, et `evaluate.py` lisait tout fichier présent : seul garde-fou, le sha256 de l'AUDIO, qui ne dit rien du moteur ni du code. (b) `timings.json` n'était écrit qu'à la fin (lot interrompu = état partiel indétectable ou ancien fichier d'un autre run) ; les erreurs n'existaient que là ; `main` rendait toujours 0 ; `peak_rss_mb` était le pic cumulé du processus, présenté comme un pic par cas. (c) `evaluate.py` ne voyait pas un dossier mêlant deux moteurs (`speed_block` additionne tout) et `missing_predictions` n'influençait pas le code de retour.
- Décision : un dossier de prédictions est évaluable seulement s'il porte le `run.json` (`aqr.recognition-run/1`, `src/aqr/eval/run.py`) d'un lot `complete`. Le lot supprime au démarrage `run.json`, `timings.json` et les `<id>.json` de SES cas (jamais d'autre fichier ; `--limit` ne touche pas les autres cas), écrit chaque fichier par `mkstemp` dans le dossier + `os.replace` (motif de `Manifest.save`, aucun `.tmp` résiduel), et réécrit `run.json` atomiquement avant le premier cas puis après chacun (`running` → `complete` / `partial` / `interrupted` fixé dans un `finally`, y compris Ctrl-C et exception inattendue). `done` associe chaque cas au sha256 du fichier ÉCRIT ; `evaluate.py` ne lit un cas que s'il y figure avec la même empreinte (les octets vérifiés sont ceux analysés). Code de retour du lot : 0 seulement si `complete`, 1 si cas en échec ou lot interrompu, 2 usage.
- `evaluate.py` : code 2 et rien d'écrit si `run.json` est absent, illisible ou pas `complete`, ou si les sorties (ou `run.json.engine`) mêlent plusieurs moteurs ; code 1 s'il manque un cas évaluable (`missing_predictions`, y compris cas hors lot avec `--limit`, ou en échec) ; un fichier modifié depuis le lot est un cas `refused`. `--allow-unverified-run` (anciennes prédictions sans run.json) est la seule échappatoire : le rapport porte `run: {verified: false, reason}` et un avertissement. Le défaut sûr n'est pas affaibli : les tests existants de `evaluate.py` passent explicitement l'option. Le rapport gagne `engine` (moteur unique) et `run` ; `compare_reports` liste le moteur dans `context_changes`.
- Hypothèses tranchées : (1) le manifeste peut changer après le lot (annotation humaine = flux normal) : sa nouvelle empreinte est signalée en avertissement, pas refusée, l'audio restant verrouillé par son sha256 ; (2) un lot vide (aucun cas) est refusé (code 2, rien de purgé) plutôt que déclaré `complete` ; (3) un identifiant de cas réservé (`run`, `timings`) ou contenant un chemin est refusé avant toute purge ; (4) un `running` retrouvé après coup (processus tué, SIGKILL) est traité comme non terminé ; (5) `peak_rss_mb` devient `process_peak_rss_mb` et la docstring dit « pic cumulé du processus, non attribuable à un cas » plutôt que de mesurer par cas (impossible proprement dans un processus unique).
- Droits : `mkstemp` crée en 0600 ; `write_text_atomic` ramène les fichiers à `0666 & ~umask` pour que les sorties restent lisibles comme avant (sinon régression silencieuse pour un volume partagé). Limite connue : un SIGKILL entre `mkstemp` et `os.replace` peut laisser un `<id>.json.*.tmp`, que le lot suivant ne supprime pas (« jamais d'autres fichiers ») mais qui n'est jamais lu (`.tmp` ≠ `<id>.json`).
- Phase B (hors de cette PR) : relancer la reconnaissance réelle avec ce protocole et actualiser le rapport chiffré de `docs/evaluation/rapport-reel-2026-10-09.md` ; ses chiffres actuels viennent de dossiers sans `run.json`.

## 2026-10-09 — Corpus de référence (#40) : reconstruction figée, une source un jeu, trace
- **Reconstruction** : les affectations du manifeste existant (`dev`, `test`, `quarantaine`) sont reprises avant tout
  calcul (`frozen_splits`, `assign_ref_splits(frozen=...)`) ; la voix `mix-<récitant>` suit la quarantaine
  (`voice_key`) même quand tous les anciens cas du récitant sont régénérés. Un dérivé dont le parent est régénéré
  n'est jamais conservé (régénéré, ou retiré et signalé). Le « À reporter sur #40 » de l'entrée Quarantaine est fait :
  `validate_ref_manifest` accepte la quarantaine et signale une voix en quarantaine ET en dev/test.
- **Parole hors cible et sources** : pseudo-récitant dérivé du contenu (`speech-<nature>-<sha256[:12]>`), un cas par
  enregistrement distinct ; un enregistrement source (`speech/`, `specials/`) ne sert qu'à un seul jeu (premier arrivé,
  premier servi). **Conséquence assumée** : avec un seul clip par special, la prière n'existe que d'un côté. Choix fait
  de préférence à des fuites silencieuses ; le remède est de fournir un clip distinct par jeu.
- **Décalage** : `shift_s == pad_s` pour `silence_pad`, 0 sinon ; la validation compare chaque dérivé à son parent
  décalé (vérité, statut, durée à `DataConfig.derived_duration_tolerance_s`).
- **Trace** : `manifest.build.json` à côté du manifeste (aucun chemin local), procédure « Reproduire » dans
  `docs/data-lots/ref-corpus-provenance.md`. Rejeu du constructeur réel (graine 7, 2 par scénario) : manifeste et 130
  audios identiques à l'octet, donc les chiffres calculés sur ce manifeste restent valides.

## 2026-10-09 — Corpus de référence (#40) : relecture indépendante, correctifs et limites connues
- **Corrigé** : (a) la trace ne décrivait que le dernier lancement alors qu'un build incrémental garde les anciens cas
  (`_kept_cases`) : elle porte maintenant `carried_over` (cas, graines, scénarios conservés), un scénario écarté dont des
  cas restent est marqué « conservés d'un lancement précédent » dans `skipped`, et la doc dit que le rejeu n'est exact
  que si `carried_over.cases` vaut 0 (sinon reconstruire dans un dossier et un manifeste vierges) ; (b) identifiants
  dupliqués : `scenarios` dédoublonnés, `validate_ref_manifest` signale id et fichier dupliqués, deux dégradations de même
  étiquette (`snr_db` 20 et 20.0) sont refusées avant toute écriture (`ensure_unique_degradations`) ; (c) `pad_s`
  NaN/infini et `shift_s` non numérique sont des erreurs de schéma, pas des plantages ; (d) le script abandonne
  proprement (« ABANDON », rien d'écrit) sur YAML illisible, `ManifestError` ou `RefCorpusError` ; (e) un dérivé doit aussi
  garder `statut`, `boundaries` et `tolerance_ms` de son parent.
- **Limites connues, non traitées** (assumées, à reprendre si elles gênent) :
  1. Pas de dossier d'attente : l'audio est écrit dans `out_dir` avant la validation finale ; si elle échoue, manifeste et
     trace ne sont pas écrits mais les audios déjà générés restent.
  2. L'audio d'un mixage écarté pour source partagée est effacé sans autre trace que sa ligne dans `skipped` ; l'audio des
     cas retirés (`removed`) n'est pas effacé.
  3. Les réclamations de sources (`claims`) sont indexées par le sha256 du fichier source (à défaut, des échantillons),
     pas par celui des échantillons : deux fichiers distincts qui décodent à l'identique ne sont pas reconnus comme la
     même source (la dédup de la parole hors cible, elle, compare les échantillons).
  4. Les noms de fichiers de `speech/` et `specials/` sont versionnés (`extra.sources[].file`, `manifest.build.json`) : un
     nom qui désignerait une personne serait publié. Nommer ces fichiers de façon anonyme.

## 2026-10-09 — Mode test distant protégé de l'atelier (optionnel)
- Le défaut ne change pas : boucle locale uniquement. `AQR_ALLOWED_HOSTS` (vide par défaut) ajoute des hôtes ; fail-closed : un hôte ajouté n'est accepté que si `AQR_ACCESS_TOKEN` est défini. Dès qu'un jeton est défini il protège aussi le loopback (un tunnel local ne contourne pas la protection).
- Jeton par en-tête (`x-aqr-token`, `Bearer`) ou cookie `HttpOnly`/`SameSite=Strict` signé HMAC `<expiration>.<sig>` obtenu via `/access` ; sans état serveur, TTL `AQR_ACCESS_TTL_S` (3600 s par défaut). Comparaison à temps constant (HMAC des deux côtés puis `timingSafeEqual`, donc sans fuite de longueur). Pas de limitation de débit : jeton long exigé par la doc, reverse proxy pour l'exposition réelle.
- `AQR_REVIEW_DIR` par défaut : `AppData\Local` seulement sous Windows, XDG sinon (jusqu'ici un chemin Windows était créé sous `$HOME` sur Linux). La racine est lue à chaque appel (testable) ; les identifiants de session sont des UUID stricts (l'ancien motif `[a-f0-9-]{36}` laissait passer des chaînes non UUID).
- Plafond d'upload : rejet `413` dès `Content-Length` avant de lire le corps multipart. Nettoyage : `AQR_SESSION_TTL_S` (0 = désactivé, comportement historique « rien n'est supprimé automatiquement ») appliqué à l'import, plus `DELETE /api/sessions/<id>` ; une session en cours n'est jamais supprimée.
- `lib/jobs.ts`, `lib/store.ts` et `lib/local-request.ts` n'avaient aucun test : tests vitest ajoutés (jobs via un faux interpréteur exécutable, store dans un dossier temporaire). Les tests de `jobs` caractérisent le comportement existant (verts d'emblée).

## 2026-10-09 — Expiration des sessions de l'atelier : la revue compte comme activité
- Constat (vérifié sur cdc5103 puis avec `next start`) : `cleanupSessions` ne lisait que le mtime de `session.json`, or `PUT /api/sessions/<id>/review` n'écrit que `review.json` et `revisions/`. Avec `AQR_SESSION_TTL_S`, une session ancienne mais revue à l'instant était supprimée, historique de révisions compris, au prochain import.
- **Hypothèse énoncée** : une session revue n'expire qu'après un TTL d'**inactivité** compté depuis la dernière activité de revue, pas depuis l'import ou la fin du traitement. Le TTL est un réglage explicite de l'opérateur : une revue elle-même inactive depuis plus de N secondes expire donc aussi (annotations comprises) ; `DELETE` manuel est plus prudent que la purge (voir plus bas).
- Règle (`lastActivityMs`) : maximum du mtime de tous les fichiers et dossiers de la session (récursif, sans suivre les liens), de `review.updated_at` et de `finished_at`. Les dates internes situées dans le futur sont ignorées (horloge fausse ou restauration : sinon une session serait immortelle) ; le mtime, lui, reste celui du système de fichiers. Les `exports/*.zip` comptent : télécharger un pack est une activité. La suppression étant celle du dossier entier, une revue récente protège aussi `revisions/`.
- Sécurité des suppressions : toute erreur de lecture, JSON corrompu ou dossier sans `session.json` laisse la session intacte (comportement existant conservé). L'activité est relue juste avant `rm` (course avec un PUT) ; une fenêtre de quelques ms subsiste faute de verrou, acceptée pour un serveur local mono-utilisateur. Un fichier renommé pendant le parcours (`.tmp` d'une écriture atomique) est ignoré.
- `deleteSession(id, {force})` refuse (409 côté route, `?force=1` pour passer outre) une session qui porte un travail de revue : au moins une annotation, une révision, ou une `review.json` illisible (on ne peut pas prouver qu'elle est vide). Une session en cours reste refusée même avec `force`. L'interface n'appelle pas cette route. Défaut inchangé : `AQR_SESSION_TTL_S=0` désactive toute purge automatique.

## 2026-10-09 — Fin de traitement : un seul rédacteur de l'issue pour les jobs de ce serveur
- Constat (reproduit : 2 échecs sur 30 exécutions de `jobs.test.ts`, 11 sur 30 sous charge CPU ; test déterministe avec un petit-enfant qui garde stdout ouvert) : entre la mort du processus (`exit`) et le gestionnaire `close` de `jobs.ts`, tout `readSession` (poll de l'interface, test) sondait `process.kill(pid, 0)`, voyait le processus mort et consignait `failed` avec le message générique « s'est arrêté avant de produire un résultat ». Le gestionnaire `close` écrasait ensuite le message, mais le lecteur avait déjà vu le générique et perdu le dernier message du moteur (modèle ou corpus introuvable). Défaut de code existant (sonde de `store.ts` et `jobs.ts` hérités de #32), pas introduit par #37 ; seul `jobs.test.ts` est nouveau.
- Décision : la table des jobs vit dans `store.ts` (`jobs`) et `readSession` ne sonde plus un processus que ce serveur possède ; le gestionnaire `close` consigne l'issue, puis libère le job (`finally`, avec contrôle d'identité du processus) et résout `settled`. La sonde reste pour les sessions orphelines (redémarrage du serveur). `cancel` laisse le gestionnaire `close` libérer le job.
- Limite acceptée : si un petit-enfant garde les tubes ouverts après la mort du moteur, `close` tarde et la session reste `running` jusqu'à sa fin (annulation possible), au lieu d'un `failed` générique immédiat.
- Tests : `jobSettled(id)` remplace l'attente par sondage ; `afterEach` attend le gestionnaire `close` (auparavant il pouvait écrire après la suppression du dossier temporaire, dans l'environnement rétabli ou dans la session du test suivant, qui partage le même identifiant).

## 2026-10-09 — Table des jobs : cycle de vie complet (lancement, annulation, suppression)
- Les écouteurs `error`/`close`/`data` du processus sont posés avant tout `await` de `launch` : un interpréteur introuvable (`AQR_PYTHON`) émettait `error` sans écouteur, d'où une exception non interceptée, une session figée en `running` et un job jamais libéré. `close` attend l'écriture initiale « running » pour ne jamais être écrasé par elle. Si cette écriture échoue : processus tué, session `failed` avec le message, job libéré, `settled` résolue, erreur relancée.
- Un job de la table protège sa session : `launch` refuse (synchrone, avant `spawn`) un second lancement ou une relance d'une session annulée dont `close` n'est pas passé ; `deleteSession` attend `settled` avant de supprimer ; `cleanupSessions` saute la session. Le `catch` du gestionnaire `close` est lui-même protégé (session supprimée entre-temps : rien à consigner, pas de rejet non géré). Limite : si un petit-enfant garde les tubes ouverts, `deleteSession` d'une session annulée attend sa fin.
- Hors périmètre, assumé : lire une session n'est pas une activité (seule une écriture retarde la purge) ; un dossier sans `session.json` n'est jamais purgé, et un mtime futur garde la session tant que l'horloge ne l'a pas rattrapé.

## 2026-10-09 — Lot de reconnaissance (PR #41) : suites de la relecture indépendante
- **`--allow-unverified-run` ne couvre que l'ABSENCE de `run.json`** (`RunMissing`). Un `run.json` existant non complet, illisible ou incohérent reste un refus (code 2) même avec le flag. Constat de la relecture : lot A complet puis lot B `--limit 2` interrompu, `evaluate --allow-unverified-run` lisait le `devC` périmé du lot A.
- **`--transcripts` : moteur vérifié.** Une transcription acceptée sur le seul sha256 de l'audio pouvait venir d'un autre moteur. Désormais chaque champ de `transcript.engine` doit être égal à celui du lot ; un bloc partiel (ASR seul) est accepté, un bloc vide est refusé (non vérifiable) ; sinon code 2, rien d'écrit. Hypothèse : aucun producteur de `aqr.transcript/1` n'existe encore dans le dépôt, la convention est donc fixée ici (`engine.asr` = celui du lot).
- **Verrou de dossier** : `fcntl.flock` non bloquant sur `<out-dir>/.lock`, pris avant la purge, tenu pendant tout le lot, libéré en sortie (fermeture du descripteur, y compris sur exception ou Ctrl-C) ; code 2 avec message si déjà pris. Le fichier `.lock` n'est jamais supprimé (supprimer un fichier de verrou ouvre une course). Unix seulement, comme `resource` déjà utilisé.
- **`compare_reports`** liste aussi `git du lot` (`run.git`, le code qui a produit les prédictions) et `options du lot` (`run.options`) ; `git` reste le checkout qui lance l'évaluation. Les deux sont distincts et documentés dans `docs/EVALUATION-METRICS.md`. Le bloc `run` du rapport gagne `options` et perd `failed` (un lot `complete` n'en a pas).
- **`parse_run` refuse un `run.json` incohérent** : `done`/`failed` hors de `planned`, cas à la fois réussi et en échec, `complete` avec des `failed` ou avec des cas planifiés absents de `done`. Choix : ajouter la troisième condition (tous les planifiés dans `done`) car « complete = tous les cas du lot ont réussi ».
- **SIGTERM** est converti en `KeyboardInterrupt` pendant le lot (thread principal seulement, handler d'origine restauré) : statut `interrupted`, `timings.json` écrit. SIGKILL reste `running`. **Purge** : si une cible (`run.json`, `timings.json`, `<id>.json`) est un dossier, rien n'est supprimé et le script répond code 2 avec un message clair, sans traceback.
- Tests renforcés : `umask` 022/077/002/000 (le `0o644` en dur ne passe plus), échec de l'écriture finale de `run.json` (code 1, statut `running`, `evaluate` refuse), purge explicite de `run.json` et `timings.json` avant le premier cas. Pas de `fsync` (consigne de relecture : l'atomicité du remplacement suffit pour ce besoin).

## 2026-10-09 — Smokes de bout en bout (CLI + navigateur)
- Audio court non versionné : les versets 112:1 à 112:4 (Alafasy, EveryAyah) sont téléchargés par `scripts/fetch_everyayah.py` dans `$AQR_AUDIO_DIR` puis concaténés par ffmpeg en dossier temporaire (marqueur `slow`, hors suite par défaut).
- Restitution contrôlée contre le corpus, pas seulement « non vide » : `tests/support/corpus_check.py` (`assert_matches_corpus`, partagée par le smoke CLI et, via `python -m`, par le smoke navigateur) reprend la sémantique de `HomeRenderer.span_text` : verset entier => texte égal à `repo.text(ref)` ; partiel => sous-chaîne exacte, celle des mots `first..last` ; `1 <= first <= last <= len(words)` ; drapeau `partial` cohérent ; sourate attendue seulement (I3) ; `UNCERTAIN` sans texte ni traduction ; succès = au moins un `RECOGNIZED` (un `INFERRED` est contrôlé mais ne prouve rien, I5). Le texte Tanzil de 112:1 contient la basmala (8 mots) : sur l'audio réel, sans basmala, 112:1 sort `RECOGNIZED` en mots 5..8, partiel, et c'est ce que le contrôle accepte (112:2 `INFERRED`, 112:3 et 112:4 `RECOGNIZED`). L'audio récite 112:1 à 112:4 en entier : `complete=True` exige que chaque verset nommé aille jusqu'à son dernier mot et que 112:2 à 112:4 commencent au mot 1 (112:1 : mot 1 ou 5, la basmala Tanzil de 4 mots pouvant manquer ; mesuré : 5..8 sur 8). Les comparaisons de texte sont exactes (une voyelle changée, fatha→kasra, ou un texte renormalisé NFD/NFKD est refusé). Pas de taux ni de seuil dans le test : c'est un smoke de câblage, pas un benchmark.
- Un smoke sauté n'est pas un succès. Le mode strict est le DÉFAUT partout (`pytest -m slow tests/e2e`, `npm run smoke:browser`, `scripts/smoke_e2e.sh` ; variable absente, vide ou inconnue = strict) : toute ressource absente (audio, ffmpeg, `AQR_MODELS_DIR` et ses fichiers selon `models/LOCK.json` en présence et taille, corpus vérifié par `LOCK.json` en sha256, Chromium, build Next, Python) fait échouer avec sa raison (pytest : erreur ; navigateur : code 2). Seul `AQR_SMOKE_STRICT=0|false|no|off`, posé explicitement, autorise le skip, qui sort avec le résumé « NON EXÉCUTÉ » (limité aux tests de `tests/e2e/` : un `pytest` ordinaire n'affiche rien à tort). La relecture avait relevé que le défaut non strict hors du wrapper reproduisait le bug d'origine (code 0 sans rien exécuter), et que les tests l'entérinaient. `smoke_e2e.sh` refuse toute étape autre que `all|cli|browser` (code 2). Les contrôles de ressources vivent à un seul endroit (`tests/support/smoke_env.py`, interrogé en JSON par le smoke navigateur) ; la décision strict/skip et le verdict de session sont de la logique pure côté Node, testée par vitest (`web/e2e/smoke-support.test.mjs`). Une session `failed`/`cancelled` fait échouer le smoke navigateur aussitôt, avec `session.error`, au lieu d'attendre 900 s.
- Le smoke navigateur utilise `playwright-core` (devDependency exacte) avec Chromium déjà présent (`executablePath`) : ni `playwright install`, ni runner supplémentaire. Il vise l'UI réelle, sans mock : il clique chaque segment RECOGNIZED (jamais un segment incertain), compare le badge « Reconnu » et l'arabe affiché à `interval.text` de l'API, puis ce texte au corpus. Il ne dépend que de `POST /api/sessions` et `GET /api/sessions/<id>`.
- Pack ZIP : tester « PK » et des sous-chaînes brutes ne prouvait rien (le manifeste est `ZIP_STORED`, ses mots sont lisibles même sans entrée). `scripts/verify_review_bundle.py` ouvre l'archive : entrées attendues, chaque clé de `files` présente et chaque entrée listée, SHA-256 recalculés, audio = `audio_sha256` = `files[...]` = `source.sha256` de la prédiction = fichier de référence indépendant, `prediction_sha256` et `engine` cohérents. `export_review_bundle.py` expose ses constantes d'entrées et ses helpers sha256. La vérification est à mémoire bornée : manifeste <= 1 Mio, entrées JSON <= 64 Mio (taille annoncée puis réellement décompressée), audio haché par blocs ; `MemoryError`, `NotImplementedError`, `zlib.error`, `BadZipFile` et les archives chiffrées deviennent des `ValueError` ; le smoke navigateur exige aussi que le `session_id` du manifeste soit celui de la session testée.
- `web/package-lock.json` régénéré depuis celui de develop avec npm 11 : seul `playwright-core` s'ajoute (npm 10.9 supprimait les champs `libc` des binaires optionnels).
- `AQR_PYTHON` est l'interpréteur du moteur (par ex. le venv FastConformer, sans pytest) : le smoke navigateur lui fait lancer `smoke_env`, `corpus_check` et `verify_review_bundle`, donc ces modules n'importent pas `pytest` au chargement. Vérifié avec `AQR_ASR=fastconformer` sous le venv NeMo.
- Limites connues (assumées pour un smoke, pas un benchmark) : le smoke pytest ne couvre que Whisper (le smoke navigateur suit `AQR_ASR`, FastConformer vérifié) ; aucun plancher de rappel au-delà d'un verset RECOGNIZED ; les modèles sont contrôlés en présence et taille (leur SHA-256 est vérifié par le moteur au chargement) ; le chemin Chromium par défaut est celui de cet environnement (`AQR_SMOKE_CHROMIUM` sinon) ; le nombre d'entrées d'un ZIP n'est pas plafonné ; les smokes chargent les vrais modèles (plusieurs minutes sur CPU) et ne tournent donc pas dans la CI par défaut.

## 2026-10-09 — Phase B de la PR #41 : relance réelle du dev, test non relu
- **Exécution** : `develop` @ `e8c8c74` fusionné (SHA testé `cf3196f`, arbre propre), deux lots `recognize_batch.py` successifs sur le split `dev` (82 cas chacun, FastConformer puis Whisper, dossiers distincts `/root/aqr-ref/out2/dev-fc` et `dev-wh`), tous deux `complete` (82 / 82 / 0, code 0), `evaluate.py` sans `--allow-unverified-run` : `run.verified: true`. Durées mesurées 658 s et 1 054 s ; facteur temps réel 0,375 et 0,601. Résultats : 122 / 117 versets reconnus, 0 faux verset, rappel 52,6 % / 50,4 %.
- **Identiques à l'ancien run dev** : engine, decoder, windows et tous les intervalles des 82 cas, pour les deux moteurs ; seuls les temps diffèrent (cause non établie, mesure unique). Le pipeline de reconnaissance est identique à `develop` @ `1a79e20` (`git diff 1a79e20 HEAD -- src/aqr/pipeline matching decoding adapters` vide).
- **Test réservé : aucune relecture des moteurs.** Les anciennes prédictions test (sans `run.json`) sont seulement réévaluées avec `--split test --final --allow-unverified-run`, présentées comme historiques non vérifiées, jamais utilisées pour régler ou choisir un seuil. Une mesure finale vérifiée exigerait une seconde lecture de l'ensemble réservé : laissée en « Décision requise du mainteneur » dans le rapport.
- **Définitions** : seuls les intervalles `recognized` comptent dans le rappel, « sourate », « verset exact » et « plage exacte ». Relecture de `identification.py` et `metrics.py` : aucun défaut de code (`inferred`, `uncertain` et abstention n'y valent jamais un point) ; le libellé « (versets nommés + incertains) » du premier rapport était faux et est corrigé. Tests ajoutés (mutation vérifiée : retirer le filtre de statut les fait échouer) ; N de sourate / verset exact (216) ≠ versets de référence (232) car les versets attendus consécutifs identiques sont fusionnés. Inférés et incertains sont affichés dans des lignes séparées.
- **Mesures retenues** : WER/CER non mesurés (aucune transcription brute n'est écrite). Le pic mémoire (`process_peak_rss_mb`) est un pic de PROCESSUS cumulé, étiqueté comme tel, jamais par extrait.
- **Constat hors périmètre** : `evaluate.py` imprime « cas annoté(s) humainement » même pour les cas `origine: mix` (vérité construite, exemptée de l'annotation humaine) ; message inexact, non corrigé ici.

## 2026-10-09 — Smoke e2e : moteur du smoke CLI explicite (`AQR_SMOKE_ASR`)
- Constat : le smoke CLI (`tests/e2e/test_cli_smoke.py`) était codé en dur sur Whisper alors qu'il faut des smokes stricts, CLI et navigateur, avec les deux moteurs. Le navigateur lisait déjà `AQR_ASR`.
- Décision : `AQR_SMOKE_ASR` (`whisper` par défaut | `fastconformer`, insensible à la casse) choisit le moteur ; `tests/support/smoke_env.py` vérifie les modèles de CE moteur (`MODEL_KEYS`) et que l'interpréteur du moteur (`AQR_PYTHON`, sinon celui de pytest) trouve son module (`nemo` / `transformers`, par `find_spec` dans un sous-processus, sans import). Une valeur inconnue est une ressource « asr » manquante nommée : échec en strict, skip annoncé seulement avec `AQR_SMOKE_STRICT=0` ; jamais un repli silencieux sur Whisper. Le test exige aussi que `engine.asr` de la sortie soit celui du moteur demandé (un smoke FastConformer qui aurait tourné sur Whisper échoue).
- Alignement des noms sans casser l'existant : le navigateur lit `AQR_SMOKE_ASR` puis `AQR_ASR` ; `scripts/smoke_e2e.sh` exporte les deux au même moteur et refuse (code 2) deux valeurs qui se contredisent. `AQR_PYTHON` reste l'interpréteur du MOTEUR ; pytest tourne sous `AQR_PYTEST_PYTHON`, sinon `AQR_PYTHON` s'il sait importer pytest, sinon `python` (le venv NeMo n'a pas pytest). Les scripts du dépôt ne sont pas exécutables : `bash scripts/smoke_e2e.sh`.
- Vérifié pour de vrai en strict (CPU, modèles réels, 4 versets de la sourate 112, Alafasy) : FastConformer (`AQR_PYTHON` = venv NeMo, pytest du venv de développement) et Whisper passent ; FastConformer avec un interpréteur sans `nemo` et un moteur inconnu échouent avec la raison. Le smoke NAVIGATEUR n'a pas été relancé ici : `web/node_modules` absent (seule la syntaxe de `browser-smoke.mjs` est vérifiée par `node --check`).

## 2026-10-09 — Rapport réel (PR #41) : corrections de relecture sur l'effectif et les formulations
- **Effectif** : les 232 « versets de référence » du dev sont des ENTRÉES : 29 entrées de 10 clips d'un seul récitant × 8 copies dégradées, soit 20 versets distincts de 5 sourates courtes (1, 108, 110, 111, 114) ; n indépendant ≈ 29. Les bornes de Wilson du rapport supposent l'indépendance : elles sont indicatives et trop optimistes ; « autres sourates et versets longs : non qualifié ». Test historique : 6 clips, 20 entrées, 17 versets distincts.
- **216 ≠ 232** : ce n'est pas « un verset récité deux fois de suite » mais deux entrées consécutives du MÊME verset, fusionnées : 8 cas `arret_waqf` (un verset récité une fois, annoté en deux plages de mots) et 8 cas `repetition` (verset entier puis reprise de ses derniers mots). La cause d'omission `merged` (3 cas `arret_waqf` par moteur) est une prédiction qui couvre les deux plages.
- **Identité du code de reconnaissance** : la preuve par `git diff` couvre aussi `src/aqr/corpus` (le pipeline importe `normalize_arabic`) ; `normalize.py` a changé mais l'ancienne et la nouvelle `normalize_arabic` / `tokenize` donnent 0 écart sur 12 532 lignes et 165 226 mots du corpus, et les intervalles des 82 cas × 2 moteurs sont identiques à l'ancien run.
- **Formulations** : « Fatiha 1:3–1:6 sous le seuil » était fausse pour Whisper (il reconnaît 1:5 en murattal continu) ; remplacée par les abstentions réellement relevées. Durée « abstenue » = (abstention ∪ incertain) ∩ Coran (539,6 s / 546,8 s) ; abstentions seules 522,5 s / 500,4 s. Whisper `times-estimated` : temps de mots estimés au prorata des lettres, prudence en comparaison de localisation. `run.verified: true` n'atteste pas l'absence du flag (sans effet sur un `run.json` complet) : seule la commande citée l'atteste. Le rappel `recognized` plafonne à 224/232 (96,6 %) : les 8 entrées `inferred` sont toutes 111:4, audio remplacé par du bruit. `aqr.eval.run` importe `fcntl` : `evaluate.py` et `recognize_batch.py` sont réservés à Unix.
# 2026-10-13 — Choix du moteur dans l'atelier web

- Le moteur ASR est choisi pour chaque lancement dans l'interface, envoyé à l'API locale, validé avant de créer le processus et inscrit dans la session. Les résultats passés et les audios ne sont pas réécrits.
- FastConformer reste la valeur par défaut ; Whisper est le second choix réel. Muno Streaming a été autorisé sur Hugging Face puis ajouté comme troisième choix avec ONNX Q8, CMVN et tokenizer épinglés ; les poids sont installés hors Git. Aucun repli silencieux ni résultat simulé.
- Le segmenteur de récitation est un composant commun, pas un troisième ASR. Whisper large-v3 est prévu par l'architecture comme vérification généraliste, mais son adapter et ses poids ne sont pas disponibles ; il n'est pas présenté comme un choix de reconnaissance de versets.
- Validation Muno : vrai ONNX Q8, hashes épinglés, contrat du port ASR réel réussi ; sur la sourate 112 complète, 112:3–4 sont reconnus et 112:1–2 restent en abstention (seuil prudent). Aucun résultat n'est inventé. Build/typecheck réussis ; détails et limites du test web Windows dans `.artist/acceptance-playbooks/web-engine-selector.md`.
- Licence NPL-1.1 : usage local sans frais autorisé ; usage à but lucratif interdit. Ne pas déployer Muno dans une offre commerciale sans nouvelle licence.

## 2026-10-19 — Audit et direction A → B → C → D ; brique 1 : alignement forcé (ADR-0006)
- **Audit** : la copie locale avait 74 commits de retard sur `origin/develop` (avance rapide faite).
  Le code de reconnaissance n'a pas changé depuis le 2026-10-06 ; aucune annotation humaine ; rappel
  52,6 % sur EveryAyah (plafond optimiste) alors que l'ASR seul identifie 97–100 % des versets : le
  goulot est la décision, pas le modèle. Recommandation suivie par Cherif : A (vérité terrain
  semi-automatique) → B (décision acoustique) → C (fine-tuning) → D (détecteur non-Coran). Usage
  **non commercial** confirmé : Tadabur (CC BY-NC) et Muno (NPL) admissibles. Plan : `docs/PLAN.md`.
- **Graphie d'alignement mesurée, pas supposée** : sur 216 clips EveryAyah, l'uthmani brut sépare le
  vrai verset des faux dans 79 % des cas ; la meilleure des graphies imla'i `simple` / `simple-clean`
  dans 189/189 hors versets 1. Les 15 échecs restants venaient de la basmala que Tanzil concatène au
  verset 1 (absente des clips) → `recited_span`.
- **Nouveau fichier épinglé** `quran-simple.txt` (imla'i vocalisé, alignement seulement, jamais rendu).
  `fetch_and_lock` épingle une source ajoutée après coup sans toucher aux empreintes existantes, qui
  restent vérifiées (un contenu distant modifié reste refusé).
- **Rattachement imla'i → Uthmani** : positionnel quand les découpages ont le même nombre de mots, sinon
  alignement des lettres normalisées (difflib), monotone, couverture exigée ; vérifié sur les 6 236
  versets. Attention : `simple-clean` contient aussi les marques de pause comme mots (même filtre que
  `TanzilCorpusRepository.words`).
- **Fins de verset** : un CTC émet tôt (−0,5 s médiane) et peut poser un symbole sur le silence (jusqu'à
  4 s). Une prolongation fixe a été essayée et rejetée (dispersion trop large) ; retenu : affinage par
  l'énergie par trame (`CtcLattice.frame_rms`), extension et recul bornés par les voisins. La mesure
  est en partie circulaire (référence énergétique) : sensibilité publiée pour trois références.
- **Défaut `energy_ratio` = 0,10 (provisoire)** : 0,05 colle aux clips studio mais déborde dans les pauses
  réverbérées de la prière lot1-06 ; 0,10 est un compromis mesuré des deux côtés. À régler sur les
  limites validées à l'oreille.
- **Audio réel** (lot1-06, 46–160 s) : bonne déclaration −0,26 par trame, décalée d'un verset −1,47 ;
  21:53 et 21:62 (`inferred` par le moteur) placés ; 21:56 absorbe 100–105 s, vraisemblable reprise non
  déclarée. Rien n'est validé à l'oreille.
- **Environnement** : `aqr.eval.run` importe `fcntl` (Unix) ; sous Windows, `test_eval_run.py` et
  `test_recognize_batch.py` ne se chargent pas et mypy signale `fcntl.flock` : défaut préexistant sur
  `develop`, hors de cette brique, non corrigé ici.

## 2026-10-19 — Étape A : validation à l'oreille dans l'atelier, fichier entier par passages
- **Parcours retenu** : le moteur propose (`aqr plan-alignment`), l'humain déclare ce qui est récité,
  `aqr align --plan` pose les temps (un seul chargement du modèle pour tous les passages), l'humain écoute
  chaque verset puis valide ou exclut, `aqr data import-alignment` écrit les seuls passages validés dans le
  manifeste (fenêtres annotées, `annotation.by: human`). L'atelier enchaîne le tout (panneau 07).
- **Passages ≤ 110 s** (le treillis CTC accepte 120 s d'un tenant), écart ≤ 6 s, marge 1 s ; un `uncertain`
  coupe la proposition (c'est à l'humain de dire ce qui est récité), une formule seule n'est pas un passage.
- **`aqr.alignment/2`** remplace `/1` (fusionné le jour même, aucun consommateur) : `passages[]`, une erreur
  par passage n'arrête pas les autres ; chaque élément porte `kind` (verse | non_quran).
- **Formules déclarables** (`amin`, `takbir`, `istiadha`, `basmala`) : constat sur lot1-06, l'énergie de
  l'« amin » qui suit la Fatiha prolongeait 1:7 jusqu'à 47 s. Lexique unique `FORMULA_TEXTS`
  (`aqr.corpus.alignment_text`), dont la reconnaissance (`aqr.pipeline.formulae`) dérive désormais ses
  formes normalisées (identiques, vérifié). Les formules deviennent des zones `non_quran` du manifeste.
- **Garde-fous de l'import** : fichiers `dev` seulement (test et quarantaine refusés), relecteur =
  identifiant anonyme (regex, un nom avec espace ou majuscules est refusé), revalidation = remplacement de
  ce qui est dans la fenêtre, préannotation modèle remplacée, jamais fusionnée.
- **Essai réel** (build de production, lot1-06 complet, dossiers temporaires, manifeste du dépôt intact) :
  34 passages proposés et alignés en ≈ 2 min, 0 erreur, preuve médiane −0,31 ; garde-fou « colle mal »
  vérifié (−2,42) ; écriture + lecture par `aqr.eval` vérifiées. Playbook :
  `.artist/acceptance-playbooks/validation-verite-terrain.md`.
- **Encodage** : sous Windows, Python écrivait ses erreurs en cp1252, illisibles dans l'atelier (« � ») :
  `PYTHONIOENCODING=utf-8` et `PYTHONUTF8=1` forcés pour tout lancement du moteur (`web/lib/python.ts`,
  partagé avec `jobs.ts`).
- **Constats d'environnement, non corrigés ici** : `next dev` recharge en boucle dans le navigateur intégré
  (page jamais hydratée ; `next build && next start` fonctionne) ; le lien nvm `C:\nvm4w\nodejs` a disparu
  (Node 22 et 24 installés mais aucun actif : `nvm use 24` le rétablit) ; `jobs.test.ts` échoue sous Windows
  (`spawn EFTYPE`, faux Python à shebang), identique sur `develop`.

## 2026-10-19 — Étape B, brique 1 : preuve cumulée par la suite (ADR-0007)
- **Déclencheur** : Cherif récite au micro la basmala puis 55:1-4 et teste les trois moteurs : aucun
  verset nommé. Diagnostic : transcriptions justes, bon verset en tête dans chaque fenêtre, mais 2 mots
  par fenêtre = score plafonné à 0,40 (`evidence_words` = 5) < 0,75, et le pipeline décidait
  l'abstention fenêtre par fenêtre, avant tout contexte.
- **Décision** : le matcher expose qualité et mots expliqués ; `promote_chains` promeut les maillons
  d'une suite continue du Mushaf (fenêtres consécutives, qualité ≥ 0,75, ≥ 5 mots cumulés, ≥ 2 fenêtres) ;
  l'abstention `below_threshold` est décidée après. Seuil et décodeur inchangés ; `ChainConfig(enabled=False)`
  rend l'ancien comportement ; `decoder.chain_evidence_words` tracé dans chaque sortie.
- **Mesures** (`docs/evaluation/chain-proof-2026-10-19.md`) : micro 55:1-4 reconnus avec FastConformer et
  Whisper ; EveryAyah 71,8 % → 91,2 % de rappel, 0 faux verset ; assises dev : nouveaux versets = vraies
  citations relues (22:5, 17:85) ou récitation d'Al-Qiyama ; prière : 21:53 passe d'`inferred` à reconnu.
- **Reste** : Muno ampute le début des fenêtres (« لَّمَ » pour « عَلَّمَ ») et casse la suite : la
  vérification acoustique CTC de la suite (brique suivante) doit rattraper ce cas.

## 2026-10-20 — Étape B, brique 2 : vérification acoustique des suites et temps au mot (ADR-0008)
- **Déclencheur** : après ADR-0007, Muno ne reconnaît toujours pas 55:1-4 au micro sur 2 enregistrements
  sur 3 (« لَّمَ » pour « عَلَّمَ », qualité 0,5, la suite se coupe) ; et une suite textuellement parfaite
  était promue sans consulter l'audio (homonymes 23:52-53 / 21:92-93).
- **Décision** : `find_chains` (meilleure suite par candidat, à un plancher de qualité) et `chain_spans`
  (texte du corpus de la suite, mots perdus aux bords compris) ; `AcousticVerifier` aligne ce texte sur le
  treillis du FastConformer : acceptée (llr ≥ −1,0) -> maillons promus avec mots et temps de l'alignement ;
  refusée -> aucun maillon promu. Suites candidates au plancher 0,5 (sauvetage) ET au plancher du texte
  (une suite longue refusée ne condamne pas la suite courte). Le maillon sauvé reçoit le seuil du décodeur,
  pas plus. `Candidate.times` porte les temps mesurés, le décodeur les prend ; temps d'un maillon bornés à
  sa fenêtre. FastConformer comme modèle acoustique quel que soit l'ASR ; absent -> avertissement et
  ADR-0007 seul ; `--no-acoustic-check`. Trace dans la sortie : `engine.acoustic`, `acoustic_checks`.
- **Bug trouvé en mesurant** : NeMo laisse l'encodeur en mode entraînement après `transcribe()`
  (`encoder.unfreeze()`) ; un treillis calculé ensuite sur le même modèle tournait avec dropout et mettait à
  jour la BatchNorm (lot1-01 : 68 reconnus -> 5 après 30 treillis). `model.eval()` avant chaque treillis,
  contrat sur le vrai modèle. Les premières mesures (avant correctif) sont jetées.
- **Mesures** (`docs/evaluation/acoustic-check-2026-10-20.md`) : micro Muno 1/3 -> 3/3 ; EveryAyah 91,2 % ->
  96,8 %, 0 faux ; débuts 63 -> 21 ms (médiane), fins 64 ms en avance en moyenne ; lot1-01 68 -> 82,
  lot1-06 272 -> 276, ajouts relus cohérents ; 7 suites homonymes refusées sur l'audio réel.
- **Limite assumée** : un seuil absolu ne sépare pas les quasi-homonymes (23:78-79 sur 67:23-24 accepté à
  −0,15/−0,85, une vraie prière réverbérée à −1,003) ; le décodeur tranche par le contexte. Prochaine
  brique : preuve relative entre suites concurrentes sur les mêmes fenêtres.

## 2026-10-20 — Suite d'un verset commencé, prédite puis vérifiée (ADR-0008 § 6-8)
- **Demande de Cherif** (transmise par la session d'audit) : un verset commencé est toujours récité jusqu'au
  bout (pause pour respirer, reprise possible) ; 81 cas dev où le début est reconnu et la suite abstenue.
- **Décision** : après un candidat retenu qui s'arrête avant la fin de son verset, le reste du verset (départ
  jusqu'à 3 mots plus tôt, puis le verset suivant) est aligné à fin libre sur la fenêtre suivante, si rien n'y
  est retenu et si ce n'est pas une formule. Nommé seulement avec **deux témoins** : preuve acoustique ≥ −1,0
  ET similarité de Dice ≥ 0,6 avec la transcription de la fenêtre.
- **Pourquoi deux témoins** : mesuré sur lot1-04/01, l'audio seul acceptait un mot de fin de verset sur de la
  parole non coranique (rendue surtout en blancs par le modèle) ; normaliser par les trames de parole ne
  séparait pas vrai et faux ; le texte de l'ASR, si.
- **Mesure** : cas résolus 34 → 47 (suites) → 57 / 81 ; 25 suites acceptées, toutes conformes ; EveryAyah
  96,8 %, 0 faux, inchangé.

## 2026-10-19 — Jeu de fine-tuning de l'ASR (étape C) : sources, exclusions, manifestes
- **Périmètre** : préparation des données seulement (`scripts/build_finetune_manifest.py`,
  `src/aqr/data/finetune*.py`, `data/finetune/LOCK.json`) ; aucun entraînement. Détail, volumes et
  preuve : `docs/evaluation/finetune-data.md`.
- **Tadabur officiel = `FaisaI/tadabur`** (page du projet de l'auteur) ; `MShakir7137/tadabur` est une
  copie, non utilisée. Licence des données CC BY-NC 4.0 (celle de l'article arXiv, CC BY-NC-SA, ne les
  couvre pas). Riwaya non documentée : risque ouvert.
- **Sourates de Tadabur numérotées à partir de 0** : constat mesuré (449/450 versets conformes au corpus
  en base 0, 0/450 en base 1), non documenté par la source.
- **Texte cible coranique = corpus `simple`**, jamais la source ; la source sert de contrôle (un écart
  écarte la ligne) et décide de la basmala du verset 1.
- **Arabe non coranique** : Common Voice officiel n'est plus distribué que par Mozilla Data Collective
  (compte + conditions) : miroir CC0 `fsicoli/common_voice_17_0`, épinglé, signalé comme non officiel ;
  plus FLEURS `ar_eg` (CC BY 4.0, officiel). **19,6 % des phrases dev de Common Voice sont des versets**
  lus : filtre « 4 mots consécutifs d'un verset ou verset court entier » (`quran_ngram`), contrôlé à
  l'œil sur un échantillon. Chiffres et lettres étrangères : phrase écartée (pas de verbalisation
  inventée). Jeux `test` réservés à l'étape D.
- **Exclusions de voix** : voix test ET dev du dépôt (corpus de référence et lot 1), identifiants
  Tadabur seuls (aucun nom pour le lot 1, anonymisé) ; correspondance du lot 1 par les titres publics
  des vidéos, partielle (un imam dev et les orateurs non résolus). Choix d'exclure aussi dev : 2 voix sur
  618, pour que la comparaison de l'étape C sur dev reste propre.
- **EveryAyah et le lot 1 retirés de C** (le PLAN les citait) : la décision d'usage provisoire interdit
  d'entraîner sur ces audios ; à rouvrir seulement par décision écrite du mainteneur.
- **Durée extraite 0,5–60 s** (97,7 % des heures Tadabur ; 30 s n'en garderait que 82 %) : la borne
  d'entraînement se règle dans NeMo. Chemins audio relatifs au manifeste (portables Windows/WSL).
- **Épinglage sans téléchargement** des 385 shards (empreinte LFS = sha256 du contenu), vérification
  locale au téléchargement et avant chaque construction ; `fetch_checked` extrait de
  `aqr.models.sync` (réutilisé), `HfHub(repo_type="dataset")`.
- **Disque** : Tadabur complet = 937 Go bruts, ~160 Go extraits ; construction par shard avec
  `--prune-raw`. Le poste a 91 Go libres : jeu complet = disque dédié ou sous-ensemble.

## 2026-10-19 — Étape C : contrôle des étiquettes du jeu de fine-tuning avant l'entraînement
- **Score = preuve `llr_per_frame` (ADR-0005) de l'aligneur de l'ADR-0006, réutilisé tel quel**, sur
  tout le WAV, contre le texte de l'étiquette retrouvé dans le corpus (`aqr_ref`, avec ou sans
  basmala) ; une étiquette qui ne correspond pas au corpus n'est pas notée. Plutôt qu'une perte CTC
  (somme sur tous les chemins), le meilleur chemin contraint comparé au chemin libre : même mesure
  que l'alignement et la porte acoustique, normalisée par trame, sans dépendance à NeMo.
- **Basmala : hypothèse inverse notée** pour chaque verset 1 ; nécessaire, car une basmala récitée et
  non annoncée laisse le score au-dessus du seuil (−0,23 à −0,42 sur 3 voix témoins).
- **`<unk>` retiré du texte aligné, compté** : l'alif suscrit (U+0670) et le tatweel (U+0640) de la
  graphie `simple` n'existent pas pour le tokenizer ; les exiger notait faux des étiquettes justes
  (première passe). L'aligneur ne change pas : c'est l'encodeur passé qui filtre
  (`FastConformerQuranASR.unknown_symbol`, ajout). Constat reporté, non corrigé ici : 32 % des cibles
  d'entraînement du shard 384 contiennent un `<unk>`, et l'alignement/la porte paient la même
  pénalité.
- **Seuil −0,45, marge basmala 0,02** (`LabelQcConfig`), calibrés sur le shard 384 en décrivant les
  69 exemples sous −0,3 (transcription libre du modèle, pas d'écoute) : 34 écartés (7,9 %), dont 19
  étiquettes fausses visibles (14 débordements sur un verset voisin, 3 troncatures, 1 répétition,
  1 lecture autre que Hafs probable en 6:96). La précision des étiquettes prime sur le volume.
- **Score et filtre séparés** : `score` (lent, reprenable, refuse de mêler deux modèles/corpus) et
  `filter` (instantané, relançable pour essayer un seuil) ; le manifeste filtré reprend les lignes
  d'origine à l'identique, à côté des originaux (chemins audio inchangés). Liste d'écoute M3U des
  écartés pour la validation à l'oreille.
- Témoin positif de la basmala construit avec EveryAyah **en mesure seule** (scratch, hors dépôt et
  hors manifeste) : n'enfreint pas l'interdiction d'entraîner sur EveryAyah.

## 2026-10-20 — Étape C : cible d'entraînement dans la graphie du modèle (sans `<unk>`)
- **Mesure** : sur les 78 248 mots du corpus `simple`, l'alif suscrit (U+0670) et le tatweel (U+0640)
  sont les deux seuls caractères que le tokenizer du FastConformer code `<unk>` ; sans eux, aucun mot.
- **Décision** : les retirer de toute cible (`FinetuneConfig.target_drop_chars`, `model_graphie`),
  récitation et non-Coran, plutôt qu'étendre le tokenizer : le modèle écrit déjà cette graphie
  (« ذَلِكَ », « فَهَدَى »), et changer son vocabulaire réinitialiserait sa tête CTC. Le texte
  rendu, lui, vient toujours du corpus Uthmani (I1) : la cible d'entraînement n'est jamais affichée.
- Le contrôle des étiquettes reconnaît une étiquette dans cette graphie (même règle des deux côtés),
  compte les `<unk>` dans l'étiquette réelle, et renote une ligne dont le texte a changé (clé de
  reprise = chemin audio + texte). Échantillon reconstruit et renoté : 0 `<unk>`, 399/433 gardés.

## 2026-10-20 — Étape C : le contrôle des étiquettes compare ce que le modèle entend
- **Déclencheur** : test sur la voix de Cherif au micro (55:3 juste écarté à −1,0) et sur le shard
  384 (9 étiquettes justes écartées, 4:161 et 21:66 fausses gardées). Cause : la convention de
  voyelles de Tanzil (soukoun d'un noun assimilé non écrit) coûte cher au score par trame sur un
  verset court, et un mot de trop pèse peu sur un verset long.
- **Décision** : le même treillis donne le chemin CTC libre ; comparé à l'étiquette sur les lettres
  seules, il nomme le débordement, la répétition et la troncature (≥ 2 mots, `edge_words`, mesuré :
  les étiquettes justes en ont au plus 1) quel que soit le score, et il sauve une étiquette sous le
  seuil quand le modèle entend exactement ses lettres. Pas de second passage du modèle.
- **Bords mesurés depuis leur côté** (la fin à rebours) : sur une prise micro, « الرحمن » répété dans
  le passage créait une fausse troncature. Bords ignorés si moins de la moitié des mots de
  l'étiquette est entendue (autre verset : seul le score décide).
- **Résultat** : shard 384, 405 gardés, 28 écartés tous nommés ; voix au micro, 51/51 cas justes
  (étiquette juste, mauvais verset, débordement, répétition, troncature, basmala dans les deux sens).
- Adaptateur : `FastConformerQuranASR.symbols_text` (symboles → texte du tokenizer), ajout ; aligneur
  et décodage inchangés.


## 2026-10-20 — Matcher : `top_k` ne coupe jamais une égalité de score
- **Constat** (lot 2, lot2-04, Al-Mulk en studio) : « ويقولون متى هذا الوعد إن كنتم صادقين » est le texte
  exact de 6 versets ; avec `top_k = 5` dans l'ordre du Mushaf, 67:25 sortait de la liste et le décodeur,
  encadré par 67:24 et 67:26, rendait 10:48 `uncertain`. Même risque pour le refrain d'Ar-Rahman (31 fois).
- **Décision** : `_rank` continue au-delà de `top_k` tant que le score égale celui du dernier candidat
  gardé ; les sosies exacts restent tous candidats, le contexte (B7, suites ADR-0007/0008) tranche.
- **Vérifié** : tests (6 sosies, 31 refrains) ; audio réel lot2-04 : 67:24 → 67:25 → 67:26 reconnus, plus de 10:48.

## 2026-10-20 — Lot 2 (voix sénégalaises) : constitution et premiers essais
- **Périmètre** : manifeste `docs/data-lots/lot-2.yaml` (12 fichiers YouTube, 4,96 h), ingestion et
  split ; essais `recognize` FastConformer GPU sur dev ; sonde des abstentions
  (`scripts/probe_abstentions.py`). Rapport : `docs/evaluation/lot2-premiers-essais.md`.
- **Seconde voix wolof ajoutée** : le split place orateur_M (tafsir wolof) en `test`. Plutôt que
  d'ouvrir le test ou de forcer l'affectation, une seconde voix de tafsir wolof (orateur_N) a été
  ajoutée, simulée en `dev` avant téléchargement sans changer aucune autre affectation. orateur_M
  reste la seule voix wolof du jeu test.
- **Identifiant réutilisé** : un intervenant déjà présent au lot 1 garde son identifiant anonyme
  (orateur_C), donc son affectation `dev` figée.
- **Riwaya établie par l'audio** (annonces entendues par l'ASR) : lot2-04 Hafs, lot2-05 Warsh (C15).
  Les autres restent `inconnu` : la sortie d'un ASR entraîné sur Hafs n'est pas une preuve.
- **Licence par lot** : `scripts/audio_lot.py` recopie la `licence` déclarée par le manifeste du lot
  dans les fiches ; sans `licence` (lot 1), le libellé hérité est conservé (rien n'est réécrit).
- **Aucun dépôt hors machine** pour ce lot (pas de dataset Hugging Face) : droits non établis.

## 2026-10-20 — Atelier : le lecteur joue l'audio du moteur (copie d'écoute PCM)
- **Constat** (signalé par le mainteneur, mesuré) : sur un MP3 VBR de 45 min, le navigateur annonçait
  `currentTime = 42:22.515` mais jouait l'audio de 42:30.4 (+7,9 s) ; à 20:00, −10,3 s. Les temps du JSON
  sont ceux du PCM décodé par ffmpeg (`FfmpegAudioExtractor`) : écouter « à l'instant du verset » tombait à
  côté. Second défaut, visuel : dans les pistes, les segments étaient décalés de la colonne des noms (70 px)
  mais pas la tête de lecture, et une largeur minimale de 0,28 % gonflait un segment d'1 s à 7,7 s.
- **Décision** : servir au lecteur une copie d'écoute = même commande ffmpeg que le moteur (`-ac 1 -ar 16000`),
  en WAV PCM 16 bits (positionnement à l'échantillon), avec crêtes pré-calculées pour la forme d'onde.
  Écarté : MP3 CBR (décalage de délai d'encodeur, toujours approximatif), FLAC (positionnement dépendant du
  démultiplexeur), décodage complet côté navigateur (≈ 1 Go pour 45 min stéréo 48 kHz). 16 kHz plutôt que la
  fréquence d'origine : on entend exactement ce que le moteur a entendu, coût disque ≈ 32 ko/s.
- **Repli** : ffmpeg indisponible → l'original est joué, signalé par le badge et un message (jamais silencieux).
- **Vérifié** : corrélation d'enveloppe lecteur/décodage complet aux 4 instants mesurés : écart 0 à −0,05 s
  (contre +7,9 / +2,5 / −10,3 / −2,9 s) ; durée de la copie 2742,6987 s = `source.duration_s` du moteur ;
  tête de lecture et segment sélectionné au même pixel (fichier entier et fenêtre 30 s).

## 2026-10-20 — Arbitrages de Cherif au réveil
1. **Warsh** : « avertissement tout de suite ». Deux signaux mesurés, tous deux négatifs (preuve
   acoustique globale ; ibdâl de la hamza muette Hafs/Warsh aligné sur le treillis) :
   `docs/evaluation/riwaya-2026-10-20.md`. Faute de détection fiable, l'avertissement est permanent et
   honnête : `riwaya: {assumed, verified: false, notice}` dans chaque sortie, affiché par l'atelier.
   La détection de la riwaya reste à faire (données Warsh annotées).
2. **Citations courtes isolées (tafsir)** : un statut à part, mais **après** la validation à l'oreille de
   Cherif sur quelques cas. Rien n'est codé d'ici là ; elles restent écartées (I3).
3. **Droits du lot 2** : usage interne d'évaluation confirmé, jamais redistribué (`docs/data-lots/RIGHTS.md`).

## 2026-10-20 — L'aligneur n'exige plus `<unk>` (alif suscrit, tatweel)
- **Constat** (étape C) : la variante vocalisée de l'aligneur (Tanzil `simple`) demandait `<unk>` pour
  l'alif suscrit et le tatweel ; le modèle ne l'émet jamais. Pénalité sur ~ un verset sur deux, en partie
  masquée parce que l'aligneur garde la meilleure des deux graphies.
- **Décision** : une seule fonction, `alignment.forced.emittable_encoder(model)`, filtre
  `model.unknown_symbol` (ajouté au port `CtcAcousticModel`) ; elle sert `aqr align`, la vérification
  acoustique de `recognize`, `measure_alignment.py` et `LabelScorer` (qui prend désormais le modèle au lieu
  de `encode` + `unknown_symbol`). Lecture paresseuse : le FastConformer dédié n'est chargé qu'au premier
  treillis, comme avant.
- **Mesuré** (mêmes transcriptions, `docs/evaluation/alignment-unk-2026-10-20.md`) : aucune sortie ne
  change (EveryAyah 98,1 %, 0 faux ; micro 55:1-4 avec les trois moteurs ; lot 1 dev 57/81 cas, 617
  versets) ; les vraies suites gagnent jusqu'à +0,96 par trame (micro −0,33/−0,44 → −0,08/−0,13). Suites
  acceptées et refusées du lot 1 se touchaient à −1,0 ; elles sont maintenant séparées de −0,95 à −1,21.
- **Seuils inchangés** (−1,0 ; Dice 0,6) : la correction ouvre une marge autour du seuil sans rien faire
  passer de nouveau à la sortie ; les resserrer attend la vérité terrain de l'étape A.

## 2026-10-20 — Cascade multi-modèles par défaut, choix du moteur retiré de l'atelier (ADR-0009)
- **Contexte** : Cherif trouvait Muno meilleur sur sa voix, FastConformer l'est sur les lots ; il a
  demandé de construire la cascade, de la mesurer contre FastConformer seul et de retirer le choix du
  moteur de l'interface si la mesure est bonne.
- **Décision** : FastConformer partout ; Whisper puis Muno réécoutent seulement les fenêtres douteuses ;
  un candidat secondaire n'est gardé que si l'audio soutient le texte du corpus (arbitre acoustique,
  I3). Défaut de l'atelier (sélecteur supprimé) et de `aqr recognize` ; un moteur seul reste
  disponible pour mesurer (`--asr`, `AQR_ASR`).
- **Mesuré** (split dev, `docs/evaluation/cascade-2026-10-20.md`) : 0 verset perdu, 0 ajouté sur les
  fichiers sans Coran ; EveryAyah 211 → 216/216 ; lot 1 dev +10 versets distincts, lot 2 dev +5, tous
  dans des suites cohérentes. Coût ×2,85 sur les lots (fichiers parlés).
- **Bug corrigé en route** : Muno échouait sur un dernier morceau de moins de 10 trames mel.
- **Ouvert** : réduire le coût (attribuer chaque sauvetage à un moteur et un critère) ; détections d'un
  seul mot (« كلا » → 75:26), déjà produites par FastConformer seul, à trancher avec la vérité terrain.

## 2026-10-22 — La basmala est restituée comme un verset (texte du corpus 1:1 + traduction)
- **Besoin** : l'atelier montrait `[basmala]` seul ; Cherif veut le texte et la traduction, comme pour un verset.
- **Décision** : l'intervalle `non_quran` de label `basmala` porte `basmala: true`, `ref: "1:1"`, `text` (lu dans
  le corpus par `HomeRenderer.render_basmala`, jamais d'un modèle : I1) et `translation` (QuranEnc, id + version
  + attribution : I2). Champs additifs : `aqr.recognition/1` ne change pas, l'ancien format reste lisible
  (lecteur Python, schéma zod). Isti'adha, takbir, amin n'ont pas de texte du Mushaf : seulement un libellé
  arabe constant `label_ar`, clairement distinct d'un texte de verset.
- **Écartés** :
  - *Une nouvelle sorte d'intervalle (`kind: "basmala"`)* : casserait tous les lecteurs (`kind` est
    discriminant) ; un champ additif sur `non_quran` n'en casse aucun.
  - *Faire de la basmala un `verse` 1:1* : la basmala d'une sourate n'est pas une récitation du verset 1:1 d'Al-Fatiha
    (I3/I4 : ne jamais nommer un verset qu'on n'a pas entendu) ; elle reste une zone non coranique, juste
    habillée comme un verset à l'affichage.
  - *Réutiliser `FORMULA_TEXTS` (graphie imla'i de l'alignement) pour `label_ar`* : ces formes servent à aligner ce
    que l'ASR écrit, pas à être montrées ; `aqr.rendering.formula_labels` porte les libellés d'affichage.
  - *Texte de la basmala dans les sous-titres SRT/VTT* : hors besoin exprimé, et l'atelier lit le JSON ; `[basmala]`
    inchangé.
- **Contrôles** : le lecteur Python et le schéma web refusent une zone incohérente (`basmala` hors 1:1, texte
  sur une formule, `label_ar` sur la basmala) ; `tests/support/corpus_check.py` (déjà appelé par les smokes)
  vérifie que le texte de la basmala est exactement `repo.text(1:1)` et que `label_ar` est la constante du label.
- **Mesuré** : cascade réelle sur `test-55.webm` (55:1-4 précédé de la basmala) : intervalle basmala 1,29-4,33 s avec
  texte et traduction ; `corpus_check --surah 55` OK.
- **Passe Cherif QA (22 octobre)** :
  - *Zone basmala issue d'un verset UNCERTAIN/INFERRED* (signalée ❌) : **gardée, par construction**. La basmala est
    aussi le début du verset 1 de chacune des 113 autres sourates : une fenêtre qui ne contient qu'elle est
    toujours ambiguë (UNCERTAIN) ; c'est précisément ce que `_relabel_basmala` rattrape. Restreindre la
    relabellisation aux seuls RECOGNIZED (essayé : `test_basmala_d_ouverture_non_coranique_puis_le_verset`
    échoue) supprimerait la fonction. Le texte montré est celui de la basmala, pas la preuve d'un verset : documenté
    (`ref: "1:1"` hors `kind: "verse"`, à filtrer par les consommateurs, tous le font déjà).
  - *1:1 isolé (001001.mp3) sort en basmala* : règle d'avant (« 1:1 non suivi de 1:2 »), inchangée ; le texte et la
    traduction sont exactement ceux de 1:1, donc justes. Doc et commentaire de `NonQuranKind` corrigés (ils disaient
    « hors Al-Fatiha 1:1 »). Al-Fatiha entière reste en versets.
  - *Hors ligne, traduction de la sourate 1 absente du cache* : `build_json` plantait en trace d'appels après le
    calcul, sans aucun fichier (déjà vrai pour tout verset d'une sourate non cachée ; la basmala ajoute la sourate 1).
    `aqr recognize` écrit maintenant les sous-titres d'abord, puis le JSON dans un `try` : message actionnable, code 1,
    pas de JSON à moitié écrit.
  - Lecteur Python : `basmala` strictement booléen (« false » était lu vrai), `label_ar` non vide, traduction refusée
    hors basmala ; schéma web : mêmes règles. `corpus_check` : provenance de la traduction de la basmala (id,
    version, attribution, `scope: "verse"`, I2 sur la forme).
  - *Écarté* : comparer le contenu de la traduction dans `corpus_check` (le dépôt de traductions n'y est pas
    chargé ; même limite que pour les versets). Noté pour l'interface : la note `[1]` de la traduction.

## 2026-10-22 — Atelier : file d'attente des analyses, vidéos, « non lu », durées et estimation
- **Besoin** (Cherif) : lancer plusieurs analyses (audios et vidéos) et revenir plus tard ; la carte graphique
  n'aime pas le parallèle ; voir ce qui est terminé et pas encore ouvert ; savoir combien de temps ça prend.
- **Décision** : file FIFO côté serveur (`web/lib/queue.ts`, sans dépendance : seul l'ordonnanceur), exécuteur
  `jobs.ts` (un processus Python par analyse, place gardée jusqu'à sa fin), `AQR_MAX_CONCURRENT` (défaut 1). Vues
  calculées à la lecture (`session-view.ts` : position, non lu, estimation) ; rien de calculé n'est écrit sur le disque.
- **Écartés** :
  - *File en mémoire seule* : perdue au redémarrage, sessions `queued` orphelines. *File sur disque à part*
    (`queue.json`) : deux sources de vérité à garder synchrones. Retenu : l'ordre durable est `queued_at` dans
    `session.json` (une écriture atomique par session) ; la file mémoire n'est qu'un ordonnanceur reconstruit au
    démarrage (`instrumentation.ts`, repli à la première requête).
  - *BullMQ / processus ouvrier séparé* : infrastructure sans objet pour un serveur local à un utilisateur.
  - *Facteur temps réel (RTF) médian*, formulation initiale de l'estimation : le chargement des modèles (≈ 50 s
    fixes) rend le RTF dépendant de la durée (3,2 pour 18 s, 0,03 pour 1 h). Validation croisée (leave-one-out) sur les
    33 analyses FastConformer du disque : erreur relative médiane **38 %** (RTF médian) contre **11 %** (durée =
    chargement + coût × audio, Theil–Sen pondérée), p90 28 % ; Muno (7 analyses) 32 % contre 8 %. Whisper (3) et
    cascade (2) : trop peu d'analyses pour être évalués (refusés, pas devinés). Le RTF reste exposé (`/api/stats`,
    médiane, p90, moyenne, min/max) pour que la dispersion se voie.
  - *Estimer avec 1-2 analyses ou en extrapolant* : une droite sur deux points ne dit rien de sa propre erreur, et des
    audios de 3 à 30 s ne disent rien d'un fichier d'une heure. Refus explicite (`insufficient_history`,
    `out_of_range` au-delà de 2× le plus long audio connu) : jamais un chiffre inventé. Coût : tant qu'un moteur n'a
    pas 3 analyses, pas d'estimation (la cascade, par défaut depuis ADR-0009, n'en a que 2 sur le disque).
  - *Vidéo par formulaire multipart* : le corps est lu entièrement en mémoire (2 à 3× la taille). Retenu : envoi en
    flux (en-tête `x-aqr-filename`) écrit directement sur le disque, empreinte au vol ; plafond vidéo distinct
    (`AQR_MAX_VIDEO_UPLOAD_BYTES`, 2 Gio : l'image est conservée alors que seul le son sert). Le multipart reste pour
    l'audio avec résultat joint.
  - *Marquer « vu » au `GET`* : le sondage de la liste effacerait le point. Retenu : `POST …/viewed`, idempotent.
  - *Dater les anciennes sessions à « maintenant »* pour la migration : inventerait une date. Retenu : champ
    `viewed_at` **absent** = lu ; `null` = terminé et jamais ouvert (posé à la fin de chaque analyse).
  - *Ignorer les processus d'un serveur précédent* : après un redémarrage, ils tiennent encore la carte graphique.
    Retenu : ils comptent comme places occupées jusqu'à leur fin (sondés, `process.kill(pid, 0)`).
- **Trouvé en route (corrigé)** : sous Windows, `rename` d'un `session.json` pendant qu'un autre lecteur l'ouvre
  échoue en `EPERM`/`EBUSY` ; la fin d'une analyse pouvait donc être perdue (session « en attente » ou « en cours »
  pour toujours). `atomicJson` réessaie (8 essais) ; test rouge d'abord. Aussi : `POST …/run` sans moteur ignorait
  `AQR_ASR` (cascade forcée) alors que l'import `autorun` le respecte ; les deux passent maintenant par `launch`.
- **Tests d'environnement** : les tests du lancement utilisaient un script à shebang comme faux Python (`spawn
  EFTYPE` sous Windows : 11 échecs hors de la file) ; le faux moteur est maintenant lancé par Node via
  `recognizeCommand` (une seule définition de la ligne de commande du moteur, `python.ts`). Les 19 tests de `jobs`
  passent sous Windows. Restent les 5 échecs de `e2e/smoke-support.test.mjs` (chemins Linux absolus), non liés.
- **Passe Cherif QA (22 octobre)** — trouvé et corrigé, chaque point avec un test rouge d'abord :
  - *Sessions fantômes* : une écriture tardive de `session.json` (fin de processus, `markFailed`, annulation) recréait
    le dossier d'une session supprimée depuis un autre onglet (un `session.json` seul). `saveSession(…, { create:
    false })` pour toute mise à jour ; l'import seul crée.
  - *Suppression bloquée pendant toute l'analyse* : `deleteSession` d'une analyse dont le processus venait de partir
    (état « running » pas encore écrit) attendait la fin du moteur (> 80 s) puis effaçait un résultat. Refus immédiat.
  - *Ordre* : lancements, annulations et suppressions passent par une section sérialisée (FIFO) ; `queued_at` est
    décidé au même endroit que le rang (strictement croissant) ; l'« annulation acquittée mais l'analyse tourne »
    d'une occurrence sur ~25 n'a pas été reproduite (course aléatoire à graine fixe ajoutée), durcie par cet ordre.
  - Durée sondée : la piste audio (étiquette `DURATION` pour Matroska/WebM), pas le conteneur (10,3 s pour 4,6 s de
    son) ; fichier illisible refusé à l'import ; `404` et messages sans chemin local ; corps `/run` illisible refusé ;
    noms (255 caractères, extension seule) ; `analyses` ne compte plus un résultat importé à la main.
  - *Écarté* : refuser à l'import tout audio sans durée. Une capture micro WebM n'en a pas ; un fichier d'octets
    aléatoires que ffprobe croit lire n'échoue qu'à l'analyse (rare, accepté).
  - *Constaté, hors de ce lot* : `isLocalRequest` valide l'hôte de l'URL construite par Next, pas l'en-tête `Host`
    (`Host: evil.example` sur `127.0.0.1` passe en lecture ; les mutations sont couvertes par `Origin`). Risque de
    DNS rebinding pour tout le serveur, antérieur à cette PR : à traiter dans une PR de sécurité à part.
  - *Coût de la sonde* : ffprobe met ≈ 1,8 s par fichier sur cette machine (démarrage du binaire, mesuré hors serveur) ;
    les imports se font donc à ≈ 2 s l'un, indépendamment de la taille.
- **Risque ouvert** : l'estimation dépend de l'historique d'une même machine ; un changement de modèle ou de GPU la
  fausse jusqu'à ce que de nouvelles analyses la rattrapent (la médiane robuste limite l'effet des premières).
  Les durées passées ont parfois été mesurées avec des analyses en parallèle (22:17 le 19 octobre) : trop lentes,
  sans effet sur la droite robuste, visibles dans le p90 du RTF.

## 2026-10-22 — Atelier : redesign « Encre & lapis » (shell, revue humaine v2, Performance)
- **Source de vérité** : `docs/design/*` (validé par Cherif). Aucune valeur visuelle en dur : `web/app/tokens.css`
  est la copie **identique** de `docs/design/tokens.css` (un test le vérifie ; le fichier du design a été passé à
  Prettier pour que les deux restent comparables octet pour octet).
- **Arbitrages de Cherif appliqués** : 5 puces ajoutées conservées ; onglet « Vérité terrain » **seulement** avec
  `?relecteur=1` (il écrit dans le manifeste de test) ; écoute avant confirmation **indicative** ; modifier le
  signalement d'un autre testeur permis avec encart (`updated_by`) ; pseudonyme libre 2–24 caractères, e-mail refusé ;
  raccourcis `M`, `P`, `L` désactivables et inactifs dans un champ ; police arabe KFGQPC Hafs V30.
- **Onde sans wavesurfer** : l'onde est dessinée sur `canvas` à partir des crêtes du serveur, uniquement pour la
  fenêtre visible, dans le **même conteneur défilant** que les trois pistes, la règle et la tête de lecture. Un seul
  repère temporel : plus de synchronisation entre deux échelles (cause du décalage corrigé en #60), les calques de
  signalement (plages, poignées, tracé) sont de simples éléments positionnés en %, sans DOM fantôme. wavesurfer
  n'est plus utilisé par l'interface.
- **Police Hafs V30** : licence « tous droits réservés ». Servie par `GET /api/fonts/kfgqpc-hafs-v30` depuis
  `AQR_FONTS_DIR` (défaut explicite `%LOCALAPPDATA%\aqr-fonts` / `~/.local/share/aqr-fonts`, jamais le dossier de
  revue), liste blanche de noms, **boucle locale seulement** (même avec jeton et hôte autorisé : ce serait de la
  redistribution), jamais dans Git ni `public/` (`.gitignore` + test). Absente : option grisée, repli Amiri Quran.
  L'aperçu du sélecteur n'utilise **pas** de texte du Mushaf codé en dur (I1) : début du passage affiché (corpus) ou
  lettres arabes non coraniques.
- **Formules (isti'adha, takbir, âmîn)** : constantes de `web/lib/formulas.ts`, jamais présentées comme du corpus ou de
  QuranEnc (mention « Formule — hors Mushaf, traduction indicative (non QuranEnc) » sur la carte). **À VALIDER PAR
  CHERIF** : traductions « Je cherche refuge auprès d'Allah contre Satan le banni. », « Allah est le plus grand. »,
  « Exauce-nous. » (indicatives, rédigées par le mainteneur, pas par QuranEnc).
- **Basmala** : l'interface affiche la basmala comme un verset (arabe du corpus + traduction + attribution, badge
  « Basmala », ornement, pas de médaillon) d'après le contrat de `feat/basmala-affichee` (`non_quran`, `basmala: true`,
  `ref: "1:1"`, `text`, `translation`) ; pour un résultat ancien (étiquette seule) elle explique que le texte n'est pas
  dans ce résultat. Les `[n]` des traductions sont mis en exposant **à l'affichage seulement** (chaîne intacte, I2).
- **Deux sources pour isti'adha/takbir/âmîn** : le moteur émet maintenant `label_ar` (libellé arabe constant, sans
  voyelles) ; l'interface affiche ses propres constantes (`lib/formulas.ts`, avec voyelles + traduction française +
  mention hors Mushaf) et **ignore `label_ar`** pour ne pas avoir deux textes qui dérivent. À trancher : garder
  `label_ar` côté moteur (sous-titres, exports) ou le retirer.
- **Revue `aqr.review/2` et écriture multi-testeurs** : un `PUT` qui remplaçait la liste faisait perdre le travail
  quand deux testeurs écrivaient. Désormais le client n'envoie que ses signalements modifiés et ses suppressions
  (`deleted_ids`), le serveur fusionne **par identifiant sous verrou** (dernier `updated_at` gagne, `tester` et
  `created_at` immuables) et renvoie la revue fusionnée. Un numéro de version local par signalement protège une
  modification faite pendant un envoi. Suppression annulable 6 s : réellement envoyée seulement après le délai (ou à
  la fermeture de la page). Lecture v1 rétro-compatible ; `type` historique dérivé du premier tag, donc les exports
  existants (pack ZIP, bilan JSON, `verify_review_bundle.py`) sont inchangés : le pack traite `review.json` comme des
  octets opaques (test Python ajouté avec une revue v2 à deux testeurs).
- **Performance** : tuiles, barres par moteur et tableau calculés côté client sur les sessions terminées de la période
  choisie (7 j · 30 j · tout), car `GET /api/stats` agrège sur tout l'historique ; la file en cours et la précision de
  l'estimation viennent de `GET /api/stats`. Facteur « ×N » = durée de l'audio ÷ durée de l'analyse (deux décimales
  quand l'analyse est plus lente que l'audio : « ×0,02 »).
- **Rafraîchissement** : 3 s onglet visible avec une analyse active, 10 s sinon, 15 s en arrière-plan. Le point
  « non lu » s'efface à l'**ouverture** du résultat (`POST …/viewed`), jamais par le sondage.
- **Cibles tactiles** : tous les boutons font ≥ 44 px au tactile, **sauf** les segments des pistes (quelques pixels à
  l'échelle d'un fichier entier) : ils sont doublés par la liste des intervalles (lignes de 44 px) qui fait la même
  chose. Exception assumée (WCAG 2.5.8, alternative équivalente).

## 2026-10-22 — La basmala est restituée comme un verset (texte du corpus 1:1 + traduction)
- **Besoin** : l'atelier montrait `[basmala]` seul ; Cherif veut le texte et la traduction, comme pour un verset.
- **Décision** : l'intervalle `non_quran` de label `basmala` porte `basmala: true`, `ref: "1:1"`, `text` (lu dans
  le corpus par `HomeRenderer.render_basmala`, jamais d'un modèle : I1) et `translation` (QuranEnc, id + version
  + attribution : I2). Champs additifs : `aqr.recognition/1` ne change pas, l'ancien format reste lisible
  (lecteur Python, schéma zod). Isti'adha, takbir, amin n'ont pas de texte du Mushaf : seulement un libellé
  arabe constant `label_ar`, clairement distinct d'un texte de verset.
- **Écartés** :
  - *Une nouvelle sorte d'intervalle (`kind: "basmala"`)* : casserait tous les lecteurs (`kind` est
    discriminant) ; un champ additif sur `non_quran` n'en casse aucun.
  - *Faire de la basmala un `verse` 1:1* : la basmala d'une sourate n'est pas une récitation du verset 1:1 d'Al-Fatiha
    (I3/I4 : ne jamais nommer un verset qu'on n'a pas entendu) ; elle reste une zone non coranique, juste
    habillée comme un verset à l'affichage.
  - *Réutiliser `FORMULA_TEXTS` (graphie imla'i de l'alignement) pour `label_ar`* : ces formes servent à aligner ce
    que l'ASR écrit, pas à être montrées ; `aqr.rendering.formula_labels` porte les libellés d'affichage.
  - *Texte de la basmala dans les sous-titres SRT/VTT* : hors besoin exprimé, et l'atelier lit le JSON ; `[basmala]`
    inchangé.
- **Contrôles** : le lecteur Python et le schéma web refusent une zone incohérente (`basmala` hors 1:1, texte
  sur une formule, `label_ar` sur la basmala) ; `tests/support/corpus_check.py` (déjà appelé par les smokes)
  vérifie que le texte de la basmala est exactement `repo.text(1:1)` et que `label_ar` est la constante du label.
- **Mesuré** : cascade réelle sur `test-55.webm` (55:1-4 précédé de la basmala) : intervalle basmala 1,29-4,33 s avec
  texte et traduction ; `corpus_check --surah 55` OK.

## 2026-10-22 — Phase 2 « multi-testeurs » : comptes, partage et préférences (socle backend)
- **Besoin** : plusieurs testeurs utilisent l'atelier sur la machine de Cherif, bientôt sur un hébergement : chacun
  son compte, des audios globaux (partagés avec leurs performances) ou privés, des préférences par utilisateur
  côté serveur, une liste de sessions qui passe à l'échelle (curseur, recherche, favoris, archives), des quotas.
- **Décision** : SQLite via `node:sqlite` (Node 24, aucune dépendance native), un fichier `aqr.sqlite` dans le
  dossier de données (`AQR_DB_PATH`), mode WAL, clés étrangères, migrations versionnées immuables
  (`web/db/migrations`). Les fichiers lourds restent sur disque ; `session.json` reste la source de vérité de
  l'état d'une analyse et la base en garde un **miroir** (recopié par un crochet de `saveSession`, motif
  Observer : `store.ts` ne connaît pas la base). Couches : routes (`app/api`) → garde (`route-guard.ts`) →
  autorisations pures (`access.ts`) → services (`session-service.ts`, `auth.ts`) → dépôts SQL (`session-index.ts`,
  `users.ts`, `preferences.ts`). Patterns : Repository (SQL), Observer (crochets de session), Strategy implicite
  (portée → SQL dans `session-query.ts`), Factory (`createLimiters`, `openDatabase`), dépendances injectées pour
  tester sans serveur.
- **Écartés** :
  - *PostgreSQL* : un service de plus à installer, sauvegarder et sécuriser pour quelques testeurs sur une
    machine ; SQLite en WAL tient très largement la charge visée et se déplace avec le dossier de données.
    La couche « dépôts » isole le SQL : un portage reste possible si l'hébergement public l'exige.
  - *JWT sans état* : non révocable (déconnexion, désactivation d'un compte, changement de mot de passe) sans
    liste de révocation, donc un état serveur de toute façon. Jeton opaque de 256 bits, **seul son SHA-256** en
    base : une fuite de la base ne donne aucune connexion.
  - *Argon2 (module natif)* : demande un binaire par plateforme (Windows + Linux) alors que `node:crypto.scrypt`
    est intégré, mémoire-dur, et ses paramètres voyagent dans l'empreinte (`needsRehash` permet de les durcir).
  - *Better-sqlite3 / ORM (Prisma, Drizzle)* : dépendance native ou générateur de code pour ~6 tables ; le SQL
    paramétré direct est court et testé.
  - *Rate-limit en base* : un verrou qui survit au redémarrage ne vaut pas la complexité ici (et un
    redémarrage est un événement visible de l'administrateur) ; limiteurs en mémoire, injectables, testés avec
    une horloge simulée. Limite assumée et documentée.
  - *Archiver par utilisateur* : la spécification place `archived_at` sur la session ; archivé = pour tous.
  - *Administrateur qui voit les privés des autres* : refusé, un privé l'est pour tous (404) ; l'administrateur
    modifie ce qu'il VOIT. Évite qu'un compte « root » lise des enregistrements que leur auteur a protégés.
  - *Renommer automatiquement une session avec son `content_label`* : un nom qui change seul surprend ; le nom
    reste (choisi ou dérivé du fichier), l'étiquette est un champ à part que l'interface montre en sous-titre.
- **Choix** :
  - Premier compte = administrateur, décidé DANS l'instruction d'insertion (atomique). `AQR_SIGNUP=closed` laisse
    quand même créer le tout premier compte (amorçage), sinon une base vide ne pourrait jamais avoir d'administrateur.
  - Un privé est `404` (pas `403`) ; `403` seulement pour « visible mais non modifiable ».
  - « Non lu » par utilisateur : seul le propriétaire d'une session terminée la voit non lue, jusqu'à ce qu'il
    l'ouvre ; une relance redevient non lue (comparaison `viewed_at` ≥ `finished_at`).
  - Signalements : l'auteur est toujours le compte connecté ; un testeur ne modifie ni ne supprime le signalement
    d'un autre (administrateurs exceptés), refus renvoyés dans `rejected`. Plus strict que l'ancien comportement
    (édition libre) pour que l'attribution ne soit pas falsifiable.
  - Vérité terrain réservée aux administrateurs ; le relecteur écrit dans le manifeste est leur pseudonyme.
  - Sessions existantes importées au premier démarrage : sans propriétaire, globales, nom par défaut dérivé du
    nom de fichier (au lieu du nom brut) pour que les horodatages d'enregistreur deviennent lisibles.
  - Journal `analysis_log` séparé : « le nombre de tests » survit à la suppression d'une session.
- **Risques connus** : perdre `aqr.sqlite` rend globales à la réimportation les sessions qui étaient privées
  (sauvegarder la base avec le dossier de données) ; limiteurs en mémoire ; quota vérifié à l'import (deux
  imports simultanés peuvent le dépasser d'un fichier).

## 2026-10-23 — Traduction par passage (fragments), ADR-0012
- **Contexte** : sur un verset partiel, l'arabe montre les mots entendus et la traduction le verset entier (signalé
  par le mainteneur). Contrainte I2 : découper, jamais réécrire ; ADR-0001 : pas de génératif.
- **Décisions prises seul (hypothèses énoncées)** :
  - Algorithme : IBM-1 bidirectionnel + longueur + signes de pause, programmation dynamique, posterior
    avant-arrière, repli par fusion. Choisi sur mesure (pseudo-vérité sourates paires/impaires) et sur lecture
    de 40 versets ; essais abandonnés listés dans `docs/evaluation/traduction-par-passage-2026-10-23.md`.
  - Réglages dans `TranslationAlignmentConfig` (nouveau, à côté d'`AlignmentConfig` qui est celle de l'aligneur
    acoustique CTC : y mêler des seuils de traduction l'aurait pollué).
  - **Tolérance de position d'un mot** déclarée au contrat : exiger la place exacte ne gardait que 27 % des
    frontières ; un mot de liaison peut aller des deux côtés. Mesuré : 90,5 % exactes, 99,4 % à ±1.
  - Seconde chaîne (autre normalisation) obligatoire : elle retire les frontières décalées de 2 mots vues sur
    12:23 et 59:23.
  - `text` reste le verset entier ; `scope: "fragment"` dit d'afficher `fragment.text` (compatibilité).
  - Empreinte de 64 bits (16 hex) par verset : suffisante pour 6 236 textes, fichier de 0,5 Mo.
  - Le basmala préfixé par Tanzil au premier verset de chaque sourate (sauf 1 et 9) est exclu de l'alignement
    mais reste numéroté (le rendu le compte).
- **Écart au cahier des charges** : « 0 frontière fausse dans l'échantillon » non atteint (1 sur 169, une
  inversion d'ordre du français, confiance 0,999 : le seuil ne la retire pas). Non contourné par une règle
  écrite pour ce verset.
- **Risques** : surlignage mot à mot décalé d'un mot à une jonction ; inversion d'ordre rare ; seule
  `french_hameedullah` est découpée.
- **Numérotation** : mon ADR a d'abord pris le numéro 0010 ; develop a fusionné entre-temps l'ADR-0010
  (promotion par le voisin et temps au mot) et l'ADR-0011 (détection en direct). La mienne est devenue 0012.

## 2026-10-22 — Début incertain promu par son voisin, début avant pause, temps au mot (ADR-0010)
- **Contexte** : session 5014015f (Hud 11:61-90). L'intervalle 21,5-35,7 s restait `uncertain` (début de 11:61
  semblable à 7:73) alors que la fenêtre contiguë, 11:61 [10-17], est `recognized`. Cause : l'incertitude du
  décodeur se mesure sur le score avant d'une couche, et la chaîne d'ADR-0007 ne relie pas deux plages qui
  partagent un mot (`last_word < first_word`). Cherif signale aussi, sur `lot2-05` (récitation à pauses),
  « une partie du verset commencée, pause, suite » dont la partie commencée n'est jamais reconnue.
- **Décisions** :
  - Promotion par le voisin (`aqr.decoding.neighbors`, pur) PUIS preuve acoustique obligatoire
    (`AcousticVerifier.verify_alone`, même seuil −1,0). Sans modèle CTC, jamais. Le décodeur n'est pas modifié.
  - Début avant pause (`head`) : miroir de la suite d'un verset commencé (ADR-0008 6-8), mêmes deux témoins
    (audio + transcription ≥ 0,6). Trou au milieu d'un verset comblé de la même façon. **Hafs uniquement**
    (décision de Cherif) : si l'audio ne soutient pas le texte Hafs, l'abstention reste.
  - Temps au mot additif dans `aqr.recognition/1` (`word_times`, `word_times_source` ctc-alignment|interpolated),
    rien pour `uncertain`/`inferred`. La fusion de deux moitiés met les temps bout à bout, sauf mot manquant.
  - « Début tardif » à 55,1 s : mesuré, ce n'est pas le bord de fenêtre ; RMS à 55,06 s, ce que Cherif entend à
    54,8 s est une inspiration (≈ 2 % de la voix). Aucune marge de treillis ajoutée (même résultat à +1,5 s).
- **Écartés** : corriger l'incertitude dans le décodeur (max-marginals) — la décision échapperait à l'audio ;
  élargir les plages tolérées (chevauchement > 2 mots) — ce serait une reprise (i'ada), pas un raccord.
- **Risques connus** : seuils provisoires (étape A) ; un `head` accepté sur de la parole proche du texte (Dice 0,6)
  reste possible, il est tracé dans `acoustic_checks[kind=head]` ; non validé à l'oreille.

## 2026-10-23 — Direction produit : non commercial, Hafs seul, détection en direct sans plage (ADR-0011 proposé)
- **Décisions du mainteneur** :
  - **Usage non commercial uniquement.** Le projet sera **publié en open source sous une licence non
    commerciale** (question réglée, ne plus la reposer) ; les modèles et jeux non commerciaux (Tadabur
    CC BY-NC, Muno NPL-1.1…) restent admissibles.
  - **Hafs uniquement** : ni Warsh ni autre riwaya. Un verset d'une autre lecture éventuellement reconnu
    reçoit simplement sa traduction ; aucune détection de riwaya (la mesure `riwaya-2026-10-20.md` reste
    une note de fond).
  - **Direction** : l'analyse de fichiers d'abord ; l'**objectif** est la **détection en direct sur flux
    WebSocket, sans plage déclarée** (le passage peut venir de n'importe où dans le Coran ; pas de mode
    « plage déclarée » façon Tarteel).
  - **Budget de la cascade** conditionnel au temps disponible (conçu dans l'ADR-0011 §7, pas codé).
  - **Comptes** : le mainteneur est administrateur ; relecteur et écrans d'administration plus tard.
- **Conception** : `docs/adr/0011-detection-en-direct-sans-plage.md` (statut **proposé**). L'idée du
  mainteneur (garder les candidats ouverts, n'afficher que le sûr, basculer vers la source exacte dès
  qu'un mot départage, supposer la suite, détecter le saut) est formalisée en suivi d'hypothèses de
  position avec quatre classes d'a priori, quatre niveaux d'affichage et un protocole `aqr.live/1`.
- **Preuve chiffrée** (`scripts/analyze_verse_prefixes.py`, corpus Hafs, mots exacts = borne basse) :
  médiane de 2 mots (p90 5, max 18) pour distinguer un début de verset ; 54,1 % des versets en ≤ 2 mots,
  74,3 % en ≤ 3 ; **25,7 % exigent plus de 3 mots, 11,8 % plus de 5** ; **289 versets (4,6 %) sans préfixe
  unique** (278 sosies exacts en 97 groupes, 11 débuts stricts d'un verset plus long) ; avec la sourate
  comme contexte, 82,7 % en ≤ 2 mots et 164 des 289 deviennent uniques ; **125 restent ambigus même dans
  leur sourate** (refrains des sourates 26, 55, 37, 77, 54, 2) : seule la position les nomme. Rejeu de 30
  sorties EveryAyah (flux simulé, débit uniforme) : verset unique après 3,1 s en médiane sans contexte,
  1,5 s avec la suite attendue (versets de 7,8 s en médiane).
- **Trois décisions techniques recommandées** :
  1. *Candidats ≠ verrou* : un état transitoire « ambigu : n candidats » (distinct de `UNCERTAIN`, qui est
     final) et un verrou qui exige `min_words_lock` mots **quel que soit le posterior** — un a priori fort
     fait trouver la suite avec un seul mot, ce qui est juste en théorie et fragile en pratique (I3).
  2. *`INFERRED` étendu* par `identity_basis: "context"` quand seuls des sosies exacts se départagent par
     la position : texte entendu, référence déduite. **À valider par le mainteneur** (étend I5) ; sinon ces
     versets restent `UNCERTAIN` jusqu'à la clôture.
  3. *Le lot reste la référence* : `aqr.live/1` reprend les champs de `aqr.recognition/1` pour un verset
     verrouillé, `FINAL` est le document du lot, et le mode dégradé **durcit** la règle de verrou quand un
     palier de vérification est sauté, il ne l'assouplit jamais.
- **Écartés** : plage déclarée ; diffusion de jetons ASR comme résultat (I1, I3) ; attendre la fin du
  verset ; verrouillage dès que l'a priori le permet ; LLM ou base vectorielle (ADR-0001, 0003).
- **Traduction « partielle »** : impossible sans modifier QuranEnc (I2). Règle proposée : arabe sûr du
  corpus avant le verrou ; traduction avant le verrou seulement si tous les candidats restants ont la
  même ; sinon à la demande, entière et étiquetée.
- **Publication open source non commerciale — écarts à traiter avant de publier** (rien n'est modifié ici,
  le choix de licence est celui du mainteneur) :
  1. *Licence du code* : `LICENSE` est **MIT** (autorise l'usage commercial) et le README annonce « Code :
     MIT » ; `pyproject.toml` n'a aucun champ de licence, `web/package.json` est `private` sans licence.
     À choisir (PolyForm Noncommercial 1.0.0, Prosperity, ou autre) puis à reporter dans `LICENSE`, le
     README, `pyproject.toml`, `web/package.json`. Une licence qui interdit l'usage commercial n'est **pas
     « open source » au sens de l'OSI** (code publié, usage restreint) : le dire clairement dans le README.
     Toute version déjà publiée sous MIT reste sous MIT pour ceux qui l'ont reçue.
  2. *Attributions manquantes* : aucun fichier `NOTICE`/`CREDITS`. À créer : Tanzil (CC-BY-3.0, lien
     tanzil.net, texte non modifié), QuranEnc (restitution sans modification, mention de la source),
     modèles (FastConformer-Quran CC-BY-4.0, Muno NPL-1.1, Whisper base Quran Apache-2.0,
     recitations-segmenter MIT, silero-vad), jeux (Common Voice 17 CC0, FLEURS CC-BY-4.0, Tadabur
     CC-BY-NC-4.0). Les polices du dossier `web/public/fonts` ont déjà leur texte OFL ; la police Hafs V30
     est hors Git (licence sans redistribution) : conforme.
  3. *Modèles et jeux tiers* : aucun poids ni jeu dans Git (`models/*`, `data/*` ignorés, seuls les
     `LOCK.json`). Compatibles avec une publication non commerciale ; Muno impose un accès Hugging Face
     approuvé et interdit le commercial ; un modèle réentraîné sur Tadabur (CC BY-NC) serait lui-même non
     commercial et attribué (à confirmer avant toute diffusion de poids).
  4. *Données de personnes et de tiers dans Git* : `tests/fixtures/audio/manifest.yaml`,
     `docs/data-lots/lot-1.yaml` et `lot-2.yaml` versionnent des **adresses YouTube** (près de cinquante
     occurrences avec le test du manifeste), des empreintes sha256, des **pseudonymes de locuteurs** et la
     mention « usage interne d'évaluation uniquement » ; `docs/evaluation/riwaya-2026-10-20.md` cite des
     identifiants de locuteurs. À retirer ou à anonymiser, et surtout **l'historique Git les contient
     déjà** : publier un dépôt neuf issu d'un état nettoyé, ou réécrire l'historique (décision du
     mainteneur). **Point le plus sensible** : `docs/data-lots/RIGHTS.md` (KI-2) constate qu'un dataset
     Hugging Face des 12 audios du lot 1, nommé « private », est **public** alors que ces enregistrements de
     tiers (voix identifiables) sont marqués « jamais redistribué » ; les trois décisions de ce document
     (visibilité, retrait des enregistrements aux droits non établis, mention de droits) restent à prendre
     **avant** toute publication du dépôt, qui y renvoie.
  5. *Texte coranique versionné* : le corpus Tanzil n'est pas dans Git ; mais `tests/fixtures/asr/*_everyayah.json`
     (transcriptions de récitations de tiers) et quelques chaînes de tests contiennent de longues
     séquences arabes (9 fichiers suivis en ont au moins une de 9 mots ou plus) ; `docs/KNOWN-ISSUES.md`
     (KI-1) cite deux phrases de traduction QuranEnc. À décider : garder, raccourcir ou régénérer à la demande.
  6. *Dépendances du dossier `web/`* : licences npm à auditer (`license-checker` ou équivalent).
  7. *Documentation d'agents* (`.artist/`, `docs/prompts/`, `CLAUDE.md`, `AGENTS.md`) : à décider si elle
     est publiée telle quelle.

## 2026-10-23 — Combler un trou entre deux versets reconnus (revue lot3-04), ADR-0013
- **Besoin** : cinq défauts relevés à l'oreille par le mainteneur sur « lot3-04 », tous du même genre (une partie d'un
  verset reconnue, l'autre abstenue ou incertaine). Mécanisme commun plutôt que cinq rustines : contexte -> hypothèse de
  texte du corpus -> alignement sur le trou -> décision acoustique.
- **Décision prise seul (hypothèses)** : (1) la preuve par trame se mesure sur la parole alignée, pas sur tout le passage
  (le `head` de la session avait −0,48 pour 2 mots dans 22 s) ; (2) un mot sans soutien se voit mot par mot, toléré à 15 %
  (un verset parfait en compte un sur dix) ; (3) deux hypothèses se comparent par la log-vraisemblance TOTALE sur les
  mêmes trames, pas par la moyenne par trame ; (4) le cas 2 (mot suivant dit dans la même fenêtre) n'est pas un trou :
  extension de bord par comparaison de deux textes sur les mêmes trames ; (5) un verset nouveau n'est jamais nommé sur
  moins de 3 mots (2:88 [1-1] et 11:91 [1-1] écartés à la mesure) ; (6) les détections ajoutées ne se raccordent que si
  aucun mot ne manque (l'audio vient d'être entendu).
- **Pas corrigé** : le mot « بسم » de 1:1 (llr −0,84, un mot sans transcription : sous le seuil des mots seuls).
- **Mesure** : `docs/evaluation/comblement-de-trou-2026-10-23.md` (0 perdu, 0 ajouté sans Coran, EveryAyah 216/216).
- **Risques connus** : seuils provisoires (étape A) ; 16 ajouts proches du seuil ou sans second témoin à écouter.


## 2026-10-23 — Courbe de vitesse : pas d'étage « candidat de vitesse »
- **Contexte** : la campagne de dégradation montrait qu'accélérer l'audio d'une récitation ralentie remonte
  le rappel, mais avec le facteur connu. Question : le facteur est-il estimable, et un étage de la cascade
  (ADR-0009) se justifie-t-il ? Rapport : `docs/evaluation/courbe-vitesse-2026-10-23.md`.
- **Décision prise (règle écrite avant la mesure, commit `f153e8f`)** : pas d'étage. Partie témoins tenue
  (+11,0 points à ×0,4, +21,9 à ×0,3 avec le facteur estimé, 0 faux verset) ; partie vrais fichiers non tenue :
  `lot1-09` (cours étiqueté « sans Coran ») reçoit un verset nouveau soutenu, 11:105 [8-10], qui prolonge la
  suite 11:106-108 déjà reconnue — très probablement une vraie citation. Appliqué à la lettre, pas
  réinterprété après coup.
- **Hypothèses énoncées** : le débit typique est de 3,2 lettres/s (médiane des 9 sourates propres) ; le
  facteur est le plus proche de l'inverse du rapport, activé sous 0,75 ; l'estimateur de la règle est celui de
  plus petite erreur relative médiane (lettres par seconde, 26,5 %), calibré par récitant exclu.
- **Écart / risque** : la règle compare au moteur seul (référence demandée), pas à la cascade ; un prototype
  mesuré dans la cascade (branche `wip/etage-vitesse`, non fusionnée) ajoute 0 verset distinct sur 7 fichiers.
- **À retenir** : l'optimum de compensation est à une vitesse nette de ×1,2 à ×1,6, pas à l'inverse ;
  An-Naml ne manque pas de vitesse (8, 8, 7, 7, 7 versets de ×1 à ×2,5) ; la compensation du fichier entier
  peut tout perdre (`lot3-01` : 5 → 0 versets à ×1,5). Reprendre la question seulement avec un fichier réel
  que la cascade rate et que ×1,5 sauve.

## 2026-10-23 — Fluidité de l'atelier sur les longs audios (branche `perf/interface-longs-audios`)
- **Décision** : le DOM de l'atelier ne dépend que de l'écran. Liste des intervalles virtualisée (hauteur de ligne
  fixe, tabulation roulante, `aria-setsize`/`aria-posinset`), timeline fenêtrée (segments de la vue + marge, blocs
  pour les segments < 4 px, graduations de la zone), recherche d'intervalle par index temporel (O(log n)), position
  publiée à ~60 Hz, textes de position à 20 Hz, tête de lecture par `transform`.
- **Mesures** (banc `web/e2e/perf-measure.mjs`, build de production, 3 128 intervalles) : 22 431 → ≈ 1 000 nœuds ;
  saut entre versets 1 670 ms → 37 ms (p50) ; ouverture jusqu'à l'onde 4,1 s → 0,45 s ; lecture 1,4 s → 12 à 33 ms
  par image (écran 240 Hz).
- **Hypothèse retenue** : pas de `@tanstack/react-virtual` : lignes de hauteur fixe, besoin de pinner la ligne qui
  porte la tabulation et fenêtrage temporel de la timeline (aucune bibliothèque ne le fait) ; 150 lignes testées.
- **Écart / risque** : sur « Fichier entier », les abstentions contiguës fusionnent en blocs (changement visible,
  l'onde redevient lisible) ; il reste une mise en page de ≈ 5 ms par mise à jour de texte (20 Hz) en mode headed
  (cause non isolée, racine = document) ; pic de style/peinture de 25 à 45 ms au 95ᵉ centile à 240 Hz.
- **À retenir** : mesurer en mode avec fenêtre (`--headed`, vrai GPU) : le mode sans fenêtre masque un facteur 4 à 5
  sur la mise en page.

## 2026-10-23 — Export des sous-titres : les décisions humaines sur une prédiction immuable (ADR-0014)
- **Contexte** : issue #86, conception `docs/design/export-sous-titres.md`. Le mainteneur n'a pas contredit les
  défauts d'arbitrage proposés ; ils sont appliqués tels quels.
- **Décisions prises** : (1) la correction est un champ `resolved` (`by: "human"`) à côté du `status` du moteur,
  jamais un 4e statut ni une réécriture ; (2) un signe de pause qui diffère est compté à part (`Arabe · 1 signe`) ;
  (3) consentement d'entraînement activé pour ses propres sessions, verrouillé à faux pour celles des autres ;
  (4) forcer = omettre par défaut, un verset supposé est omis ; (5) attribution portée par JSON / ASS / WebVTT,
  rappel à l'écran pour SRT ; (6) renvois de note gardés avec une case pour les retirer.
- **Hypothèses énoncées** : les temps de l'empreinte sont en millisecondes entières, `floor(x × 1000 + 0,5)` (le
  demi vers le haut en Python comme en TypeScript, jamais l'arrondi bancaire) ; une annulation garde la décision
  (`withdrawn_at`) au lieu de la supprimer, pour l'historique ; une décision dont la cible est un signalement sans
  intervalle n'a pas d'empreinte et n'admet que `set_ref`, `dismiss_report`, `ignore`.
- **Écart avec la conception** : le schéma de la conception parlait d'une annulation par « nouvelle entrée »
  `ignore`/`withdrawn` ; l'ADR retient `withdrawn_at` (plus simple, même effet, l'empreinte des décisions actives
  redonne celle d'un export sans décision).
- **À faire ensuite** : moteur `aqr export-subtitles` (PR 2), routes et réconciliation des orphelines (PR 3),
  écrans (PR 4).

## 2026-10-23 — Moteur d'export des sous-titres (`aqr export-subtitles`)
- **Décision** : un seul moteur de rendu en Python (le web n'a pas le corpus, risque n° 1 de la conception) ;
  l'atelier le lance comme `recognize`. `aqr recognize --format srt,vtt` passe par les mêmes écrivains
  (`aqr.rendering.subtitles`) ; le test `test_la_politique_marqueur_donne_les_memes_lignes_que_aqr_recognize`
  garde l'alignement. La numérotation SRT de `recognize` devient séquentielle (elle comptait les détections omises).
- **Hypothèses énoncées (règles du contrôle §3)** : une coupure n'est pas posée sur une répétition (un passage
  redit est partiel par nature), ni quand le voisin proche est le même verset (il continue), ni sur les versets
  supposés voisins (jamais entendus) ; après la basmala concaténée du verset 1, le premier mot de contenu est
  le 5e ; une traduction inconnue (hors ligne) est comptée comme différente par prudence (I3) ; un signalement
  posé sur un passage déjà à vérifier lui est rattaché (un passage, un décompte) ; un passage ignoré suit la
  politique choisie pour l'export forcé (omettre par défaut).
- **Choix d'écriture** : les formules autres que la basmala s'exportent avec le libellé arabe constant du
  contrat (`label_ar`) entre crochets, jamais un arabe écrit pour l'occasion (I1) ; un marqueur
  `[incertain : …]` est du texte latin, jamais encadré en RTL ; les points de suspension d'un fragment ne
  tombent que sur une ligne qui porte du texte.
- **Écart avec la conception** : une seule sorte `cut` (côtés `start`/`end` en détail) au lieu de `cut_start` et
  `cut_end`, parce qu'une plage de mots étendue répond aux deux côtés à la fois.
- **Mesure** : session réelle de 23 min (11 passages à vérifier dont 7 traductions approximatives) : contrôle
  1,4 s, export ASS 1,0 s (corpus et cache de traduction locaux).
- **Risques connus** : coupe de la traduction d'un long verset sans `segments` = proportionnelle (avertie) ;
  taux de faux positifs de la règle des coupures non mesuré sur le lot 1 (risque n° 6 de la conception).

## 2026-10-23 — Export des sous-titres : l'API de l'atelier (contrôle, décisions, orphelines, vérité terrain)
- **Décision** : le serveur lance le moteur Python (`export-readiness`, `export-subtitles`, `corpus-verse`) au lieu
  de réimplémenter le rendu : au plus 3 processus, mémoire des réponses identiques (clé = prédiction,
  `decisions.json`, `review.json`, options), erreurs traduites (code 3 → `409 unresolved_items`). L'export n'est
  jamais mémorisé : c'est un acte, le fichier est écrit le temps de la réponse.
- **Hypothèses énoncées** : les décisions s'enregistrent dans `decisions.json` sous verrou (comme la revue), le
  serveur fixe empreinte, auteur, date, révision et copie du consentement ; un non-propriétaire ne consent pas, un
  administrateur qui corrige l'audio d'un autre ne change pas l'accord du propriétaire et son `use_for_training`
  reste faux ; une décision posée sur des signalements que la revue ne confirme plus devient orpheline ; une
  décision `uncertain` ne se pose que sur un passage réellement incertain (idem `inferred`) ; retirer le
  consentement du document empêche toute proposition, sans effacer l'historique.
- **Réconciliation (obligatoire avant de livrer le calque, risque n° 3)** : après une nouvelle analyse, les
  orphelines sont listées avec le passage du moteur le plus proche (recouvrement ≥ 50 % du plus court), jamais
  appliquées toutes seules ; `reattach` les rattache et garde l'ancienne (`superseded_by`).
- **Vérité terrain** : action administrateur `from_decisions` : propositions `proposed` (`source:
  export-review`) pour les décisions factuelles écoutées, consenties (document ET décision), encore appliquées.
  Les exclusions « pas du Coran » ne deviennent pas encore un passage de vérité terrain (le manifeste ne porte
  que des versets) : écart avec la conception §5.4, à trancher avec le mainteneur.
- **Défaut corrigé par le test partagé** : le lecteur Python refusait un pseudonyme avec espace ou accent
  (« Chérif Diouf ») que l'atelier accepte ; 36 documents d'essai communs aux deux lecteurs garantissent
  désormais le même verdict.
- **Preuve** : `web/e2e/export-api.mjs` (14 scénarios, serveur de production, données de test) →
  `.artist/acceptance-playbooks/export-sous-titres-api.md`.

## 2026-10-23 — Export des sous-titres : les écrans de l'atelier (contrôle, correction, forcer)
- **Pas de nouveau passage par Sofia.** La direction artistique (« Encre & lapis », prototypes, captures) est déjà
  fusionnée dans `docs/design/` ; les écrans la portent en jetons (`web/app/tokens.css`, identique à
  `docs/design/tokens.css`) et en classes préfixées `ex-` (`web/app/export.css`). Seuls ajouts de jetons :
  `--cue-bg`, `--cue-edge`, `--cue-fg`, `--cue-fg-2` (couleur de la ligne de sous-titre).
- **Architecture** : composants clients dans `web/app/atelier/export/` (aucun fichier existant de l'atelier
  refactoré ; deux ajouts de quelques lignes : bouton d'entrée dans `session-head.tsx`, touche E dans
  `review-app.tsx`) ; règles pures dans `web/lib/export-*.ts` (textes, choix de décision, voisins, brouillon,
  préférences, écoute), testées sans navigateur. Patterns : Adapter (`export-client.ts`, seul à parler à l'API),
  Strategy (`export-decision.ts` : un constructeur de décision par sorte de passage), Repository côté serveur
  (déjà posé en #98, `decisions-store.ts`).
- **Écoute mesurée sur l'`<audio>`, pas sur l'animation** : le premier essai suivait la position publiée à chaque
  image dessinée ; dans un volet masqué ou lent, aucune image ne vient et le passage n'était jamais « écouté ».
  La position est maintenant lue toutes les 100 ms ; un saut se distingue d'une lecture par l'horloge (la position
  ne peut pas avancer plus vite que ×2,5 le temps réel). Seuil : 70 % de la plage.
- **Un seul type d'élément « coupure »** (début ou fin manquants) au lieu de deux : la correction est la même
  (choisir la plage de mots) ; l'écran dit lequel manque.
- **Erreur franche** : une session absente ou non terminée n'affiche ni réglages ni bouton « Forcer » (premier jet
  de l'écran : réglages actifs sous un message d'erreur).
- **Non tranché, à voir avec le mainteneur** : (1) l'exclusion « pas du Coran » ne devient pas un passage de vérité
  terrain (inchangé depuis #98) ; (2) la règle « premier candidat » reste déconseillée tant que le moteur n'expose
  pas de score par candidat ; (3) le taux de fausses coupures n'est pas mesuré ; (4) l'écran n'a pas été vu par un
  testeur non propriétaire (couvert par l'API seulement).
- **Preuve** : `.artist/acceptance-playbooks/export-sous-titres-ui.md` (10 scénarios, build de production,
  375 px et 1280 px), tests `web/lib/export-*.test.ts`.
