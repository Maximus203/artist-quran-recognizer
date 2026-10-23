# Courbe de vitesse : réécouter à vitesse accélérée aide-t-il sur une récitation lente ? — 2026-10-23

Statut : **mesure terminée, étage NON implémenté** (la règle de décision n'est pas satisfaite).
La règle a été écrite et commitée **avant** la première mesure (commit `f153e8f`, 08:44 ; premier calcul
08:50) et n'a pas bougé. Seule la grille des témoins a été élargie avant le premier calcul, de 41 à 42
cellules (commit `c65a1b5`) : les constantes de la règle sont celles du premier commit.

**Moteur mesuré : `develop` @ `669f6c3`**, moteur principal seul (`--asr fastconformer`), neuf sourates
EveryAyah étirées (vérité exacte) et onze vrais fichiers (sans vérité). Les chiffres sur EveryAyah relèvent
de la décision d'usage provisoire du mainteneur (`docs/data-lots/ref-corpus-provenance.md`) : évaluation
interne locale, audio et dérivés hors dépôt.

## En bref

- **Décision appliquée : pas d'étage « candidat de vitesse »** dans la cascade. La partie (i) de la règle
  (témoins) tient de justesse ; la partie (ii) (vrais fichiers) ne tient pas.
- **(i) Témoins, facteur ESTIMÉ.** L'estimateur retenu (lettres du corpus par seconde de verset aligné,
  erreur relative médiane 26,5 %) gagne **+11,0 points à ×0,4** (76,7 % → 87,7 %, 56 → 64 versets sur 73)
  et **+21,9 points à ×0,3** (41,1 % → 63,0 %), **0 faux verset**. Le seuil était de 10 points : la marge est
  d'un verset. Le facteur connu le plus proche de l'inverse de l'étirement donne 94,5 % et 91,8 %.
- **(ii) Vrais lents.** Un seul fichier gagne nettement : `lot3-04` (Fatiha à Baqara), **+8 versets soutenus
  par l'audio d'origine** à ×1,5 (34 → 42 versets distincts, temps non reconnu 15,2 % → 0,8 %). Les autres
  lents ne bougent pas (`lot3-05`, `lot3-06`, `lot1-05`), gagnent 0 à 2 versets (`lot2-07`, `lot3-03`) ou
  reculent (**An-Naml, `lot3-02` : 8 → 7 versets**). **La clause « aucun verset nouveau sur un fichier sans
  Coran » est violée par `lot1-09` : 1 verset nouveau soutenu à ×1,5**, 11:105 [8-10], qui prolonge exactement
  la suite 11:106-108 déjà reconnue à ×1,0 dans le même cours. C'est très probablement un vrai verset cité (le
  « sans Coran » du lot 1 contient des citations), mais la règle, écrite d'avance, ne le permet pas : le
  verdict est appliqué tel quel.
- **Ce n'est pas seulement la règle.** Un prototype (non livré, branche `wip/etage-vitesse`) a été mesuré
  dans la cascade complète : sur 7 fichiers, **0 verset distinct de plus** avec l'oreille accélérée qu'avec la
  cascade seule (la réécoute par Whisper et Muno rattrape déjà ce que le facteur ×1,5 rattrape sur `lot3-04` :
  40 versets dans les deux cas). Le gain de la partie (ii) est mesuré contre le moteur seul, pas contre la
  cascade, qui est le produit.
- **Découverte : l'optimum de compensation n'est pas l'inverse de l'étirement.** Le moteur préfère un audio
  **un peu plus rapide que la normale** : le meilleur rappel est à une vitesse nette de ×1,2 à ×1,6 (×0,4
  compensé ×4 : 100 % ; ×0,6 compensé ×2,5 : 100 % ; le propre accéléré ×1,5 : 98,6 %).
- **An-Naml ne manque pas de vitesse.** Accélérer de ×1,25 à ×2,5 ne change ni les versets (8, 8, 7, 7, 7) ni
  le temps non reconnu (42,8 % → 39,0 % à ×1,5, puis 45,9 % et 57,6 %), et rien n'est récupéré (voir plus
  bas).
- **Coût.** Une passe du moteur seul sur audio accéléré coûte *moins* qu'une passe à ×1,0 (l'audio est plus
  court) : RTF 0,010 à 0,023 aux étirements ×0,4 et ×0,3. Dans la cascade, le temps de réécoute du
  prototype varie de −33 % à +11 % selon le fichier : du bruit de mesure sur une GPU partagée.
- **Temps de calcul** : 40 min pour la campagne (témoins 25 min et vrais fichiers 40 min, en parallèle),
  2 min d'arbitrage, 12 min pour le prototype.

## Règle de décision (écrite avant la mesure)

Constantes dans `aqr.eval.speed_curve.SPEED_RULE`, appliquées par `temoin_verdict`, `real_verdict` et
`decide_speed` (`tests/unit/test_speed_curve.py`).

- **Facteur estimé.** Pour chaque fichier, la première passe (×1,0) donne un débit ; divisé par le débit
  typique d'une récitation normale, il donne un rapport ; sous 0,75, le facteur est la valeur de la grille
  {1,25 ; 1,5 ; 2 ; 2,5 ; 3 ; 4} la plus proche de l'inverse du rapport (échelle logarithmique) ; sinon ×1,0.
- **(i) Témoins.** À ×0,4 et ×0,3, le rappel avec le facteur estimé gagne au moins 10 points sur le rappel
  sans compensation, avec 0 faux verset ; aux autres étirements, il n'ajoute aucun faux verset et ne fait
  pas perdre plus de 2 points.
- **(ii) Vrais lents.** Sur au moins un vrai fichier lent, le facteur estimé fait apparaître au moins 3
  versets distincts absents de la référence (×1,0, moteur seul), chacun soutenu par l'audio d'origine
  (`llr` par trame ≥ −1,0, `AcousticVerifier.supports`) ; et sur chacun des fichiers « sans Coran »
  (`lot1-09`, `lot2-11`, `lot2-12`), 0 verset nouveau soutenu à n'importe quel facteur.
- **Estimateur** : celui de plus petite erreur relative médiane sur les témoins ralentis, choisi parmi
  quatre, calibré par récitant exclu (le débit typique d'un fichier est la médiane des fichiers des deux
  autres récitants).

| Partie | Résultat | Verdict |
|---|---|---|
| (i) témoins, estimateur en lettres par seconde | ×0,4 : +11,0 points ; ×0,3 : +21,9 ; faux 0 ; autres étirements : aucune perte | **tient** (marge : 1 verset sur 73) |
| (ii) au moins 3 versets nouveaux soutenus sur un lent | `lot3-04` : 8 à ×1,5 | tient |
| (ii) 0 verset nouveau soutenu sur les fichiers sans Coran | `lot1-09` : 1 (11:105 [8-10]) ; `lot2-11`, `lot2-12` : 0 | **ne tient pas** |
| Décision | | **ne pas implémenter l'étage** |

## 1. Témoins à vérité connue

Neuf sourates EveryAyah (trois récitants), 73 versets, 12,6 minutes, étirées sans changement de hauteur puis
accélérées (`atempo`) ; 42 cellules, moteur seul ; temps rendus ramenés à l'échelle de l'étirement (multipliés
par le facteur d'accélération) avant notation. Rappel = versets attendus `recognized` / attendus (73).

| Étirement \ compensation | ×1 | ×1,25 | ×1,5 | ×2 | ×2,5 | ×3 | ×4 |
|---|---|---|---|---|---|---|---|
| ×1 (propre) | 95,9 % | 94,5 % | 98,6 % | 97,3 % | 89,0 % | 63,0 % | 8,2 % |
| ×0,8 | 95,9 % | 97,3 % | 97,3 % | 98,6 % | 94,5 % | 86,3 % | 37,0 % |
| ×0,6 | 95,9 % | 98,6 % | 97,3 % | 97,3 % | 100,0 % | 98,6 % | 87,7 % |
| ×0,5 | 93,2 % (1 faux) | 95,9 % | 95,9 % | 95,9 % | 94,5 % | 98,6 % | 94,5 % |
| ×0,4 | 76,7 % | 91,8 % (1 faux) | 91,8 % | 95,9 % | 94,5 % | 97,3 % | 100,0 % |
| ×0,3 | 41,1 % | 74,0 % | 89,0 % | 97,3 % | 95,9 % | 91,8 % | 100,0 % |

Le faux verset de ×0,5 sans compensation est le « 2:1 » d'un seul mot de la campagne précédente ; celui de
×0,4 compensé ×1,25 est un autre mot isolé. Aucune des 40 autres cellules n'a de faux verset.

- **Où est l'optimum.** Le meilleur rappel (à un verset près) n'est pas à l'inverse de l'étirement mais à une
  vitesse nette de ×1,2 à ×1,6 : ×0,5 compensé ×3 (net ×1,5), ×0,4 compensé ×4 (net ×1,6), ×0,3 compensé ×4
  (net ×1,2), ×0,6 compensé ×2,5 (net ×1,5), propre compensé ×1,5 (net ×1,5). L'inverse exact (net ×1,0)
  est presque toujours à 2 à 4 points de l'optimum. Sur-accélérer ruine tout : le propre à ×3 tombe à 63 %,
  à ×4 à 8 %. Hypothèse non vérifiée : le moteur a vu surtout des récitations rapides.
- **La compensation ne coûte presque rien aux vitesses normales** : le propre perd au pire 1,4 point (×1,25)
  et gagne 2,7 points à ×1,5 (bruit de mesure : ±2 à 3 versets).

### L'estimateur : mesurer le débit sans vérité

Rapport médian estimé (débit du fichier étiré / débit typique des autres récitants), sur les 9 fichiers,
première passe à ×1,0. La vérité est l'étirement (première ligne d'en-tête).

| Estimateur | ×1 | ×0,8 | ×0,6 | ×0,5 | ×0,4 | ×0,3 | Erreur relative médiane | Erreur max |
|---|---|---|---|---|---|---|---|---|
| mots par seconde des intervalles reconnus | 0,98 | 0,79 | 0,59 | 0,49 | 0,51 | 0,34 | 31,1 % | 107 % |
| **lettres du corpus par seconde des intervalles reconnus (retenu)** | 1,06 | 0,85 | 0,64 | 0,53 | 0,46 | 0,35 | **26,5 %** | 100 % |
| taux de trames non blanches du CTC | 0,99 | 0,94 | 0,82 | 0,72 | 0,56 | 0,30 | 41,6 % | 180 % |
| mots émis par l'ASR par seconde de fenêtre | 0,98 | 0,79 | 0,59 | 0,50 | 0,41 | 0,28 | 30,1 % | 71 % |

- La médiane est bonne pour les trois estimateurs fondés sur les mots ou les lettres ; l'erreur *par fichier*
  est grande (jusqu'à 100 %) : les débits propres vont de 2,1 à 3,7 lettres/s selon le fichier, la médiane
  des autres récitants est une référence grossière. Le débit typique est de 3,2 lettres/s, soit 0,80 mot/s
  (EveryAyah murattal), pas 1 mot/s.
- Le taux de trames non blanches du CTC ne suit la vitesse qu'aux étirements extrêmes (0,94 pour un vrai 0,8) :
  il dépend trop du récitant.
- **Gain avec le facteur ESTIMÉ** (règle (i)), rappel sans compensation → avec le facteur estimé :

| Estimateur | ×1 | ×0,8 | ×0,6 | ×0,5 | ×0,4 | ×0,3 | Faux |
|---|---|---|---|---|---|---|---|
| mots par seconde (reconnus) | 95,9 → 97,3 | 95,9 → 98,6 | 95,9 → 98,6 | 93,2 → 98,6 | 76,7 → 87,7 (+11,0) | 41,1 → 65,8 (+24,7) | 0 |
| **lettres par seconde (retenu)** | 95,9 → 97,3 | 95,9 → 98,6 | 95,9 → 98,6 | 93,2 → 98,6 | **76,7 → 87,7 (+11,0)** | **41,1 → 63,0 (+21,9)** | 0 |
| trames non blanches du CTC | 95,9 → 95,9 | 95,9 → 98,6 | 95,9 → 97,3 | 93,2 → 97,3 | 76,7 → 97,3 (+20,5) | 41,1 → 100,0 (+58,9) | 1 (×0,5) |
| mots émis par l'ASR | 95,9 → 97,3 | 95,9 → 98,6 | 95,9 → 100,0 | 93,2 → 98,6 | 76,7 → 100,0 (+23,3) | 41,1 → 98,6 (+57,5) | 0 |
| facteur connu (le plus proche de l'inverse) | 95,9 → 95,9 | 95,9 → 97,3 | 95,9 → 97,3 | 93,2 → 95,9 | 76,7 → 94,5 | 41,1 → 91,8 | 0 |

  Le facteur « connu » le plus proche de l'inverse fait moins bien que plusieurs estimateurs parce que
  l'optimum est au-delà de l'inverse (voir plus haut) et que ces estimateurs, qui sous-estiment la vitesse à
  ×0,3 et ×0,4, tombent sur des facteurs plus grands. **L'estimateur le plus utile n'est pas celui que la règle
  retient** : les mots émis par l'ASR par seconde de fenêtre (+23,3 et +57,5 points) ne demandent aucun verset
  reconnu, donc fonctionnent là où rien n'est reconnu. Le choisir maintenant serait un réglage après coup sur
  les témoins ; à mesurer sur du réel avant tout usage.

## 2. Vrais fichiers lents (proxys, aucune vérité)

Moteur seul, aux cinq facteurs ; référence = ×1,0. « Nouveaux » = versets distincts absents de la référence ;
« soutenus » = alignement du texte du corpus sur l'audio d'ORIGINE (intervalle ± 0,5 s), `llr` par trame
≥ −1,0. « Non reconnu » = temps des intervalles d'abstention / durée. Facteur choisi par l'estimateur retenu
(débit typique : médiane des 9 sourates propres).

| Fichier (durée) | Débit (mots/s) | Rapport estimé | Facteur choisi | Versets distincts ×1 / 1,25 / 1,5 / 2 / 2,5 | Non reconnu ×1 → meilleur facteur | Nouveaux soutenus au facteur choisi | Cascade de référence (23/10) |
|---|---|---|---|---|---|---|---|
| `lot3-01` (0,7 min) | 0,37 | 0,56 | ×2 | 5 / 5 / 0 / 0 / 0 | 6,5 % → 0,0 % (×1,25) | 0 | 5 |
| `lot3-02` An-Naml (9,3 min) | 0,42 | 0,53 | ×2 | 8 / 8 / 7 / 7 / 7 | 42,8 % → 39,0 % (×1,5) | 0 | 8 (33,9 % non reconnu) |
| `lot3-03` Yusuf (12,3 min) | 0,45 | 0,60 | ×1,5 | 13 / 13 / 13 / 12 / 13 | 18,6 % → 12,8 % (×2,5) | 0 | 14 |
| `lot3-04` Fatiha-Baqara (23,4 min) | 0,44 | 0,62 | ×1,5 | 34 / 32 / **42** / **42** / 36 | 15,2 % → **0,8 %** (×1,5) | **8** | 40 |
| `lot3-05` (29,3 min) | 0,45 | 0,59 | ×1,5 | 26 / 26 / 26 / 26 / 26 | 0,2 % | 0 | 26 |
| `lot3-06` (28,9 min) | 0,46 | 0,58 | ×1,5 | 30 / 30 / 30 / 30 / 30 | 0,5 % | 0 | 30 |
| `lot1-05` (28,5 min) | 0,50 | 0,64 | ×1,5 | 38 / 38 / 38 / 38 / 38 | 1,2 % | 0 | 38 |
| `lot2-07` (6,2 min) | 0,55 | 0,70 | ×1,5 | 1 / 1 / **3** / 2 / 1 | 75,0 % → 61,1 % (×1,5) | **2** | 3 |

Suites sans trou : sur `lot3-04`, la part des versets reconnus en suites d'au moins deux passe de 91 % (×1,0)
à 98 % (×1,5) ; les cinq plus longues suites passent de 7, 6, 4, 3, 3 à 7, 7, 5, 4, 4 versets consécutifs. Les
versets nouveaux sont tous `recognized` (aucun incertain).

- **Le facteur optimal par fichier.** `lot3-04` : ×1,5 ou ×2 (+8 versets) ; `lot2-07` : ×1,5 (+2) ; `lot3-03` :
  ×2,5 (+1, avec 1 verset perdu à ×2 et à ×2,5) ; les cinq autres : aucun gain à aucun facteur. Le rapport de
  débit estimé ne prédit pas qui gagne : `lot3-05` a quasiment le rapport de `lot3-04` (0,59 contre 0,62) et ne
  gagne rien. Ce qui prédit le gain est le **temps non reconnu à ×1,0** : `lot3-04` (15 %) et `lot2-07` (75 %)
  ont de la marge ; `lot3-05`, `lot3-06` et `lot1-05` (≤ 1,2 %) sont déjà entièrement reconnus à 0,45-0,5 mot/s.
  **Un récitant lent n'est pas un récitant que le moteur n'entend pas.**
- **La compensation du fichier entier peut tout perdre.** `lot3-01` (41 s) : 5 versets à ×1,0 et ×1,25, **0 à
  ×1,5 et au-delà** (94,7 % de temps non reconnu) ; `lot3-04` perd 6 versets de la référence à ×2,5. Le
  principe « union, jamais substitution » (ne garder que des versets nouveaux et soutenus) est nécessaire.
- **Le moteur seul à ×1,5 fait aussi bien que la cascade à ×1,0 sur `lot3-04`** (42 contre 40 versets) :
  l'accélération ne fait pas mieux que Whisper et Muno réunis, elle rattrape les mêmes fenêtres autrement.

### An-Naml (`lot3-02`) : la vitesse n'est pas le verrou

| Facteur | Versets distincts | Intervalles reconnus | Non reconnu | Fenêtres | Mots émis par l'ASR | Fenêtres abstenues `below_threshold` | Durée médiane de ces fenêtres | Score médian du matcher sur elles |
|---|---|---|---|---|---|---|---|---|
| ×1 | 8 | 11 | 42,8 % | 58 | 293 | 26 | 3,6 s | 0,15 |
| ×1,25 | 8 | 12 | 42,3 % | 59 | 285 | 28 | 3,4 s | 0,20 |
| ×1,5 | 7 | 13 | 39,0 % | 51 | 268 | 17 | 4,6 s | 0,20 |
| ×2 | 7 | 12 | 45,9 % | 36 | 231 | 13 | 11,9 s | 0,33 |
| ×2,5 | 7 | 8 | 57,6 % | 28 | 205 | 13 | 23,3 s | 0,45 |

- Les versets reconnus sont les mêmes à ×1,0 et ×1,25 (27:15 à 27:22), un de moins ensuite (27:20 disparaît
  à ×1,5). Le temps non reconnu ne baisse pas durablement. À ×2 et ×2,5 les fenêtres abstenues sont moins
  nombreuses mais bien plus longues (médiane 12 puis 23 s), leur score monte parce qu'il reste moins de
  fenêtres, et les mots reconnus passent de 119 à 74 : rien n'est récupéré. Le moteur émet de moins en moins
  de mots à mesure que l'audio accélère (293 → 205). La cascade (Whisper, Muno) n'y change rien non plus
  (8 versets, 33,9 % non reconnu), ni le prototype avec oreille accélérée (8 versets, 31,3 %).
- Le fichier est une lecture mélodique où le même passage revient (27:22 reconnu à trois reprises, à 444, 490
  et 541 s) ; les 67 premières secondes ne donnent rien ; des fenêtres abstenues de 14 à 24 s côtoient des
  fragments très courts (médiane 3,6 s) à ×1,0.
  **Hypothèse non vérifiée** : les voyelles tenues et les reprises mélodiques (maqam) font entendre au modèle
  des phrases qui ne ressemblent à aucun verset. Ce n'est pas un problème de débit (le débit, 0,42 mot/s, est
  voisin de celui de `lot3-05`, entièrement reconnu à 0,45) ; la segmentation (fenêtres très inégales) peut
  y contribuer, mais l'accélération la change déjà (58 → 28 fenêtres) sans rien récupérer. La preuve définitive exige d'annoter une ou deux
  minutes de ce fichier. Un test d'alignement forcé du texte de 27:15 sur la zone abstenue (0,7-67 s) a été
  tenté et n'est pas concluant : le texte d'un verset sans rapport (27:30, 2:255) obtient `llr` −0,5 à −0,6
  sur 67 s, comme le bon (−0,4). L'arbitre ne discrimine pas sur une fenêtre bien plus longue que le texte.

### Fichiers sans Coran

| Fichier | Versets distincts ×1 / 1,25 / 1,5 / 2 / 2,5 | Nouveaux soutenus |
|---|---|---|
| `lot1-09` (30 min, cours) | 5 / 5 / 6 / 0 / 0 | **1 à ×1,5 : 11:105 [8-10]** |
| `lot2-11` (15 min) | 0 / 0 / 0 / 0 / 0 | 0 |
| `lot2-12` (55 min) | 5 / 2 / 1 / 0 / 0 | 0 |

- Aucun verset nouveau sur `lot2-11` ni `lot2-12`. Au-delà de ×1,5, la parole non coranique fait *perdre* tous
  les versets de la référence (`lot1-09` : 5 → 0 ; `lot2-12` : 5 → 0) : la compensation seule n'est pas un
  traitement sûr, l'union avec la décision du moteur principal le serait.
- **Le seul cas qui viole la règle est probablement un vrai verset.** 11:105 [8-10] est reconnu à
  646,6-652,1 s, juste avant 11:106 [1-9] (652,6 s), 11:107 et 11:108, déjà reconnus à ×1,0 dans la même
  suite ; `llr` −0,82 (seuil −1,0). Le lot 1 « sans Coran » est un cours qui cite des versets : l'étiquette
  était trop forte (`cascade-2026-10-20.md` parlait de fichiers « sans Coran récité »), pas la mesure. Aucune
  écoute n'a eu lieu : c'est une inférence (suite cohérente + alignement), pas une vérité.

## 3. Prototype (non livré)

L'étage a été réalisé en prototype pendant la campagne, avant que le verdict (ii) soit connu, sous TDD, **hors
de cette PR** (branche `wip/etage-vitesse`, non fusionnée) : débit en lettres par seconde sur les versets placés
de la première passe, facteur choisi dans la grille, oreille accélérée (le moteur principal sur la fenêtre
accélérée par `atempo`, temps ramenés à l'échelle d'origine) en tête de la réécoute des fenêtres douteuses,
versets nouveaux arbitrés par `AcousticVerifier.supports` sur l'audio d'origine (`acoustic_checks`,
`kind=relisten-speed`), budget de temps de la réécoute. Mesuré dans la cascade complète, avec et sans l'oreille
accélérée, sur le même code (le débit estimé dans la cascade retrouve celui de la campagne : 0,53 contre 0,53
pour An-Naml, 0,66 contre 0,62 pour `lot3-04`).

| Fichier | Versets distincts sans → avec | Temps non reconnu sans → avec | Fenêtres sauvées sans → avec | Facteur | Temps de réécoute sans → avec |
|---|---|---|---|---|---|
| `lot3-01` | 5 → 5 | 6,5 % → 6,5 % | 0 → 0 | ×1,5 | 0,7 s → 1,1 s |
| `lot3-02` An-Naml | 8 → 8 | 33,9 % → 31,3 % | 2 → 3 | ×2 | 33,9 s → 29,2 s |
| `lot3-03` | 14 → 14 | 7,7 % → 7,7 % | 10 → 10 | ×1,5 | 31,9 s → 35,4 s |
| `lot3-04` | 40 → 40 | 6,3 % → 4,4 % | 6 → 8 | ×1,5 | 45,3 s → 39,3 s |
| `lot2-07` | 3 → 3 | 60,7 % → 60,7 % | 2 → 2 | ×1,5 | 20,3 s → 21,3 s |
| `lot1-09` (contrôle) | 5 → 5 | 84,1 % → 84,1 % | 0 → 0 | aucun (débit normal) | 174,5 s → 117,0 s |
| `lot2-11` (contrôle) | 0 → 0 | 78,4 % → 78,4 % | 0 → 0 | aucun | 21,2 s → 23,3 s |

**Aucun verset distinct de plus, aucun de moins, aucun faux sur les contrôles ; 2 fenêtres de plus sauvées
et 1,9 à 2,6 points de temps non reconnu en moins sur les deux fichiers difficiles.** Les écarts de temps
(−33 % à +11 %) sont dans le bruit d'une GPU partagée (`lot1-09`, où l'oreille accélérée ne s'active même
pas, passe de 174 à 117 s).
Sur `lot3-04`, les 8 versets de la partie (ii) sont déjà tous dans la cascade de référence.

## Recommandation chiffrée

1. **Ne pas livrer l'étage « candidat de vitesse »** en l'état. Coût de maintenance (ffmpeg en pipe, un nouveau
   moteur dans la cascade, un débit typique à recalibrer) pour un gain nul en versets distincts mesuré contre
   la cascade (0 sur 7 fichiers), et une clause de la règle violée par 1 des 3 fichiers de contrôle.
2. **Si le propriétaire requalifie `lot1-09` comme contenant du Coran cité** (11:105 à 11:108), la règle écrite
   tiendrait (les deux autres contrôles donnent 0). Cela ne change pas la recommandation 1 : le gain à
   vérifier est celui du prototype contre la cascade, et il est nul en versets.
3. **Les pistes à garder sont ailleurs que dans l'estimation d'un débit** : (a) l'optimum de compensation est
   à une vitesse nette de ×1,2 à ×1,6, pas à l'inverse de l'étirement — un candidat *systématique* à ×1,5 sur
   les fenêtres douteuses n'aurait besoin d'aucune estimation ; mais le prototype, qui accélérait au facteur
   estimé (×1,5 à ×2), n'a rien ajouté à la cascade, il faut donc d'abord un fichier réel que la cascade rate
   et que ×1,5 sauve ; (b) si un débit doit un jour être estimé, « mots émis par l'ASR par seconde de fenêtre »
   est l'estimateur le plus simple et le plus utile (+23,3 et +57,5 points sur les témoins à ×0,4 et ×0,3), à
   confirmer hors de la sélection faite ici.
4. **Les vrais lents ne justifient pas un fine-tuning à la vitesse** : trois des huit sont déjà à 0,2-1,2 % de
   temps non reconnu à 0,45-0,5 mot/s ; ceux qui ne le sont pas (An-Naml 43 %, `lot2-07` 75 %, `lot3-04` 15 %)
   sont limités par autre chose que le débit, ou déjà rattrapés par la cascade.
5. **Pour An-Naml et `lot2-07`** : annoter une ou deux minutes à la main (étape A du plan) est la seule façon
   de savoir si le verrou est le modèle (voyelles tenues, reprises), la segmentation, ou autre chose.

## Méthode (reproductible)

Source unique : `aqr.eval.speed_curve` (grille, règle, estimateurs, profil sans vérité) et
`scripts/measure_speed.py` (`prepare`, `run`, `support`, `report`). Aucun audio, aucune sortie lourde dans le
dépôt (sorties : dossier hors dépôt, un sous-dossier par cellule).

```bash
export PYTHONPATH=<worktree>/src AQR_MODELS_DIR=… AQR_AUDIO_DIR=… TMP=<disque assez grand> TEMP=$TMP
S="--out-dir $OUT/vitesse --derived-dir $AUDIO/_derived/vitesse --deg-derived $AUDIO/_derived/degradation \
   --audio-dir $AUDIO --corpus-dir data/corpus"
python scripts/measure_speed.py prepare --set temoins $S
python scripts/measure_speed.py prepare --set reel    $S
python scripts/measure_speed.py run --set temoins     $S
python scripts/measure_speed.py run --set reel        $S
python scripts/measure_speed.py support               $S
python scripts/measure_speed.py report                $S
```

- Accélération : `ffmpeg -nostdin -y -v error -i IN -af atempo=<facteur> -ac 1 -ar 16000 -c:a pcm_s16le
  OUT.wav` (ffmpeg 9.0 full build) ; le ×1,0 des vrais fichiers est un décodage à plat en 16 kHz mono. Les
  témoins étirés sont ceux de la campagne de dégradation (`lent_x*`), accélérés ensuite.
- Notation : `aqr.eval.degradation_curve.score_file` (faux versets comptés à part). Les temps rendus sur
  l'audio accéléré sont multipliés par le facteur (`rescale_document`, testé) avant notation ou comparaison.
- Statistiques CTC : chemin le plus probable du treillis du FastConformer dans chaque fenêtre envoyée au
  moteur ; mots ASR : mots émis par le moteur, par seconde de fenêtre.
- Chaque étape est reprenable (un résultat existant n'est pas refait). Le script n'utilise pas
  `scripts/recognize_batch.py` (`fcntl`, absent de Windows).

## Limites

- **Aucune vérité terrain sur les vrais fichiers.** Les « versets nouveaux soutenus » sont des versets dont
  le texte s'aligne sur l'audio, pas des versets vérifiés à l'oreille. Un faux verset soutenu par
  l'alignement reste possible (le seuil −1,0 est une calibration de la cascade, pas une garantie).
- **Les témoins sont des récitations normales ralenties par algorithme** : sans voyelles tenues, reprises ni
  mélodie. Ils montrent qu'un étirement uniforme est réparable, pas qu'une lenteur naturelle l'est.
- **La sélection de l'estimateur sur les témoins** (un parmi quatre, un scalaire chacun) est un réglage sur
  les mêmes fichiers ; le calibrage par récitant exclu la limite sans la supprimer. La marge d'un verset de la
  partie (i) est dans le bruit de mesure (±2 à 3 versets).
- **Référence = moteur seul**, comme la règle l'a écrit ; le produit est la cascade. Le prototype comble cet
  écart sur sept fichiers seulement.
- **Un seul débit typique** (EveryAyah murattal, 3,2 lettres/s) : une récitation rapide ou un récitant
  très lent d'une autre école changerait le rapport.
- **Arbitre sur fenêtre large.** `AcousticVerifier.supports` donne `llr` ≈ −0,5 à −0,6 à un verset sans
  rapport sur une fenêtre de 67 s : le seuil ne protège que pour des fenêtres proches de la durée du texte
  (cas de la cascade et de cette mesure : intervalle du verset ± 0,5 s).

## Surprises

- L'optimum est au-delà de l'inverse : accélérer *plus que nécessaire* aide.
- Les récitants lents mesurés à 0,45-0,5 mot/s ne sont pas des cas difficiles pour le moteur.
- Un fichier de contrôle « sans Coran » contenait du Coran cité : la mesure l'a révélé en trouvant un verset de
  plus dans une suite connue.
- La compensation du fichier entier peut tout perdre (`lot3-01` : 5 → 0 versets à ×1,5).
- Le moteur seul à ×1,5 rattrape sur `lot3-04` ce que la cascade rattrape déjà : l'écart de la partie (ii)
  vient de la référence choisie (moteur seul), pas d'un manque de la cascade.
- Aucune sortie refusée par le lecteur : le correctif des temps au mot (#78) tient jusqu'à ×0,3 compensé ×4.
