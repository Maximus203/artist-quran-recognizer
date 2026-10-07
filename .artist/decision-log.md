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
