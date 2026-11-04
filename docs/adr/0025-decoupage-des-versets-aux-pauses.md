# ADR-0025 — Un verset s'affiche en plusieurs temps, là où le récitant s'arrête

- Statut : **accepté** — demande du mainteneur du 2026-11-04 (la vidéo exportée ne doit pas poser un long verset d'un bloc).
  Respecte I1 (l'arabe n'est que découpé aux frontières de mots) et I2 (la traduction n'est que découpée, jamais réécrite).

## Contexte

Avant ce changement, un verset était une seule carte pendant tout son intervalle. Dans la vidéo, un verset long (Al-Baqara 2:282,
24 mots) se réduisait jusqu'au plancher de 40 % de la mise en page par blocs (ADR-0018) ou débordait ; les sous-titres, eux, ne
coupaient qu'à la durée maximale `max_s`, jamais à une pause du récitant.

## Ce que disent les données (le point qui décide de la méthode)

Les temps au mot de l'alignement forcé sont **contigus** : « un mot dure jusqu'au début du suivant, les blancs qui suivent un
symbole CTC appartiennent au son tenu » (`src/aqr/alignment/forced.py`, `_timed`). Une pause n'apparaît donc pas comme un trou entre
deux mots, mais comme **un mot anormalement long**. Les temps `interpolated` ne portent aucune information de pause (ils sont
proportionnels aux lettres).

## Décision

1. **Détection** (`pause_after`, `pauseAfter`) : sur des temps mesurés (`ctc-alignment`) seulement. Le débit est la médiane des
   secondes par lettre du verset ; le silence d'un mot est son excédent sur ce débit plus le trou éventuel qui le sépare du suivant ;
   à partir de `pause_s` (0,6 s par défaut) c'est une pause. Sans temps mesurés, aucune pause n'est inventée.
2. **Coupe** (`_chunks`, `chunkRanges`) : après chaque pause ; puis au plafond `max_s` (7 s), de préférence après un signe d'arrêt
   permis du Mushaf (ۗ ۘ ۚ ۛ, pas ۙ ni ۖ) si le morceau couvre déjà la moitié du plafond ; un morceau plus court que `min_s` est
   rattaché à son voisin.
3. **Traduction** : les tranches `segments` de QuranEnc (exactes) ; sinon coupe au prorata des mots, **signalée** (`approximate`).
4. **Deux implémentations, une règle** : Python pour les sous-titres, TypeScript pour la vidéo (rendue dans le navigateur). Elles lisent
   les mêmes cas (`tests/fixtures/export-pauses/cases.json`), y compris l'arrondi de Python (la moitié va au pair).
5. **Réglable** : `pause_split` (vrai) et `pause_s` côté moteur et API d'export ; la vidéo utilise `DEFAULT_SPLIT`
   (`web/lib/export-video-split.ts`). Le surlignage mot à mot de chaque carte ne porte que ses mots.

## Limites assumées

- Un madd très long peut dépasser le seuil et être pris pour une pause : le verset est alors coupé à un endroit sans arrêt réel. Le coût est
  esthétique (l'affichage change de carte), jamais textuel.
- Un silence plus court que `pause_s` ne coupe pas. Seuil provisoire, à calibrer sur des récitations réelles annotées.
- Une pause **plus courte** que le débit d'un mot n'est pas visible tant que les temps au mot restent contigus. La mesure exacte (fin de
  voix du mot par l'énergie, déjà calculée pour les versets) demande de publier une fin de mot distincte dans `aqr.recognition` :
  changement de contrat, hors de ce lot.
