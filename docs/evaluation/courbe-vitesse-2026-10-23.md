# Courbe de vitesse : réécouter à vitesse accélérée aide-t-il sur une récitation lente ? — 2026-10-23

Statut : **règle de décision écrite, mesure non lancée.** Cette section est commitée AVANT la
première mesure, comme dans la campagne précédente (`courbe-degradation-2026-10-23.md`) ; le
rapport complet la remplace quand la mesure est faite, sans toucher à la règle.

## Question

La campagne de dégradation a montré que le moteur seul tient jusqu'à ×0,6 sur EveryAyah étiré
(95,9 %) et casse plus bas (×0,4 : 76,7 %, ×0,3 : 41,1 %), et qu'une réécoute de l'audio ACCÉLÉRÉ du
facteur inverse remonte ×0,3 à 97,3 %, mais avec le facteur **connu** (un majorant). Trois questions :

1. Sur de VRAIES récitations lentes (débit mesuré 0,41-0,50 mot/s contre ≈ 1 mot/s en prière
   normale), accélérer l'audio change-t-il ce que le moteur reconnaît, et de combien ?
2. Sur des témoins à vérité connue, où est l'optimum de compensation et correspond-il à l'inverse de
   l'étirement ?
3. Le facteur est-il **estimable sans vérité**, assez bien pour que la compensation tienne ses
   promesses ?

## Règle de décision (écrite avant la mesure)

Constantes dans `aqr.eval.speed_curve.SPEED_RULE`, appliquées par `temoin_verdict`, `real_verdict`
et `decide_speed` (testées dans `tests/unit/test_speed_curve.py`). Un étage « candidat de vitesse »
dans la cascade n'est implémenté QUE si les deux parties tiennent.

**Compensation avec facteur estimé.** Le facteur n'est jamais donné. Pour chaque fichier, la première
passe (moteur seul, ×1,0) fournit un débit ; l'estimateur le divise par le débit typique d'une
récitation normale ; si le rapport est inférieur à 0,75, le facteur de compensation est la valeur de
la grille {1,25 ; 1,5 ; 2 ; 2,5 ; 3 ; 4} la plus proche de l'inverse du rapport (échelle
logarithmique) ; sinon ×1,0 (aucune compensation).

**(i) Témoins, vérité exacte (EveryAyah étiré).** Aux étirements ×0,4 et ×0,3, le rappel (versets
attendus nommés `recognized` / attendus, 9 fichiers) avec le facteur ESTIMÉ gagne au moins **10
points** sur le rappel sans compensation, avec **0 faux verset**. Aux autres étirements (propre,
×0,8, ×0,6, ×0,5), le facteur estimé n'ajoute aucun faux verset et ne fait pas perdre plus de 2
points.

**(ii) Vrais lents, sans vérité.** Le facteur estimé fait apparaître, sur AU MOINS UN des vrais
fichiers lents, au moins **3 versets distincts** absents de la référence (×1,0, moteur seul), chacun
**soutenu par l'audio d'origine** : le texte du corpus du verset, aligné sur l'audio ORIGINAL (échelle
d'origine, marge de 0,5 s de part et d'autre de l'intervalle rapporté) atteint `llr` par trame ≥ −1,0,
le seuil de la cascade (`AcousticVerifier.supports`, ADR-0008/0009). ET sur chacun des fichiers sans
Coran (`lot1-09`, `lot2-11`, `lot2-12`), **0 verset nouveau** soutenu, à n'importe quel facteur de la
grille. L'étage ajoute des candidats sans jamais en retirer : aucun verset de la référence ne disparaît.

**Si la règle n'est pas satisfaite** : aucune implémentation ; rapport et recommandation chiffrée
seulement.

**Estimateurs comparés** (tous sans vérité ; calibrés par récitant exclu, c'est-à-dire que le débit
typique d'un fichier propre est la médiane des fichiers des deux AUTRES récitants, jamais le sien) :
(a) mots par seconde des intervalles `recognized` de la première passe (au moins 3 mots), et la
variante en lettres du corpus par seconde ; (b) taux de trames non blanches du CTC dans les fenêtres
de parole ; (c) mots par seconde émis par l'ASR dans ces fenêtres (indépendant de la décision des
versets). L'estimateur retenu pour la règle (i) est celui de plus petite erreur relative médiane sur
les témoins ralentis (étirements ≤ ×0,8), choisi parmi ces quatre ; la sélection sur ces mêmes
fichiers est une limite assumée, un seul scalaire par estimateur étant calibré.

## Grille

- **Témoins** : les 9 sourates reconstituées de la campagne de dégradation (73 versets, 12,6 min),
  étirées à ×1,0 (propre), ×0,8, ×0,6, ×0,5, ×0,4, ×0,3, puis accélérées de ×1,0 ; 1,25 ; 1,5 ; 2 ;
  2,5 ; 3 ; 4 (`atempo`, hauteur conservée ; cellules dont la vitesse nette dépasse ×3,2 omises) :
  41 cellules. Vérité = celle de l'étirement (début et fin ÷ étirement) ; les temps rendus sont
  multipliés par le facteur d'accélération pour revenir à cette échelle.
- **Vrais fichiers** : `lot3-01` à `lot3-06`, `lot1-05`, `lot2-07` ; **sans Coran** : `lot1-09`,
  `lot2-11`, `lot2-12` ; facteurs ×1,0 (référence) ; 1,25 ; 1,5 ; 2,0 ; 2,5.

## Limites annoncées d'avance

- Aucune vérité terrain humaine sur les vrais fichiers : tout y est proxy (versets distincts, suites
  sans trou, temps d'abstention, soutien acoustique). Un verset « soutenu » est un verset dont le texte
  s'aligne sur l'audio, pas un verset vérifié à l'oreille.
- Les témoins sont des récitations normales ralenties par algorithme : une récitation lente réelle
  (mélodique, maqam, voyelles étirées, répétitions) n'a pas la même structure.
- 9 fichiers, 73 versets : un cran de ±2 à 3 versets sépare des conditions équivalentes.
