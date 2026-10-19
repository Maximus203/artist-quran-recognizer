# ADR-0007 — Preuve cumulée par la suite : les versets courts se confirment entre eux

- Statut : accepté — 2026-10-19 (étape B, première brique)
- Précise : ADR-0004 (score du matcher plafonné par la preuve), B7 (décodeur de séquence)

## Problème
Le matcher plafonne un candidat à `qualité × min(1, mots expliqués / evidence_words)` (5 mots) pour
qu'un fragment ne nomme jamais seul un verset (F5, I3). Le pipeline écartait ensuite, **fenêtre par
fenêtre et avant tout contexte**, chaque fenêtre dont le meilleur score restait sous 0,75. Un verset de
1 ou 2 mots bien reconnu était donc condamné : son voisinage n'était jamais consulté.

Cas d'origine (2026-10-19, voix de Cherif au micro, trois moteurs) : basmala puis Ar-Rahman 55:1-4. Chaque
fenêtre est parfaitement transcrite, le bon verset est en tête, mais 2 mots = 0,40 : **aucun verset
nommé**, alors que le matcher, sur la transcription entière, trouve 55:1-4 à 1,00. Même cause derrière
une grande partie des 47 % d'omissions du rapport réel du 2026-10-09 (sourates courtes, Fatiha).

## Décision
1. Le matcher expose, en plus du score, la **qualité** (avant plafond) et les **mots expliqués** de
   chaque candidat (`Candidate.quality`, `Candidate.explained`).
2. `aqr.decoding.chains.promote_chains` (pur) : sur des fenêtres **consécutives**, une suite de
   candidats qui se **continue dans le Mushaf** — verset suivant (le précédent fini, le suivant commencé
   à son début, basmala de Tanzil comprise, à `word_slack` mot près) ou suite du même verset après un
   waqf — dont chaque maillon a une qualité ≥ `min_quality` (0,75) et qui cumule ≥ `evidence_words`
   (5) mots sur au moins 2 fenêtres : chaque maillon reçoit sa qualité pour score.
3. Le pipeline ne décide l'abstention `below_threshold` qu'**après** cette promotion. Le seuil du
   décodeur (0,75) et le décodeur lui-même sont inchangés.
4. Garde-fous : un fragment isolé reste plafonné ; un homonyme hors de la suite aussi (« خَلَقَ
   الْإِنْسَانَ » = 55:3, 16:4, 21:37 : seul 55:3 continue 55:2) ; une fenêtre vide ou non coranique
   coupe la suite ; un candidat de qualité inconnue n'est jamais promu ; deux suites parallèles sont
   toutes deux promues et le décodeur déclare l'ambiguïté. Tout est configuration (`ChainConfig`,
   `enabled=False` rend l'ancien comportement), tracée dans la sortie (`decoder.chain_evidence_words`).

## Mesures — `docs/evaluation/chain-proof-2026-10-19.md`
Micro (voix de Cherif, 55:1-4) reconnu avec FastConformer et Whisper ; EveryAyah 71,8 % → 91,2 % de rappel,
0 faux verset ; sur les assises dev, les nouveaux versets sont des citations réelles (transcriptions relues).

## Ce qui n'est PAS fait (étape B, suite)
- Vérification **acoustique** de la suite (alignement forcé CTC de la suite déclarée par le matcher,
  ADR-0006) : elle rattraperait un maillon mal transcrit (Muno ampute « عَلَّمَ » en « لَّمَ » au début
  d'une fenêtre, la suite se coupe) et renforcerait le rejet du non-Coran.
- Seuils non calibrés sur une vérité humaine (étape A en cours).
