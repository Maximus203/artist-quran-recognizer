# Courbe de dégradation : le moteur résiste-t-il à un enregistrement imparfait ? — 2026-10-23

Statut : **mesure terminée** (calculs lancés le 2026-10-22 en soirée, rapport daté du 2026-10-23).
La règle de décision a été écrite et commitée **avant** la première mesure (commit `81059e4` après
rebase, `08373c6` avant ; 22:16 ; premier calcul à 22:17) et n'a pas bougé depuis. Les conditions « † »
ont été ajoutées **après** le résultat principal : elles éclairent, elles ne décident rien.

**Moteur mesuré : `develop` @ `5d1c87d`** (après #75 « promotion des débuts incertains par le voisin »).
Une première passe complète sur `develop` @ `14a2365` (avant #73-#75) avait donné les mêmes rappels à
quatre résultats près, chacun de un ou deux versets : vitesse ×0,8 (69 → 70 versets sur 73), ×0,5
(67 → 68), cascade à ×0,3 (44 → 45) et le levier passe-bas sur la réverbération extrême (38 → 40).
Aucune décision n'en dépend ; le rapport ne cite que la seconde passe.

Les chiffres obtenus sur des audios EveryAyah relèvent de la décision d'usage **provisoire** du
mainteneur (`docs/data-lots/ref-corpus-provenance.md`, « Décision d'usage ») : évaluation interne
locale, audio hors dépôt, aucune redistribution, aucun entraînement. Les dégradations sont des
dérivés de ces audios : elles restent hors dépôt aussi.

## En bref

- **Décision appliquée : un fine-tuning avec dégradations n'est PAS justifié par les quatre familles
  du cahier.** Aucune n'échoue : à leur niveau réaliste le rappel du moteur seul vaut 100,0 % (bruit
  blanc 10 dB), 97,3 % (réverbération moyenne), 98,6 % (MP3 48 kbit/s) et 95,9 % (vitesse ×0,6)
  pour 95,9 % en propre (70 versets sur 73), avec **0 faux verset** à chacun de ces niveaux.
- **Le moteur casse bien plus loin que le cahier** : bruit plus fort que la voix (SNR −5 dB :
  72,6 % en bruit blanc, 52,1 % en bruit rose), réverbération de grande nef (RT60 3,5 s, direct/réverbéré
  −10 dB : 61,6 %), récitation à ×0,4 (76,7 %) et ×0,3 (41,1 %). Le téléphone (AMR 4,75 kbit/s),
  le MP3 jusqu'à 8 kbit/s et une bande réduite à 4 kHz ne le dérangent pas du tout (100 %).
- **Le propre n'est pas un plafond** : 18 des 19 conditions dégradées du cahier font aussi bien que
  le propre ou mieux, et le WER de la transcription tombe de 13,4 % (propre) à 2,1-2,4 % dès que
  l'audio perd ses aigus au-delà de ~5,5 kHz. La mesure ne sait donc plus rien dire dans la plage
  réaliste : elle est saturée. Il faut des enregistrements réels annotés.
- **Trois leviers peu coûteux mesurés** (section dédiée) : candidat de vitesse sur la récitation lente
  (jusqu'à +56 points si le facteur est connu), passe-bas à 5,5 kHz en candidat supplémentaire
  (+4,1 points et WER ÷ 5,6 sur le propre, mais pire sous réverbération extrême), plancher d'évidence
  pour une détection d'un mot (le seul faux verset de la campagne est un mot de 0,16 s).
- **Coût** : 9 fichiers, 73 versets, 12,6 minutes d'audio ; 48 séries de mesure (40 du moteur seul,
  8 de la cascade), environ 30 minutes de calcul par passe (RTX 5090 Laptop, partagée), deux passes ;
  environ 2 h 15 de travail de bout en bout.

## Règle de décision (écrite avant la mesure)

Constantes dans `aqr.eval.degradation_curve.DECISION_RULE`, appliquées par `family_verdict` et
`decide` (testées dans `tests/unit/test_degradation_curve.py`).

1. **Rappel** = versets attendus nommés `recognized` / versets attendus (distincts). Les versets
   `inferred`, `uncertain` ou en abstention ne comptent pas comme retrouvés (I5). Les faux versets
   (`recognized` non attendus) sont comptés à part : nommer un faux verset est pire qu'un oubli (I3).
2. **Plancher.** Si le rappel du propre est < 95 %, la mesure est **non concluante** : le défaut
   n'est pas la dégradation.
3. **Niveau jugé.** Pour chaque famille, un niveau « réaliste » (l'ancre) est comparé au propre :
   bruit blanc SNR 10 dB, réverbération moyenne, MP3 48 kbit/s, vitesse ×0,6 (les quatre familles
   **obligatoires**, celles du cahier) ; bruit rose SNR 10 dB, téléphone AMR-NB 12,2 kbit/s et la
   combinaison réverbération moyenne + bruit 10 dB (familles **complémentaires**).
4. **Chute** = (rappel du propre − rappel à l'ancre) en points, sur la somme des versets attendus
   des 9 fichiers.
5. **Verdict d'une famille.**
   - **échoue** : chute > 15 points ET au moins la moitié des fichiers perdent plus de 10 points
     (une chute portée par un seul fichier est un accident, pas une famille) ;
   - **robuste** : chute ≤ 5 points ;
   - **dégradée** : entre les deux (ou chute > 15 points portée par moins de la moitié des fichiers).
6. **Décision.**
   - au moins une famille **obligatoire** échoue → **un fine-tuning avec ces dégradations est
     justifié**, et les familles qui échouent sont les cibles ;
   - sinon → le fine-tuning n'est **pas justifié par ces familles** ; une famille complémentaire en
     échec est signalée (elle éclaire le choix des cibles) mais ne décide pas seule.
7. **Alerte précision**, indépendante du rappel : plus d'un faux verset pour 100 attendus à l'ancre.

Limites de la règle, assumées d'avance : 9 fichiers et environ 70 versets (un seul fichier de
30 versets), donc des intervalles de confiance larges (Wilson 95 %, indicatifs : les versets d'un
même fichier ne sont pas indépendants) ; EveryAyah est probablement dans l'entraînement des
modèles, donc le rappel du propre est un **plafond optimiste** et c'est la dégradation **relative**
qui informe.

## Résultat de la règle

| Famille | Niveau jugé | Propre | À ce niveau | Chute (points) | Fichiers touchés | Faux / 100 | Verdict |
|---|---|---|---|---|---|---|---|
| bruit_blanc (obligatoire) | SNR 10 dB | 95,9 % | 100,0 % | -4,1 | 0/9 | 0,00 | **robuste** |
| bruit_rose | SNR 10 dB | 95,9 % | 98,6 % | -2,7 | 0/9 | 0,00 | **robuste** |
| reverberation (obligatoire) | moyenne | 95,9 % | 97,3 % | -1,4 | 0/9 | 0,00 | **robuste** |
| telephone | amr122 | 95,9 % | 100,0 % | -4,1 | 0/9 | 0,00 | **robuste** |
| mp3 (obligatoire) | 48 kbit/s | 95,9 % | 98,6 % | -2,7 | 0/9 | 0,00 | **robuste** |
| lent (obligatoire) | ×0,6 | 95,9 % | 95,9 % | 0,0 | 2/9 | 0,00 | **robuste** |
| combinaison | réverbération moyenne + bruit 10 dB | 95,9 % | 98,6 % | -2,7 | 0/9 | 0,00 | **robuste** |

Règle appliquée : échec = chute > 15 points ET au moins 50% des fichiers perdent plus de 10 points ; robuste = chute ≤ 5 points ; plancher du propre 95%.

**Décision : non justifié par les familles obligatoires** (rappel du propre 95,9 % ; aucune famille obligatoire n'échoue).

Une chute négative est un gain : le rappel à ce niveau dépasse celui du propre.

Sensibilité à la référence : le propre (95,9 %) est le point bas des conditions quasi transparentes
(MP3 128 kbit/s 98,6 %, SNR 20 dB 98,6 %, G.711 100 %). Avec 98,6 % comme référence, la plus grande
chute au niveau réaliste est ×0,6 : 2,7 points ; au pire niveau du cahier (×0,5), 5,5 points. Aucun
verdict ne change, aucune ne s'approche de 15 points. Le critère « moitié des fichiers » ne joue qu'à
la vitesse : 2 fichiers sur 9 perdent plus de 10 points à ×0,6 (Alafasy-097 : 4 versets sur 5 ;
Husary-109 : 5 sur 6), pour une chute agrégée nulle.

## Tableau final (conditions du cahier)

Moteur seul = `--asr fastconformer`. Rappel = versets attendus nommés `recognized` / attendus (IC de
Wilson 95 %, indicatif). Bien placés = le milieu de l'intervalle tombe dans le temps réel du verset
(±1 s). Faux = versets `recognized` non attendus. Inférés / Incertains = versets attendus seulement
`inferred` / `uncertain` (jamais comptés comme retrouvés). Abst. = nombre d'intervalles d'abstention.
WER/CER = transcription brute de l'ASR contre le texte du corpus (variante tolérante). RTF = temps de
calcul / durée de l'audio (le propre inclut le démarrage à froid du premier fichier : 18 s ; à chaud,
~0,027). « Cascade » = la cascade par défaut, mesurée sur trois conditions.

| Condition | Rappel (IC 95 %) | Bien placés | Faux | Inférés | Incertains | Manqués | Abst. | WER | CER | RTF | Rappel cascade | Faux cascade |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| propre (référence) | 95,9 % (70/73; 88,6 %-98,6 %) | 95,9 % | 0 | 1 | 0 | 2 | 3 | 13,4 % | 4,4 % | 0,100 | 100,0 % | 0 |
| bruit blanc, SNR 20 dB | 98,6 % (72/73; 92,6 %-99,8 %) | 98,6 % | 0 | 1 | 0 | 0 | 1 | 6,7 % | 2,6 % | 0,033 | - | - |
| bruit blanc, SNR 10 dB | 100,0 % (73/73; 95,0 %-100,0 %) | 100,0 % | 0 | 0 | 0 | 0 | 0 | 3,7 % | 1,5 % | 0,029 | 100,0 % | 0 |
| bruit blanc, SNR 5 dB | 98,6 % (72/73; 92,6 %-99,8 %) | 98,6 % | 0 | 0 | 0 | 1 | 1 | 4,3 % | 1,6 % | 0,029 | - | - |
| bruit rose, SNR 20 dB | 97,3 % (71/73; 90,5 %-99,2 %) | 97,3 % | 0 | 0 | 0 | 2 | 2 | 10,6 % | 3,9 % | 0,037 | - | - |
| bruit rose, SNR 10 dB | 98,6 % (72/73; 92,6 %-99,8 %) | 98,6 % | 0 | 1 | 0 | 0 | 1 | 6,3 % | 2,4 % | 0,039 | - | - |
| bruit rose, SNR 5 dB | 98,6 % (72/73; 92,6 %-99,8 %) | 98,6 % | 0 | 1 | 0 | 0 | 1 | 7,1 % | 2,6 % | 0,038 | - | - |
| réverbération faible (petite salle, RT60 0,4 s, direct/réverbéré +6 dB) | 98,6 % (72/73; 92,6 %-99,8 %) | 98,6 % | 0 | 1 | 0 | 0 | 1 | 11,8 % | 4,1 % | 0,030 | - | - |
| réverbération moyenne (grande salle, RT60 0,9 s, direct/réverbéré +0 dB) | 97,3 % (71/73; 90,5 %-99,2 %) | 97,3 % | 0 | 2 | 0 | 0 | 2 | 12,1 % | 4,1 % | 0,037 | - | - |
| réverbération forte (mosquée, RT60 2 s, direct/réverbéré -4 dB) | 100,0 % (73/73; 95,0 %-100,0 %) | 100,0 % | 0 | 0 | 0 | 0 | 1 | 6,5 % | 2,5 % | 0,030 | - | - |
| téléphone 8 kHz, 300-3400 Hz, G.711 µ-law (ligne fixe) | 100,0 % (73/73; 95,0 %-100,0 %) | 100,0 % | 0 | 0 | 0 | 0 | 0 | 2,1 % | 1,0 % | 0,030 | - | - |
| téléphone 8 kHz, 300-3400 Hz, AMR-NB 12,2 kbit/s (mobile) | 100,0 % (73/73; 95,0 %-100,0 %) | 100,0 % | 0 | 0 | 0 | 0 | 0 | 2,1 % | 1,0 % | 0,029 | - | - |
| téléphone 8 kHz, 300-3400 Hz, AMR-NB 4,75 kbit/s (mobile, débit minimal) | 100,0 % (73/73; 95,0 %-100,0 %) | 100,0 % | 0 | 0 | 0 | 0 | 0 | 2,1 % | 1,0 % | 0,029 | - | - |
| MP3 128 kbit/s | 98,6 % (72/73; 92,6 %-99,8 %) | 98,6 % | 0 | 1 | 0 | 0 | 1 | 10,4 % | 3,7 % | 0,038 | - | - |
| MP3 48 kbit/s | 98,6 % (72/73; 92,6 %-99,8 %) | 98,6 % | 0 | 1 | 0 | 0 | 2 | 12,5 % | 4,3 % | 0,037 | - | - |
| MP3 24 kbit/s | 100,0 % (73/73; 95,0 %-100,0 %) | 100,0 % | 0 | 0 | 0 | 0 | 0 | 2,1 % | 1,0 % | 0,029 | - | - |
| vitesse ×0,8 sans changement de hauteur | 95,9 % (70/73; 88,6 %-98,6 %) | 95,9 % | 0 | 1 | 0 | 2 | 3 | 17,0 % | 5,8 % | 0,032 | - | - |
| vitesse ×0,6 sans changement de hauteur | 95,9 % (70/73; 88,6 %-98,6 %) | 95,9 % | 0 | 1 | 0 | 2 | 4 | 20,9 % | 7,3 % | 0,029 | 100,0 % | 0 |
| vitesse ×0,5 sans changement de hauteur | 93,2 % (68/73; 84,9 %-97,0 %) | 93,2 % | 1 | 0 | 0 | 5 | 6 | 22,6 % | 9,1 % | 0,025 | - | - |
| réverbération moyenne puis bruit blanc SNR 10 dB | 98,6 % (72/73; 92,6 %-99,8 %) | 98,6 % | 0 | 0 | 0 | 1 | 1 | 5,6 % | 3,1 % | 0,029 | - | - |

## Courbes (rappel du moteur seul ; † = au-delà du cahier)

### bruit_blanc

```
propre                                 ███████████████████░   95,9 %   WER  13,4 %   cascade  100,0 %
SNR 20 dB                              ████████████████████   98,6 %   WER   6,7 %
SNR 10 dB                              ████████████████████  100,0 %   WER   3,7 %   cascade  100,0 %
SNR 5 dB                               ████████████████████   98,6 %   WER   4,3 %
SNR 0 dB †                             ███████████████████░   97,3 %   WER   8,0 %
SNR -5 dB †                            ███████████████░░░░░   72,6 %   WER  35,6 %   cascade   72,6 %
```

### bruit_rose

```
propre                                 ███████████████████░   95,9 %   WER  13,4 %   cascade  100,0 %
SNR 20 dB                              ███████████████████░   97,3 %   WER  10,6 %
SNR 10 dB                              ████████████████████   98,6 %   WER   6,3 %
SNR 5 dB                               ████████████████████   98,6 %   WER   7,1 %
SNR 0 dB †                             ████████████████████   98,6 %   WER   8,4 %
SNR -5 dB †                            ██████████░░░░░░░░░░   52,1 %   WER  48,7 %   cascade   53,4 %
```

### reverberation

```
propre                                 ███████████████████░   95,9 %   WER  13,4 %   cascade  100,0 %
faible                                 ████████████████████   98,6 %   WER  11,8 %
moyenne                                ███████████████████░   97,3 %   WER  12,1 %
forte                                  ████████████████████  100,0 %   WER   6,5 %
extrême †                              ████████████░░░░░░░░   61,6 %   WER  37,5 %   cascade   64,4 %
```

### telephone

```
propre                                 ███████████████████░   95,9 %   WER  13,4 %   cascade  100,0 %
g711                                   ████████████████████  100,0 %   WER   2,1 %
amr122                                 ████████████████████  100,0 %   WER   2,1 %
amr475                                 ████████████████████  100,0 %   WER   2,1 %
```

### mp3

```
propre                                 ███████████████████░   95,9 %   WER  13,4 %   cascade  100,0 %
128 kbit/s                             ████████████████████   98,6 %   WER  10,4 %
48 kbit/s                              ████████████████████   98,6 %   WER  12,5 %
24 kbit/s                              ████████████████████  100,0 %   WER   2,1 %
16 kbit/s †                            ████████████████████  100,0 %   WER   2,1 %
8 kbit/s †                             ████████████████████  100,0 %   WER   2,4 %
```

### lent

```
propre                                 ███████████████████░   95,9 %   WER  13,4 %   cascade  100,0 %
×0,8                                   ███████████████████░   95,9 %   WER  17,0 %
×0,6                                   ███████████████████░   95,9 %   WER  20,9 %   cascade  100,0 %
×0,5                                   ███████████████████░   93,2 %   WER  22,6 %
×0,4 †                                 ███████████████░░░░░   76,7 %   WER  29,3 %   cascade   90,4 %
×0,3 †                                 ████████░░░░░░░░░░░░   41,1 %   WER  59,7 %   cascade   61,6 %
```

### combinaison

```
propre                                 ███████████████████░   95,9 %   WER  13,4 %   cascade  100,0 %
réverbération moyenne + bruit 10 dB    ████████████████████   98,6 %   WER   5,6 %
```

### passe_bas

```
propre                                 ███████████████████░   95,9 %   WER  13,4 %   cascade  100,0 %
7 kHz †                                ███████████████████░   95,9 %   WER  14,4 %
5,5 kHz †                              ████████████████████  100,0 %   WER   2,4 %
4 kHz †                                ████████████████████  100,0 %   WER   2,1 %
```

## Lecture

**Ce que le moteur tient.** À tous les niveaux du cahier, sauf la vitesse, le rappel reste entre
97,3 % et 100 %. Le bruit (blanc ou rose, jusqu'à SNR 0 dB), la réverbération (jusqu'à la mosquée,
RT60 2 s, direct/réverbéré −4 dB), la compression MP3 (jusqu'à 8 kbit/s) et la téléphonie (G.711,
AMR-NB 12,2 et 4,75 kbit/s) ne font pas reculer le rappel. Aucun faux verset dans les 40 séries du
moteur seul et les 8 de la cascade sauf un (voir plus bas).

**Le modèle se trompe, la décision tient.** Le WER est le meilleur détecteur de tension : il
monte de façon monotone avec la lenteur (13,4 % propre, 17,0 % à ×0,8, 20,9 % à ×0,6, 22,6 % à
×0,5, 29,3 % à ×0,4, 59,7 % à ×0,3) bien avant que le rappel ne bouge (95,9 % à ×0,6, 93,2 % à
×0,5, 76,7 % à ×0,4). Le décodeur par suite de versets et l'arbitre acoustique absorbent des
transcriptions fausses jusqu'à environ un mot sur cinq (×0,6 : WER 20,9 %, rappel 95,9 %). Même
chose au bruit blanc à SNR 0 dB (WER 8,0 %, rappel 97,3 %). Quand le WER dépasse ~30 %, la décision
cède à son tour (SNR −5 dB : WER 35,6 %, rappel 72,6 %).

**La lenteur est le talon d'Achille, et il tient surtout à un fichier.** À ×0,8 le rappel de
Husary-109 (six versets courts et répétitifs, récitant le plus lent du jeu) tombe à 4 sur 6, à ×0,5 à
2 sur 6 ; sur les 5 versets perdus à ×0,5 sur les 73, 4 sont les siens, le cinquième est à Alafasy-097.
Les 7 autres fichiers tiennent à ×0,5. Avec neuf fichiers, c'est un fait à noter, pas une loi.

**Le propre est le point bas, pas le plafond.** Trois versets manquent en propre : 114:2 et 114:3
(deux mots chacun, abstention `below_threshold`) et 1:3 (deux mots, « inféré ») : des versets
très courts, que la preuve par la suite sauve ou non selon de toutes petites variations du signal
(un MP3 128 kbit/s ou un bruit à 20 dB suffit à en sauver presque tous : 72 versets sur 73). La
cascade les sauve tous (100 %). Le moteur est déterministe (rejouer le propre redonne les mêmes
70 versets) : cet écart n'est pas du hasard de mesure, c'est une sensibilité réelle de la décision à
de toutes petites variations du signal sur les versets de deux mots.

**Le WER dit autre chose.** Le propre a un WER de 13,4 % ; tout ce qui retire les aigus
au-delà de ~5,5 kHz le ramène à 2,1-2,4 % : G.711 et AMR (2,1 %), MP3 24, 16 et 8 kbit/s (2,1-2,4 %),
passe-bas à 5,5 et 4 kHz (2,4 et 2,1 %) ; un passe-bas à 7 kHz ne change rien (14,4 %). Le même
rappel suit : 95,9 % → 100 %. Ce n'est pas que la bande : un bruit blanc à 10 dB fait aussi tomber
le WER à 3,7 %. Hypothèse (non vérifiée) : le modèle a surtout vu des enregistrements compressés ou
bruités et sa transcription se dégrade sur un signal large bande très propre. Conséquence : les
« dégradations » MP3 et téléphone ne dégradent pas ce moteur sur cette source, elles le rapprochent
peut-être de ce qu'il a vu à l'entraînement. À vérifier sur du réel avant d'en faire un levier.

**Les faux versets.** 0 à tous les niveaux du cahier. Un seul faux verset dans les 48 séries :
Husary-001 à ×0,5, « 2:1 mot 5 », statut `recognized`, **0,16 s**, un mot isolé. C'est le cas que
`docs/evaluation/cascade-2026-10-20.md` signale déjà (« une détection d'un mot reste un point à
surveiller », I3) ; il pèse 1,4 faux verset pour 100 attendus, au-dessus de l'alerte d'1 pour 100 de
la règle (non déclenchée : ×0,5 n'est pas une ancre).

## Cascade : rattrape-t-elle ?

| Condition | Seul | Cascade | Gain (points) | Faux seul → cascade | Temps seul → cascade |
|---|---|---|---|---|---|
| propre (référence) | 95,9 % | 100,0 % | 4,1 | 0 → 0 | 76 s → 82 s |
| bruit blanc, SNR 10 dB | 100,0 % | 100,0 % | 0,0 | 0 → 0 | 22 s → 22 s |
| vitesse ×0,6 sans changement de hauteur | 95,9 % | 100,0 % | 4,1 | 0 → 0 | 36 s → 44 s |
| bruit blanc, SNR -5 dB | 72,6 % | 72,6 % | 0,0 | 0 → 0 | 20 s → 88 s |
| bruit rose, SNR -5 dB | 52,1 % | 53,4 % | 1,4 | 0 → 0 | 17 s → 47 s |
| réverbération extrême (grande nef, RT60 3,5 s, direct/réverbéré -10 dB) | 61,6 % | 64,4 % | 2,7 | 0 → 0 | 17 s → 50 s |
| vitesse ×0,4 sans changement de hauteur | 76,7 % | 90,4 % | 13,7 | 0 → 0 | 41 s → 91 s |
| vitesse ×0,3 sans changement de hauteur | 41,1 % | 61,6 % | 20,5 | 0 → 0 | 75 s → 151 s |

Sur les trois conditions clés du cahier, **oui, et sans faux verset** : propre 100 % (+4,1 points),
bruit 10 dB 100 % (inchangé), vitesse ×0,6 100 % (+4,1 points). Aux niveaux sévères (†), elle rattrape
en partie la lenteur (×0,4 : +13,7 points, ×0,3 : +20,5) mais pas le bruit (SNR −5 dB : +0,0 en blanc,
+1,4 en rose) ni la réverbération extrême (+2,7). Son coût croît avec la difficulté : de ×1,0 à ×1,2
le temps du moteur seul aux niveaux du cahier, de ×2,0 à ×4,4 aux niveaux sévères. (Les temps du
moteur seul de « propre » et de « vitesse ×0,3 » incluent un démarrage à froid de processus, de l'ordre
de 20 à 40 s : à chaud, ces deux conditions coûtent moins que ce tableau ne le montre.)

## Au-delà du cahier (exploratoire, décidé après le résultat principal)

Le résultat principal ne trouvait aucune famille en échec ; pour savoir **où** le moteur casse, on a
poussé les niveaux (bruit 0 et −5 dB, réverbération extrême, MP3 16 et 8 kbit/s, vitesses ×0,4 et ×0,3)
et testé la bande passante seule (passe-bas). Ces conditions ne sont pas des ancres.

| Condition | Rappel (IC 95 %) | Bien placés | Faux | Inférés | Incertains | Manqués | Abst. | WER | CER | RTF | Rappel cascade | Faux cascade |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| bruit blanc, SNR 0 dB † | 97,3 % (71/73; 90,5 %-99,2 %) | 97,3 % | 0 | 1 | 0 | 1 | 2 | 8,0 % | 3,8 % | 0,088 | - | - |
| bruit blanc, SNR -5 dB † | 72,6 % (53/73; 61,4 %-81,5 %) | 72,6 % | 0 | 0 | 0 | 20 | 36 | 35,6 % | 24,2 % | 0,026 | 72,6 % | 0 |
| bruit rose, SNR 0 dB † | 98,6 % (72/73; 92,6 %-99,8 %) | 98,6 % | 0 | 0 | 0 | 1 | 4 | 8,4 % | 4,7 % | 0,029 | - | - |
| bruit rose, SNR -5 dB † | 52,1 % (38/73; 40,8 %-63,1 %) | 52,1 % | 0 | 1 | 0 | 34 | 73 | 48,7 % | 36,8 % | 0,022 | 53,4 % | 0 |
| réverbération extrême (grande nef, RT60 3,5 s, direct/réverbéré -10 dB) † | 61,6 % (45/73; 50,2 %-71,9 %) | 61,6 % | 0 | 3 | 0 | 25 | 38 | 37,5 % | 20,3 % | 0,023 | 64,4 % | 0 |
| MP3 16 kbit/s † | 100,0 % (73/73; 95,0 %-100,0 %) | 100,0 % | 0 | 0 | 0 | 0 | 0 | 2,1 % | 1,0 % | 0,030 | - | - |
| MP3 8 kbit/s † | 100,0 % (73/73; 95,0 %-100,0 %) | 100,0 % | 0 | 0 | 0 | 0 | 0 | 2,4 % | 1,1 % | 0,030 | - | - |
| vitesse ×0,4 sans changement de hauteur † | 76,7 % (56/73; 65,8 %-84,9 %) | 76,7 % | 0 | 0 | 0 | 17 | 27 | 29,3 % | 12,6 % | 0,022 | 90,4 % | 0 |
| vitesse ×0,3 sans changement de hauteur † | 41,1 % (30/73; 30,5 %-52,6 %) | 41,1 % | 0 | 2 | 0 | 41 | 94 | 59,7 % | 32,2 % | 0,030 | 61,6 % | 0 |
| propre, passe-bas à 7 kHz (rééchantillonnage à 14 kHz) † | 95,9 % (70/73; 88,6 %-98,6 %) | 95,9 % | 0 | 0 | 0 | 3 | 4 | 14,4 % | 4,7 % | 0,035 | - | - |
| propre, passe-bas à 5,5 kHz (rééchantillonnage à 11 kHz) † | 100,0 % (73/73; 95,0 %-100,0 %) | 100,0 % | 0 | 0 | 0 | 0 | 1 | 2,4 % | 1,1 % | 0,029 | - | - |
| propre, passe-bas à 4 kHz (rééchantillonnage à 8 kHz) † | 100,0 % (73/73; 95,0 %-100,0 %) | 100,0 % | 0 | 0 | 0 | 0 | 0 | 2,1 % | 1,0 % | 0,029 | - | - |

Où ça casse (chute de plus de 15 points sous le propre, soit moins de 80,9 %) :

| Famille | Dernier niveau qui tient | Premier niveau qui casse |
|---|---|---|
| Bruit blanc | SNR 0 dB (97,3 %) | SNR −5 dB (72,6 %) |
| Bruit rose | SNR 0 dB (98,6 %) | SNR −5 dB (52,1 %) |
| Réverbération | mosquée, RT60 2 s, direct/réverbéré −4 dB (100,0 %) | grande nef, RT60 3,5 s, −10 dB (61,6 %) |
| Vitesse | ×0,5 (93,2 %) | ×0,4 (76,7 %) |
| MP3, téléphone, bande passante | jusqu'à 8 kbit/s, AMR 4,75, 4 kHz (100 %) | non atteint |

Ces seuils sont à lire avec prudence : un seul pas sépare « tient » de « casse » dans chaque famille,
et la réponse impulsionnelle est synthétique. Ils disent que le cahier s'arrêtait **un cran avant** la
rupture, pas où elle est exactement.

## Leviers mesurés (exploratoire)

Chaque levier est un traitement appliqué à l'audio dégradé **avant** l'ASR, un seul essai, paramètres
fixés d'avance (`afftdn=nr=20:nf=-30:tn=1`, `atempo` ×2 et ×3, rééchantillonnage à 11 kHz), sans
réglage. L'accélération est un **oracle** : on connaît le facteur de ralentissement appliqué.

| Levier (appliqué avant l'ASR) | Sans | Avec | Gain (points) | WER sans → avec | Faux avec |
|---|---|---|---|---|---|
| ×0,4 puis accélération ×2 (net ×0,8) | 76,7 % (56/73) | 95,9 % (70/73) | +19,2 | 29,3 % → 17,2 % | 0 |
| ×0,3 puis accélération ×2 (net ×0,6) | 41,1 % (30/73) | 97,3 % (71/73) | +56,2 | 59,7 % → 17,4 % | 0 |
| ×0,3 puis accélération ×3 (net ×0,9) | 41,1 % (30/73) | 91,8 % (67/73) | +50,7 | 59,7 % → 16,0 % | 0 |
| bruit blanc −5 dB puis débruitage `afftdn` | 72,6 % (53/73) | 74,0 % (54/73) | +1,4 | 35,6 % → 33,6 % | 0 |
| bruit rose −5 dB puis débruitage `afftdn` | 52,1 % (38/73) | 56,2 % (41/73) | +4,1 | 48,7 % → 44,2 % | 0 |
| bruit blanc −5 dB puis passe-bas 5,5 kHz | 72,6 % (53/73) | 74,0 % (54/73) | +1,4 | 35,6 % → 34,1 % | 0 |
| bruit rose −5 dB puis passe-bas 5,5 kHz | 52,1 % (38/73) | 47,9 % (35/73) | -4,1 | 48,7 % → 54,1 % | 0 |
| réverbération extrême puis passe-bas 5,5 kHz | 61,6 % (45/73) | 54,8 % (40/73) | -6,8 | 37,5 % → 41,8 % | 0 |
| propre puis passe-bas 5,5 kHz | 95,9 % (70/73) | 100,0 % (73/73) | +4,1 | 13,4 % → 2,4 % | 0 |

- **Candidat de vitesse (le plus rentable).** Réaccélérer une récitation ralentie la ramène dans la
  plage où le moteur tient : à ×0,3 puis ×2 (net ×0,6) le rappel passe de 41,1 % à 97,3 % et le WER de
  59,7 % à 17,4 %. Le facteur étant ici connu, c'est un **majorant** ; le vrai levier est de l'estimer
  (essayer quelques vitesses candidates sur les fenêtres douteuses et garder celle que le matcher et
  l'arbitre acoustique soutiennent, I3).
- **Passe-bas à 5,5 kHz.** Sur le propre : 95,9 % → 100 % et WER 13,4 % → 2,4 %. Mais il **n'aide pas**
  le bruit (+1,4 point en blanc, −4,1 en rose) et **aggrave** la réverbération extrême (−6,8 points) :
  c'est un candidat de plus pour la cascade, pas un filtre global. À valider d'abord sur des
  enregistrements réels non EveryAyah.
- **Débruitage `afftdn`.** +1,4 point (blanc) et +4,1 (rose) à SNR −5 dB : de l'ordre d'un à trois
  versets sur 73, dans le bruit de mesure. Pas un levier.
- **Réverbération extrême et bruit à −5 dB : aucun levier peu coûteux trouvé** (ffmpeg n'a pas de
  déréverbération ; le passe-bas aggrave, le débruitage n'apporte rien de net). Ce sont les deux
  zones qui cassent hors cahier sans remède bon marché ; la cascade n'y change presque rien non plus.

## Recommandation (chiffrée, sans enjoliver)

1. **Ne pas lancer de fine-tuning avec dégradations sur la base de cette mesure.** Règle appliquée :
   0 famille obligatoire sur 4 en échec (chute à l'ancre : −4,1 / −1,4 / −2,7 / 0,0 point). Il n'y a
   rien à gagner aux niveaux du cahier : la cascade y atteint déjà 100 % sur les trois conditions
   testées, soit une marge de 0 à 4,1 points au moteur seul.
2. **Mais ne pas conclure que le moteur est robuste.** La mesure est saturée (EveryAyah probablement
   vu à l'entraînement, voix professionnelles, 73 versets) : 18 conditions dégradées sur 19 font
   aussi bien que le propre ou mieux. Elle prouve l'absence de défaut grossier, pas l'absence de défaut. La preuve
   qui manque est un jeu **réel annoté** (étape A du plan) : c'est lui qui peut justifier ou non un
   fine-tuning, et dire quelles conditions réelles ressemblent à « bruit plus fort que la voix »,
   « grande nef » ou « récitation à ×0,4 ».
3. **Règle de réexamen, écrite maintenant** : rouvrir la question d'un fine-tuning avec dégradations
   si, sur le jeu réel annoté, le rappel de la cascade est inférieur de plus de 15 points à celui du
   propre OU inférieur à 90 %, ET que les versets perdus se rangent dans l'une des trois zones qui
   cassent ici (réverbération de grande nef, bruit au niveau de la voix ou au-dessus, récitation à
   ≤ ×0,4). Alors les cibles, par rapport coût/gain : lenteur (levier de vitesse d'abord),
   réverbération extrême (aucun levier bon marché), bruit ≤ 0 dB.
4. **Avant tout fine-tuning, essayer dans cet ordre** (coût croissant) :
   - **Candidat de vitesse** sur les fenêtres douteuses (facteurs 1,5 ; 2 ; 3) arbitré par l'audio :
     majorant +19 à +56 points à ×0,4 et ×0,3, coût d'ASR négligeable (RTF ~0,03).
   - **Passe-bas ~5,5 kHz en candidat de réécoute** (cascade), validé sur lots 1 et 2 : majorant
     +4,1 points et WER ÷ 5,6 sur le propre, à ne pas appliquer partout.
   - **Plancher d'évidence pour une détection d'un mot** (et fusion des fragments d'un verset court) :
     ferme le seul faux verset constaté (2:1, 0,16 s) et traite les versets de deux mots qui font le
     point bas du propre. Le **détecteur de parole non coranique** n'est pas testé ici (aucun contenu
     non coranique dans cette campagne) : il reste à mesurer sur du réel.

## Méthode (reproductible)

### Fichiers

Neuf sourates reconstituées, trois par récitant, dans le sous-ensemble EveryAyah déjà téléchargé
(`DEFAULT_SUBSET`, `scripts/fetch_everyayah.py`) : concaténation des clips verset par verset, sans
trou ajouté, à 16 kHz mono. La vérité (verset, début, fin) est la somme exacte des durées de clips.

| Fichier | Récitant | Sourate | Versets | Durée |
|---|---|---|---|---|
| Alafasy-067 | Alafasy_128kbps | 67 (Al-Mulk) | 30 | 442,6 s |
| Alafasy-097 | Alafasy_128kbps | 97 | 5 | 35,6 s |
| Alafasy-114 | Alafasy_128kbps | 114 | 6 | 40,6 s |
| Husary-001 | Husary_128kbps | 1 (Al-Fatiha) | 7 | 47,6 s |
| Husary-109 | Husary_128kbps | 109 | 6 | 54,0 s |
| Husary-110 | Husary_128kbps | 110 | 3 | 38,2 s |
| Abdul_Basit-097 | Abdul_Basit_Murattal_192kbps | 97 | 5 | 36,3 s |
| Abdul_Basit-109 | Abdul_Basit_Murattal_192kbps | 109 | 6 | 36,3 s |
| Abdul_Basit-113 | Abdul_Basit_Murattal_192kbps | 113 | 5 | 24,5 s |

Pourquoi ces neuf : trois récitants (voix, débit et enregistrements différents) ; Al-Mulk, 30
versets en 7 minutes, éprouve la longue récitation et les suites de versets ; Al-Fatiha est le cas
où la basmala EST le verset ; les petites sourates (3 à 6 versets) sont les fichiers où un seul
verset perdu pèse lourd. Total : 73 versets, 12,6 minutes. Les sourates reconstituées sont
meilleures que les clips isolés : elles passent par le vrai segmenteur, les vraies fenêtres et le
vrai décodeur de suites. Le texte de référence du WER vient du corpus (I1) ; le clip du verset 1
ne dit pas la basmala que le texte Tanzil y colle (sauf Al-Fatiha) : ses 4 premiers mots sont écartés.

### Conditions, commandes et graines

Source unique : `aqr.eval.degradation_curve.build_conditions` (paramètres) et
`aqr.data.degrade_extra.apply_condition` (exécution). Les commandes ci-dessous sont celles
**enregistrées à l'exécution** dans `methode.json` (ffmpeg 9.0 full build, gyan.dev ; `IN.wav` =
la sourate propre, `OUT.wav` = la sortie WAV mono 16 bits 16 kHz). La graine d'un fichier est la
graine de la condition (`20261023`) + 101 × l'indice du fichier (ordre du tableau ci-dessus).

**Bruit blanc** SNR 20 / 10 / 5 dB (`bruit_blanc_*`). Bruit gaussien généré en Python
(`random.Random("noise:<graine>").gauss`), mis au RMS = RMS(signal) / 10^(SNR/20) : SNR mesuré
exact (testé, ±0,5 dB ; mesuré sur Husary-110 : 20,00 / 10,00 / 5,00 dB), puis
`ffmpeg -nostdin -y -v error -i IN.wav -i noise.wav -filter_complex amix=inputs=2:duration=first:normalize=0 -ac 1 -ar 16000 -c:a pcm_s16le OUT.wav`.

**Bruit rose** SNR 20 / 10 / 5 dB (`bruit_rose_*`). Bruit rose de ffmpeg, graine fixée, mis à
l'échelle sur le RMS voulu en Python, mélangé par la même commande `amix` :
`ffmpeg -nostdin -y -v error -f lavfi -i anoisesrc=color=pink:seed=<graine>:sample_rate=16000:duration=<durée>:amplitude=0.5 -ac 1 -c:a pcm_s16le pink.wav`.

**Réverbération** faible / moyenne / forte (`reverberation_*`) : réponse impulsionnelle synthétique
(Python, `ir.f32`) = son direct (impulsion en t = 0, donc **rien n'est décalé**) + queue diffuse
(bruit gaussien × exp(−6,908·t/RT60)), réglée par le RT60 et le rapport direct/réverbéré (DRR),
énergie normalisée à 1 (le niveau efficace est conservé : mesuré −0,2 à −0,5 dB). Faible : petite
salle, RT60 0,4 s, DRR +6 dB ; moyenne : grande salle, RT60 0,9 s, DRR 0 dB ; forte : mosquée,
RT60 2,0 s, DRR −4 dB. Appliquée par
`ffmpeg -nostdin -y -v error -i IN.wav -f f32le -ar 16000 -ac 1 -i ir.f32 -filter_complex [0:a][1:a]afir=gtype=none:irnorm=-1 -ac 1 -ar 16000 -c:a pcm_s16le OUT.wav`.
(`irnorm=-1` : par défaut `afir` normalise la réponse par sa norme L1 et ferait perdre ~30 dB ;
trouvé en testant, verrouillé par `tests/unit/test_degrade_extra.py`.) Le `reverb` existant de
`aqr.data.degrade` (`aecho`, trois échos) n'est PAS une salle : il n'est pas utilisé ici.

**Téléphone** (`telephone_*`) : bande 300-3400 Hz à 8 kHz, puis un vrai codec, puis retour à 16 kHz :
`ffmpeg … -i IN.wav -af aresample=8000,highpass=f=300,lowpass=f=3400 -ac 1 -ar 8000 -c:a pcm_s16le band.wav`,
puis `ffmpeg … -i band.wav -ac 1 -ar 8000 -c:a <codec> [-b:a <débit>] coded.<wav|amr>`, puis
`ffmpeg … -i coded.<wav|amr> -ac 1 -ar 16000 -c:a pcm_s16le OUT.wav`. Trois niveaux : `pcm_mulaw`
(G.711 µ-law, ligne fixe), `libopencore_amrnb` 12,2 kbit/s (mobile), 4,75 kbit/s (débit minimal).

**MP3** 128 / 48 / 24 kbit/s (`mp3_*`) : `aqr.data.degrade` tel quel,
`ffmpeg … -i IN.wav -ac 1 -c:a libmp3lame -b:a <débit>k coded.mp3` puis
`ffmpeg … -i coded.mp3 -ac 1 -ar 16000 -c:a pcm_s16le OUT.wav`. Partant d'un WAV à 16 kHz, c'est
plus doux qu'un MP3 24 kbit/s tiré d'un 44,1 kHz : le niveau 24 est un minimum, pas un pire cas.

**Vitesse lente** ×0,8 / ×0,6 / ×0,5 (`lent_*`) : étirement temporel **sans changement de hauteur**,
`ffmpeg … -i IN.wav -af atempo=<vitesse> -ac 1 -ar 16000 -c:a pcm_s16le OUT.wav`. Durée × 1/vitesse
(mesurée : 1,250 / 1,666 / 1,999) ; la vérité terrain est mise à l'échelle (début et fin ÷ vitesse).

**Combinaison** (`combinaison`) : réverbération moyenne (commande `afir` ci-dessus vers `room.wav`),
puis bruit blanc SNR 10 dB (RMS mesuré sur le signal réverbéré) par la commande `amix`.

**Conditions exploratoires (†, ajoutées après le résultat principal).** Mêmes commandes, niveaux
plus sévères : bruit blanc et rose à SNR 0 et −5 dB ; réverbération extrême (RT60 3,5 s, DRR −10 dB) ;
MP3 16 et 8 kbit/s ; vitesse ×0,4 et ×0,3, obtenues en chaînant des `atempo` (le filtre n'accepte
pas moins de 0,5 : `atempo=0.5,atempo=0.8` puis `atempo=0.5,atempo=0.6`) ; **passe-bas** à 7, 5,5 et
4 kHz par `ffmpeg … -i IN.wav -af aresample=<2×coupure>,aresample=16000 -ac 1 -ar 16000 -c:a pcm_s16le OUT.wav`
(rééchantillonnage vers le bas puis vers le haut : coupure franche). **Leviers** = une dégradation
puis un traitement amont, chaînés fichier à fichier avec la même graine : accélération
`atempo=2` ou `atempo=3`, passe-bas à 5,5 kHz, débruitage
`ffmpeg … -i IN.wav -af afftdn=nr=20:nf=-30:tn=1 -ac 1 -ar 16000 -c:a pcm_s16le OUT.wav` (un seul essai,
sans réglage). Les commandes enregistrées de chaque condition sont dans `methode.json`. L'accélération
d'un levier est un **oracle** : le facteur est celui du ralentissement appliqué.

**Foule / ambiance : omise.** Aucune source libre n'est disponible dans le dépôt ni sur la machine :
FLEURS (CC BY 4.0) et Common Voice (CC0) sont déclarés dans `src/aqr/data/finetune_sources.py` mais
non téléchargés (`data/finetune/` ne contient que `LOCK.json`), et la parole des lots 1 et 2 est
celle de tiers, aux droits non établis, et contient du Coran récité (elle fausserait « bruit »). Le
bruit rose, à spectre diffus, est le substitut honnête le plus proche, pas un équivalent.

### Mesure

Pour chaque fichier et chaque condition : `aqr.pipeline` chargé une fois (device `auto`, CUDA), le
même objet pour toutes les conditions. Deux moteurs : **seul** = `--asr fastconformer`, **cascade**
= la cascade par défaut (FastConformer partout, Whisper et Muno sur les fenêtres douteuses,
arbitre acoustique), mesurée sur les trois conditions clés du cahier (propre, bruit blanc 10 dB,
vitesse ×0,6) puis sur les cinq conditions sévères † (bruit −5 dB blanc et rose, réverbération
extrême, vitesses ×0,4 et ×0,3). Sorties dans
`<out>/<condition>/<mode>/`. Le WER/CER compare la transcription brute du moteur principal (toutes
les fenêtres, dans l'ordre) au texte du corpus (variante `tolerante` de `aqr.eval.transcription`) :
un WER élevé avec un rappel élevé veut dire « le modèle se trompe mais la décision tient » ; un WER
bas avec un rappel bas, « la décision s'abstient à tort ».

### Rejouer

```bash
export PYTHONPATH=<worktree>/src AQR_MODELS_DIR=… AQR_AUDIO_DIR=…        # Windows : $env:…
python scripts/measure_degradation.py prepare --audio-dir $AQR_AUDIO_DIR \
    --derived-dir $AQR_AUDIO_DIR/_derived/degradation --out-dir $OUT/degradation
python scripts/measure_degradation.py run --mode solo    --derived-dir … --out-dir $OUT/degradation
python scripts/measure_degradation.py run --mode cascade --derived-dir … --out-dir $OUT/degradation
python scripts/measure_degradation.py report --out-dir $OUT/degradation
# conditions exploratoires (†) puis leviers (identifiants dans aqr.eval.degradation_curve) :
python scripts/measure_degradation.py prepare --exploratory …
python scripts/measure_degradation.py run --mode solo --exploratory …
python scripts/measure_degradation.py prepare --conditions levier_x0.4_puis_x2 … …
python scripts/measure_degradation.py run --mode cascade --conditions bruit_blanc_m5db lent_x0.3 … …
```

Chaque étape est reprenable (un résultat existant n'est pas refait). Le script n'utilise pas
`scripts/recognize_batch.py` : celui-ci (comme `aqr.eval.run`) importe `fcntl` et `resource`, absents
de Windows.

## Limites

- **Source** : EveryAyah est probablement dans l'entraînement des modèles
  (`docs/data-lots/ref-corpus-provenance.md`, « Biais d'évaluation ») : le rappel du propre est un
  plafond optimiste, c'est la dégradation **relative** qui informe. Récitants professionnels, enregistrés
  en studio, un seul locuteur à la fois.
- **Échantillon** : 9 fichiers, 73 versets (dont 30 pour un seul fichier) ; les intervalles de Wilson
  supposent des versets indépendants, ce qu'ils ne sont pas. Un cran de ±2 à 3 versets sépare des
  conditions pourtant équivalentes (propre 70, MP3 128 kbit/s 72) : la résolution réelle est d'environ
  ±4 points.
- **Dégradations synthétiques** : la réponse impulsionnelle de salle est un modèle exponentiel
  (RT60, DRR), pas une salle mesurée ; le bruit est stationnaire (blanc, rose) ; le MP3 part d'un WAV à
  16 kHz (plus doux qu'un MP3 24 kbit/s tiré d'un 44,1 kHz) ; la foule/ambiance est omise (aucune source
  libre disponible, voir Méthode) ; ni clipping, ni gain automatique, ni musique, ni plusieurs voix.
- **Contenu** : tout est du Coran récité en Hafs, un verset après l'autre. Rien ne mesure ici le rejet
  de la parole non coranique (I4), ni une autre riwaya, ni une récitation avec reprise ou erreur.
- **Exploratoire** : les conditions † et les leviers ont été choisis après le résultat principal, un
  seul essai chacun, sans réglage ; le facteur de vitesse est connu (oracle).
- **Statut des chiffres** : usage provisoire (voir l'en-tête) ; non annoncés comme une performance
  attendue en conditions réelles.

## Surprises

- Le propre est moins bon que 16 conditions dégradées sur 19 et égal à deux autres (voir « Lecture »).
- **Le lecteur refuse une sortie du moteur** : à ×0,3, sur Alafasy-067, `aqr.eval.recognition` (champs
  `word_times` de #75) lève « intervals[52] : word_times[5] chevauche le mot précédent » : le moteur
  émet des temps de mots qui se recouvrent sur de l'audio très ralenti. Le script de mesure ignore ces
  champs, le note (`note` dans le `.score.json`) et continue ; le rappel de ce fichier reste mesuré.
  À corriger côté moteur ou lecteur.
- Un faux verset de 0,16 s, un seul mot, à ×0,5 : I3 tient partout ailleurs, pas là.
- `scripts/recognize_batch.py` et `aqr.eval.run` importent `fcntl` et `resource` : ils ne tournent pas
  sous Windows, où cette campagne a tourné. D'où `scripts/measure_degradation.py`, indépendant de
  `aqr.eval.run`. Sur ce poste, 6 fichiers de tests existants échouent pour la même raison
  (`test_eval_run`, `test_evaluate_script`, `test_recognize_batch`, `test_smoke_*`, deux tests de
  `test_build_ref_corpus_script`) ; aucun ne touche au code de cette PR.
- `afir` normalise par défaut la réponse impulsionnelle par sa norme L1 : sur une salle, le signal
  perdait 30 dB sans erreur (`irnorm=-1` règle cela ; verrouillé par un test).
