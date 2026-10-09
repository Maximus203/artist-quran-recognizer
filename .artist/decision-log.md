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

## 2026-10-09 — Smokes de bout en bout (CLI + navigateur)
- Audio court non versionné : les versets 112:1 à 112:4 (Alafasy, EveryAyah) sont téléchargés par `scripts/fetch_everyayah.py` dans `$AQR_AUDIO_DIR` puis concaténés par ffmpeg en dossier temporaire (marqueur `slow`, hors suite par défaut).
- Restitution contrôlée contre le corpus, pas seulement « non vide » : `tests/support/corpus_check.py` (`assert_matches_corpus`, partagée par le smoke CLI et, via `python -m`, par le smoke navigateur) reprend la sémantique de `HomeRenderer.span_text` : verset entier => texte égal à `repo.text(ref)` ; partiel => sous-chaîne exacte, celle des mots `first..last` ; `1 <= first <= last <= len(words)` ; drapeau `partial` cohérent ; sourate attendue seulement (I3) ; `UNCERTAIN` sans texte ni traduction ; succès = au moins un `RECOGNIZED` (un `INFERRED` est contrôlé mais ne prouve rien, I5). Le texte Tanzil de 112:1 contient la basmala (8 mots) : sur l'audio réel, sans basmala, 112:1 sort `RECOGNIZED` en mots 5..8, partiel, et c'est ce que le contrôle accepte (112:2 `INFERRED`, 112:3 et 112:4 `RECOGNIZED`). Pas de taux ni de seuil dans le test : c'est un smoke de câblage, pas un benchmark.
- Un smoke sauté n'est pas un succès. `AQR_SMOKE_STRICT=1` (défaut de `scripts/smoke_e2e.sh`) : toute ressource absente (audio, ffmpeg, `AQR_MODELS_DIR` et ses fichiers selon `models/LOCK.json` en présence et taille, corpus vérifié par `LOCK.json` en sha256, Chromium, build Next, Python) fait échouer avec sa raison (pytest : erreur ; navigateur : code 2) ; hors strict, skip + résumé « NON EXÉCUTÉ ». Les contrôles de ressources vivent à un seul endroit (`tests/support/smoke_env.py`, interrogé en JSON par le smoke navigateur) ; la décision strict/skip et le verdict de session sont de la logique pure côté Node, testée par vitest (`web/e2e/smoke-support.test.mjs`). Une session `failed`/`cancelled` fait échouer le smoke navigateur aussitôt, avec `session.error`, au lieu d'attendre 900 s.
- Le smoke navigateur utilise `playwright-core` (devDependency exacte) avec Chromium déjà présent (`executablePath`) : ni `playwright install`, ni runner supplémentaire. Il vise l'UI réelle, sans mock : il clique chaque segment RECOGNIZED (jamais un segment incertain), compare le badge « Reconnu » et l'arabe affiché à `interval.text` de l'API, puis ce texte au corpus. Il ne dépend que de `POST /api/sessions` et `GET /api/sessions/<id>`.
- Pack ZIP : tester « PK » et des sous-chaînes brutes ne prouvait rien (le manifeste est `ZIP_STORED`, ses mots sont lisibles même sans entrée). `scripts/verify_review_bundle.py` ouvre l'archive : entrées attendues, chaque clé de `files` présente et chaque entrée listée, SHA-256 recalculés, audio = `audio_sha256` = `files[...]` = `source.sha256` de la prédiction = fichier de référence indépendant, `prediction_sha256` et `engine` cohérents. `export_review_bundle.py` expose ses constantes d'entrées et ses helpers sha256.
- `web/package-lock.json` régénéré depuis celui de develop avec npm 11 : seul `playwright-core` s'ajoute (npm 10.9 supprimait les champs `libc` des binaires optionnels).
- `AQR_PYTHON` est l'interpréteur du moteur (par ex. le venv FastConformer, sans pytest) : le smoke navigateur lui fait lancer `smoke_env`, `corpus_check` et `verify_review_bundle`, donc ces modules n'importent pas `pytest` au chargement. Vérifié avec `AQR_ASR=fastconformer` sous le venv NeMo.
