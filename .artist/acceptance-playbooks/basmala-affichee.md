# Basmala affichée comme un verset (sortie `aqr.recognition/1`)

Contrat : `docs/RECOGNIZE-OUTPUT.md`. L'interface (affichage du texte et de la traduction de la basmala) s'appuie sur
ces champs ; ses scénarios d'écran sont à la fin.

## Must-pass

- Un intervalle `non_quran` de label `basmala` porte `basmala: true`, `ref: "1:1"`, `text` = le verset 1:1 **tel
  que le corpus Tanzil le donne** (4 mots, marques de pause comprises) et `translation` = la traduction QuranEnc
  du verset 1:1 (`text`, `translation_id`, `version`, `attribution`, `scope: "verse"`), restituée sans modification.
- `--translation none` : `text` reste, `translation` vaut `null`.
- Isti'adha, takbir, amin : un `label_ar` constant (`أعوذ بالله من الشيطان الرجيم`, `الله أكبر`, `آمين`), **sans**
  `text`, `ref`, `translation` ni `basmala`.
- Les autres zones non coraniques (`french`, `silence`…) gardent exactement `{kind, label, t}`.
- L'ancien format `{kind, label, t}` (anciens résultats, sessions déjà sur disque) est lu sans erreur par le lecteur
  Python (`aqr.eval.recognition`) et par le schéma web (`web/lib/recognition.ts`).
- La copie expurgée (`redact_document`) retire `text` et `translation` de la basmala comme de tout verset, et garde
  `basmala` et `ref`.
- Une vraie récitation de la sourate 55 précédée de sa basmala : l'intervalle basmala porte le texte du corpus et la
  traduction ; `tests.support.corpus_check` valide le document (versets et basmala).

## Must-fail

- Le texte de la basmala ne vient jamais d'un modèle : un document dont le `text` de la basmala diffère du corpus
  (ou est absent) est rejeté par `corpus_check` (seul à charger le corpus) ; un `ref` qui n'est pas `1:1`, un
  `basmala` non booléen ou faux alors qu'un texte est présent sont rejetés par `corpus_check`, le lecteur Python et
  le schéma web.
- Une formule hors Mushaf (takbir, amin, isti'adha) portant un `text`, une `ref` ou une `translation` est rejetée
  (I1, I4) par les trois ; `label_ar` sur la basmala est rejeté par les trois ; `label_ar` différent de la
  constante du label est rejeté par `corpus_check` ; une traduction de basmala sans id, version, attribution ou de
  portée autre que `verse` est rejetée par `corpus_check` (I2, forme seulement).
- Hors ligne et sourate 1 absente du cache de traductions : `aqr recognize` écrit quand même les sous-titres, n'écrit
  pas de JSON à moitié, et dit de réessayer avec le réseau ou `--translation none` (message, code 1, pas de trace).
- Les sous-titres SRT/VTT gardent `[basmala]` : aucun texte du Mushaf n'y est ajouté par cette brique.

## Scénarios d'écran (à jouer quand l'interface sera refaite sur ce contrat)

- À 375 px : la carte de la basmala montre le texte arabe et sa traduction comme un verset, étiquetée « basmala » ;
  isti'adha / takbir / amin montrent leur libellé arabe sans apparence de verset (pas de référence, pas de traduction).

## Vérification du 22 octobre 2026

- Moteur réel (cascade) sur `test-55.webm` (55:1-4 précédé de la basmala, 16,7 s) : intervalle basmala à 1,29-4,33 s avec
  texte et traduction ; `corpus_check --surah 55` : OK, 4 versets reconnus.
- `pytest` : 1169 réussis ; les échecs restants sont ceux d'environnement Windows déjà présents (`fcntl`,
  `resource`, chemins POSIX). `ruff check`, `ruff format --check` propres ; `mypy` : seules les 3 erreurs `fcntl` de
  `eval/run.py` (Windows), hors de ce lot. Web : `vitest`, `tsc`, `prettier` propres.
