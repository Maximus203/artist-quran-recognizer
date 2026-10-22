# Traduction par passage (fragments alignés sur les mots arabes)

Contrat : `docs/RECOGNIZE-OUTPUT.md` § « Traduction par passage » · décision : ADR-0010 · mesures :
`docs/evaluation/traduction-par-passage-2026-10-23.md`. Les scénarios d'écran (surface mobile d'abord) sont à
jouer par l'interface ; le reste est vérifié par les tests Python.

Build : `develop` + branche `feat/traduction-par-passage` · Testé : 2026-10-23.

## Must-pass

- **MP1 — fragment du passage affiché.** Un verset partiel dont les frontières sont connues (session réelle
  `5014015f…`, 11:61 mots 24-27) porte `translation.scope == "fragment"` et `translation.fragment` = la partie de
  la traduction qui correspond à ces mots ; `translation.text` reste le verset entier.
  (`tests/unit/test_home_renderer_fragments.py`, cas réel dans le rapport de PR.)
- **MP2 — segments qui couvrent tout, sans toucher au texte (I2).** `segments` : plages de mots contiguës et
  ordonnées de 1 au dernier mot ; chaque `text` est une tranche exacte de la traduction ; les tranches rejointes
  redonnent la traduction à l'espace de jonction près. Sur les **6 236 versets** :
  `scripts/build_translation_segments.py` → « reconstitution : 6236/6236 » ;
  `tests/unit/test_translation_segments_data.py::test_every_verse_is_rebuilt_identically_from_its_slices`.
- **MP3 — la note `[1]` reste avec la tranche qui la précède** (`test_footnote_marker_stays_with_the_fragment…`).
- **MP4 — plage = verset entier** : `scope: "verse"`, pas de `fragment`, `segments` présent.
- **MP5 — repli honnête.** Fragment qui déborderait trop de la plage (`FragmentPolicy.max_overreach`), verset à
  une seule proposition, découpage absent : `scope: "verse"`, la traduction entière, rien d'inventé.
- **MP6 — `…` jamais dans `text`.** Les bords coupés sont `ellipsis_before` / `ellipsis_after` ; `fragment.text` est
  une tranche exacte.
- **MP7 — `approximate`** vaut vrai dès que `fragment.words` ≠ la plage affichée (déborde ou écarte un bord).
- **MP8 — compatibilité.** Une sortie sans `segments` ni `fragment` (anciennes sessions) est lue par le lecteur Python
  (`aqr.eval.recognition`), `scope: "verse"` inchangé (`test_legacy_output_without_segments_stays_readable`).
- **MP9 — le fichier de données ne contient ni texte coranique ni traduction** (indices, offsets, empreintes).
- **MP10 — basmala** : porte ses `segments`, jamais de `fragment`.

## Must-fail

- **MF1 — traduction mise à jour.** Texte français différent de celui des frontières (empreinte SHA-256) : le verset
  n'a ni `segments` ni `fragment`, `scope: "verse"`, jamais un décalage silencieux.
- **MF2 — corpus changé** (nombre de mots arabes différent) : même repli.
- **MF3 — fichier absent, illisible, d'un autre schéma, `translation_id` hors liste** : pas de découpage, pas d'erreur,
  pas de lecture hors du dossier (`SegmentLibrary` refuse `../secret`).
- **MF4 — frontières incohérentes** (mots non croissants, offset hors du texte ou au milieu d'un mot, frontière
  avant le mot 2 ou après le dernier) : refusées à la lecture.
- **MF5 — le lecteur refuse** : plages non contiguës, segments qui ne redonnent pas le texte (I2), `fragment` qui ne
  suit pas les frontières des segments, `fragment.text` qui n'est pas la jonction de ses segments, `scope`
  incohérent avec la présence de `fragment`, drapeau non booléen.
- **MF6 — verset `UNCERTAIN`** : ni traduction, ni segments, ni fragment (jamais nommé).
- **MF7 — traduction sans lien avec l'arabe** : le découpage ne s'invente pas (`test_unrelated_translation…`).
- **MF8 — pas de LLM** : aucune dépendance générative dans `translation_align` (IBM-1 en arithmétique).

## Scénarios d'écran (à 375 px d'abord)

- Passage partiel `scope: "fragment"` : la carte montre `fragment.text` précédé de « … » si `ellipsis_before`, suivi
  de « … » si `ellipsis_after` ; un lien « voir le verset entier » ouvre `text`. Jamais `text` entier sous un libellé
  de fragment.
- `scope: "verse"` sur un verset partiel : la traduction entière avec l'étiquette « Traduction du verset entier ».
- Surlignage en direct : le mot arabe `n` allume le segment dont la plage le contient ; sans `segments`, aucun
  surlignage de traduction (pas de devinette côté interface).
- `approximate: true` : pas de signal agressif ; l'écart n'est qu'un bord plus large ou plus étroit.

## Vérification du 23 octobre 2026

- `pytest` ciblé : `test_translation_segments.py`, `test_translation_clauses.py`, `test_translation_align_build.py`,
  `test_home_renderer_fragments.py`, `test_recognition_translation_contract.py`,
  `test_translation_segments_data.py` : 100 réussis. `ruff check`, `ruff format --check` propres ; `mypy` : seules les
  3 erreurs `fcntl` de `eval/run.py` (Windows), hors de ce lot ; `check_docs_index.py` conforme ;
  `anti_slop.py` : 0 erreur.
- Échecs restants de la suite complète : ceux d'environnement Windows déjà présents (`fcntl`, chemins POSIX,
  scripts bash).
- Reconstitution des 6 236 versets : 6236/6236. Sessions réelles : 732 intervalles partiels de 53 sessions, 75 %
  reçoivent un fragment.
- Relecture de 40 versets : 153 frontières justes, 15 discutables (un mot), **1 fausse** (inversion d'ordre du
  français, 9:128) : l'objectif « 0 fausse » n'est pas atteint, voir l'évaluation.
