# ADR-0029 — Un verset n'est coupé que là où la traduction se coupe exactement

- Statut : **remplacé par l'ADR-0031** (2026-11-21 : mesure réelle du mainteneur, le découpage reste défaillant ; aucun verset n'est coupé par défaut).
  Était : accepté — demande du mainteneur du 2026-11-17. **Amende l'ADR-0025** (points 2 et 3). Respecte I1, I2 et I3.
  (Numéro 0029 : le 0027 est pris par la parole libre, le 0028 par les réglages par vidéo.)

## Contexte

Avec l'ADR-0025, un long verset est coupé en plusieurs cartes aux pauses du récitant, mais la traduction était coupée **au prorata des
mots** quand QuranEnc ne fournissait pas de tranches alignées, ou rattachée à la carte portant le plus de mots arabes d'une tranche qui
chevauchait plusieurs cartes. Résultat observé sur un verset en sept morceaux : seul le plus grand morceau recevait une traduction, les
petits n'en avaient pas, et le texte affiché n'était pas celui de ce qui est récité. Contraire à I2 (aucune réécriture de traduction) dans
l'esprit, et à I3 (un à-peu-près est pire que rien).

## Décision

1. **Moins de coupes.** Pause à partir de 0,9 s (au lieu de 0,6) ; une carte issue d'une coupe dure au moins 2 s
   (`MIN_CARD_S`, au lieu du 1 s de `min_s`). Les arrêts du Mushaf et le plafond `max_s` restent des candidats de coupe.
2. **Coupe seulement à la fin d'une tranche exacte.** Les coupes candidates sont filtrées par `align_to_segments` (Python) /
   `alignToSegments` (TypeScript) : une coupe est gardée si aucune tranche QuranEnc (`phrases`, sinon `segments`) ne la chevauche. Chaque
   carte porte alors des tranches entières, dont le texte est restitué tel quel. Plus aucune carte n'est sans traduction.
3. **Pas de tranches exactes, pas de coupe.** Si les tranches n'existent pas, ne couvrent pas tous les mots du passage, ou si aucune
   coupe ne tombe sur une fin de tranche, le verset reste **d'un bloc**, avec toute sa traduction, pendant toute sa durée. Le surlignage
   mot à mot (karaoké) de la carte entière continue de montrer les mots récités. Il n'y a plus de coupe au prorata (le champ
   `approximate` reste dans les types, toujours faux).
4. **Sans traduction à afficher** (traduction désactivée, verset sans traduction) : l'arabe garde les coupes de l'ADR-0025, rien ne
   contraint la coupe.
5. **Une règle, deux implémentations** : mêmes cas dans `tests/fixtures/export-pauses/cases.json` (champs `segments`, `first_word`,
   `aligned`), dont un verset de 24 mots en 7 morceaux. Les cartes plus longues que `max_s` sont acceptées quand c'est le prix d'une
   traduction exacte.

## Limites assumées

- Un verset long dont la traduction n'est pas découpée reste affiché d'un bloc : la lisibilité repose sur la mise en page par blocs
  (ADR-0018) et le surlignage mot à mot.
- Les seuils (0,9 s, 2 s) sont provisoires, à calibrer sur des récitations annotées.
