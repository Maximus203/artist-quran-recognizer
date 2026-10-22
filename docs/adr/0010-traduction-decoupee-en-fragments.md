# ADR-0010 — La traduction est découpée en fragments alignés sur les mots arabes

- Statut : accepté — 2026-10-23
- Précise : ADR-0001 (pas de LLM génératif), invariants I1-I3
- Mesures : `docs/evaluation/traduction-par-passage-2026-10-23.md`

## Problème
Pour un verset **partiel** (le récitant s'arrête, reprend, répète), l'arabe n'affiche que les mots entendus
mais la traduction affichée était celle du verset entier : elle « ne commençait pas au début de la lecture ».
Le mainteneur veut que la traduction ne s'affiche que pour la partie affichée en arabe, et que le surlignage
en direct associe chaque mot arabe à son fragment de traduction.

## Contrainte
I2 : la traduction QuranEnc est restituée **sans modification** (identifiant, version, attribution, note
`[1]` telle quelle). On peut la **découper** en tranches consécutives ; jamais la réécrire, la résumer ni la
traduire. Aucun modèle génératif dans la chaîne d'exécution (ADR-0001). I3 (analogue) : un fragment faux est
pire qu'un repli sur le verset entier.

## Décision
1. **Découpage hors ligne, déterministe** (`scripts/build_translation_segments.py`) : le français est coupé aux
   ponctuations (`, ; : . ! ?`, hors parenthèses et crochets ; guillemet fermant et marque `[n]` restent sur la
   tranche qui précède) en propositions candidates ; une programmation dynamique les place dans l'ordre sur
   les mots arabes. Score d'une proposition sur une plage de mots : vraisemblance **IBM-1** dans les deux sens
   (arabe → français, français → arabe, appris sur les 6 236 versets, sans étiquette), écart de longueur
   (Gale et Church), bonus après un signe de pause du Mushaf, prior de début/fin de proposition appris sur
   ces signes de pause. Un passage avant-arrière donne la probabilité a posteriori de chaque frontière.
2. **Précision d'abord** : une frontière n'est gardée que si (a) sa place est sûre à un mot près avec une
   probabilité ≥ 0,95, (b) les modèles avant seul, arrière seul et combiné la placent au même endroit, (c)
   une seconde chaîne (autre normalisation des mots) la retrouve. Sinon les deux propositions voisines
   fusionnent — la moins sûre d'abord — et le calcul recommence : le repli est une tranche plus large, jamais
   une frontière douteuse. Tous les seuils sont dans `TranslationAlignmentConfig`.
3. **Données sans texte** : `data/translation-segments/<translation_id>.json` ne contient que des numéros de
   mots, des offsets de caractères, des confiances et l'**empreinte SHA-256** (64 bits) du texte français de
   chaque verset. À la lecture, le renderer vérifie l'empreinte et le nombre de mots arabes : traduction ou
   corpus modifié → pas de découpage pour ce verset (repli), jamais de décalage silencieux.
4. **Contrat additif** (`aqr.recognition/1` reste lisible) : `translation.segments`, `translation.fragment`,
   `translation.scope: "fragment" | "verse"` (voir `docs/RECOGNIZE-OUTPUT.md`). `text` reste le verset entier.
   Les « … » de bord sont des drapeaux séparés (`ellipsis_before/after`), jamais dans `text`.
5. **Sélection du fragment** (`FragmentPolicy`, runtime) : réunion des segments qui recouvrent la plage
   affichée ; un segment de bord couvert à moins de la moitié est écarté ; au-delà d'un débordement égal à la
   largeur de la plage, ou si le fragment est le verset entier, repli sur `scope: "verse"`.

## Alternatives écartées
- **Un LLM qui découpe ou résume** : viole ADR-0001 et I2.
- **Règles de ponctuation seules** : on sait où couper le français, pas à quel mot arabe cela répond.
- **Alignement par plongements multilingues** (SimAlign-like) : un modèle de plus à embarquer, non mesuré sur
  le coranique ; l'IBM-1 est de l'arithmétique, reproductible, auditable.
- **Découper à l'exécution** : le calcul prend ~3 min et apprend sur tout le Coran ; il se fait une fois, la
  sortie se versionne (diff lisible, une ligne par verset).
- **Rendre les « … » dans `text`** : modifierait la traduction (I2).

## Conséquences
- 69,5 % des versets (83,8 % des mots arabes) ont un découpage ; sur 732 intervalles partiels de 53 sessions
  réelles, 75 % reçoivent un fragment (41 % exact), 25 % le repli.
- Frontières sûres **à un mot près** (90,5 % exactes, 99,4 % à ±1 sur 169 frontières relues) ; une inversion
  d'ordre du français produit une frontière fausse (1 sur 169) que rien ne détecte : limite assumée, documentée.
- Une autre traduction se découpe avec la même commande ; ses réglages sont à relire.
- Le runtime n'importe ni numpy ni l'outillage (`aqr.rendering.translation_segments` est en Python pur).
- Le découpage vit hors de la décision du moteur : il n'affecte ni les temps, ni les statuts, ni le texte arabe.
