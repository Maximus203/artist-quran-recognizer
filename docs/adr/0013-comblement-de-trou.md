# ADR-0013 — Combler un trou entre deux versets reconnus, sur l'audio

- Statut : accepté — 2026-10-23 (revue humaine lot3-04)
- Généralise : ADR-0008 (`head` / `continuation`), ADR-0010 (promotion par le voisin)
- Mesures : `docs/evaluation/comblement-de-trou-2026-10-23.md`

## Problème
Cherif a relu l'audio « lot3-04 » (23 min, Fatiha à Baqara) et signalé cinq défauts du même genre : un verset
dont une PARTIE est reconnue et l'autre abstenue ou incertaine.
1. **1:1 et 1:2 lus mais `uncertain`** : la suite 1:1-1:5 est acceptée par l'audio (llr −0,25), mais le décodeur
   juge l'ambiguïté d'une étape avec ce qu'il a vu jusqu'à elle (égalité avec des homonymes) et ne la revoit pas.
2. **Un mot dit après la fin de 2:87 [1-12] n'est pas écrit** : le mot 13 est dit dans la MÊME fenêtre ; l'alignement
   de [1-12] l'a étiré par-dessus sa parole.
3. **Début de 12:21 non reconnu, sa fin oui** : fenêtre de 22 s en abstention (score 0,47). Le contrôle `head`
   n'avait testé que `12:21[1-2]` (le texte alignait à fin libre, 2 mots dans 22 s : llr −0,48 dilué par les
   blancs, similarité 0,29 mesurée sur un texte de 2 mots).
4. **17:74 : début [1-1] reconnu, milieu abstenu** : le contrôle `continuation` n'avait testé que `17:74[2-2]` sur
   une petite fenêtre.
5. **17:76 redit en entier, aucune détection** : deux abstentions (score 0,727 pour la seconde, seuil 0,75).

## Décision
Un mécanisme unique, deux étapes après le décodage, toutes deux soumises à l'audio (I3, seuil −1,0 inchangé) :

### A. Promotion par la suite (`decoding/chain_members.py`, pur)
Un `uncertain` couvert (même verset, plage contenue, temps contenu) par une suite que l'audio a ACCEPTÉE devient
`recognized`, `promoted_by: "chain"`. Si une autre suite (autres plages) est aussi acceptée sur le même temps :
rien (deux homonymes qui se valent restent l'affaire du décodeur, limite d'ADR-0008).

### B. Comblement de trou (`decoding/gaps.py` pur + `AcousticVerifier.verify_gap`)
- **Trous** : espace entre deux éléments consécutifs de la chronologie (détection de tout statut, formule), ou entre
  un élément et le bord du fichier, d'au moins `min_gap_s` (0,6 s). Seul un verset `recognized` est une ancre ; un
  voisin `uncertain` ou non coranique ferme le trou sans contexte ; un `inferred` n'est ni ancre ni barrière. Un trou
  de plus de `max_search_s` (60 s) est coupé près de chaque ancre.
- **Hypothèses** (texte du CORPUS, I1), déduites du contexte : `head` (début manquant de l'ancre suivante),
  `between` (reste du verset précédent + versets entiers manquants + début du suivant, reprise de 3 mots en arrière
  possible), `continuation` (reste du verset reconnu + verset suivant, fin libre), `repetition` (verset entier,
  plage reconnue, fins de 3 et 6 mots déjà reconnues). Chaque hypothèse dit le premier mot NOUVEAU qu'elle apporte
  (`new_from`) : une reprise qui ne l'atteint pas n'est pas retenue.
- **Preuve** : alignement forcé du texte sur le treillis du trou. La preuve par trame est mesurée sur la SEULE parole
  alignée (`CtcEvidence.voiced_llr_per_frame`) : celle du passage entier est diluée par les blancs (le contrôle `head`
  du cas 3 avait −0,48 pour 2 mots dans 22 s) et un mauvais texte y passerait. Chaque mot porte aussi sa preuve
  (`AlignedWord.llr_per_frame`) : un mot sous −3 est « sans soutien », toléré à 15 % des mots (un verset parfait en
  compte un sur dix, 2:87 mot 6 à −4,8), jamais dans un texte court.
- **Deux témoins** : l'audio (preuve ≥ seuil) ET la transcription du trou (similarité ≥ 0,6), sauf audio fort
  (preuve ≥ −0,5) où elle ne bloque plus qu'en dessous de 0,3 (l'ASR comprend mal certains passages) ; sans
  transcription (trou jamais segmenté), audio fort et trois mots au plus. Une répétition de moins de trois mots n'est
  jamais nommée. La suite d'un verset n'ouvre pas un verset nouveau sur moins de trois mots (mesuré : 2:88 [1-1],
  11:91 [1-1]).
- **Décision** : parmi les hypothèses compatibles (mêmes mots d'un même verset), celle qui explique le plus de parole
  (log-vraisemblance TOTALE du passage : un rapport de vraisemblance sur les mêmes trames, que la moyenne par trame
  ne donne pas), à 2 nats près la plus longue. Deux textes différents à moins de 3 nats : rien. Un texte que le
  matcher avait vu dans le trou et qui l'explique mieux de 3 nats : rien (« mieux expliqué par autre chose »).
- **Intégration** (`ViterbiSequenceDecoder.integrate`) : les détections ajoutées sont insérées dans le temps et
  raccordées à leurs voisins comme celles du décodeur (moitiés fusionnées, mots redits marqués `repetition`), mais
  SEULEMENT si aucun mot ne manque entre elles (l'audio vient d'être entendu : ce qu'il ne dit pas n'est pas
  supposé). Une abstention en grande partie couverte par un verset ajouté disparaît ; un `inferred` retrouvé aussi.

### C. Bords d'un verset reconnu (`AcousticVerifier.extend`)
Le cas 2 n'est pas un trou : le mot manquant est DANS la fenêtre reconnue. Pour chaque verset `recognized` incomplet
à un bord, le texte reconnu et le texte étendu de 1 à 3 mots sont alignés sur les mêmes trames (les 3 derniers ou
premiers mots, quatre secondes d'audio au plus, jamais au-delà du voisin) ; l'extension est gardée si la preuve
totale gagne 4 nats par mot ajouté et qu'aucun mot ajouté n'est sans soutien (2:87 mot 13 : +6,9 nats). Le mot du
bord est recalé et les temps au mot restent ordonnés (un écart de frontière de plus de 0,5 s ne garde aucun temps).
Les voisins du même verset bornent le nombre de mots.

## Traçabilité (champs additifs, schéma `aqr.recognition/1` inchangé)
- `intervals[].promoted_by` : `"chain"` ou `"gap"` en plus de `"neighbor"`.
- `acoustic_checks[]` : `kind: "gap"` avec `role` (`head|between|continuation|repetition|extension|competitor`),
  `words`, `weak_words`, `passage_llr_per_frame`, `gain_nats` (extension) ; `llr_per_frame` y est la preuve de la
  parole alignée. Toute hypothèse évaluée est tracée, refusée ou non ; un trou muet n'est pas tracé.
- `decoder` : `gap_strong_llr_per_frame`, `gap_min_text_similarity`, `gap_weak_text_similarity`, `gap_max_search_s`.

## Limites (dites franchement)
- **Le mot « بسم » de 1:1 (cas 1)** reste absent : l'hypothèse `head` 1:1 [1-1] obtient −0,84 par trame (un mot dans
  2,2 s), sans transcription : sous le seuil des mots seuls (−0,5). Refusé plutôt que deviné.
- Seuils provisoires (−0,5, 0,3, 4 nats/mot, 3 nats, 15 %), mesurés sur 11 fichiers et 216 versets : à calibrer sur
  des annotations (étape A).
- Un seul verset nommé par hypothèse retenue et par trou ; les trous se traitent de proche en proche.
- Des trous dont le texte vrai n'est pas déduit du contexte (autre sourate, hors Mushaf) ne sont pas comblés.
- Coût : un treillis et une dizaine d'alignements courts par trou ayant de la parole ; temps mesuré dans le bruit
  de la machine (lot1-06 257 → 243 s, lot2-12 238 → 192-343 s), voir le rapport.
