# Comblement de trou — mesures (revue lot3-04, ADR-0013)

Date : 2026-10-23. Moteur : cascade (FastConformer + Whisper + Muno), arbitre acoustique FastConformer, seuil
−1,0. « Base » = le code de `develop` (3339bbe) avec le comblement désactivé (`GapConfig(enabled=False)`,
`chain_members=False`) ; « nouveau » = le code de cette PR. Mêmes fichiers, mêmes modèles, deux processus.
Les sorties sont hors dépôt (`aqr-out/2026-10-23/revue-lot3-04/`). Aucune écoute humaine : les ajouts proches du
seuil sont listés plus bas pour l'oreille du mainteneur.

## 1. Les cinq signalements de la revue (lot3-04, 23 min)

| # | Intervalle | Avant | Après | Preuve (par trame, parole alignée) | Corrigé |
|---|---|---|---|---|---|
| 1 | 1,3–16,2 s | 1:1 [2-4] et 1:2 [1-4] `uncertain` | `recognized`, `promoted_by: "chain"` | suite 1:1–1:5 acceptée, llr −0,25 | oui, **sauf le mot 1 de 1:1** |
| 2 | 33,8–62,9 s | 2:87 [1-12] | 2:87 [1-13], 13 temps au mot | extension : mot 13, llr −0,20, gain +6,9 nats | oui |
| 3 | 555,8–582,5 s | abstention `below_threshold` (0,47) puis 12:21 [13-23] | 12:21 [1-23] d'un seul tenant | `between` 12:21 [1-12] : llr −0,39, similarité 0,72, 1 mot faible sur 12 | oui |
| 4 | 656,8–690,6 s | 17:74 [1-1], deux abstentions | 17:74 [1-9], 656,9–680,6 s | `between` 17:74 [2-9] : llr −0,30, similarité 0,45, 1 mot faible sur 8 | oui |
| 5 | 752,8–780,4 s | deux abstentions (0,27 et **0,727**) | 17:76 [1-13] `repetition: true`, 753,1–780,1 s | `repetition` 17:76 [1-13] : llr −0,25, similarité 0,75, 1 mot faible sur 13 | oui |

**Non corrigé — cas 1, mot « بسم »** : l'hypothèse `head` 1:1 [1-1] sur les 2,2 s d'avant le verset obtient
−0,84 par trame (un mot, 5 trames), sans transcription : elle est sous le seuil des mots seuls (−0,5). Refusé,
pas deviné (I3). 1:1 s'affiche donc `[2-4]`, partiel.

Pourquoi le contrôle `head` de la session ne trouvait pas les cas 3 et 4 : il alignait à fin libre un texte qui
s'arrêtait là où l'audio soutenait le mieux, soit 2 mots dans 22 s (llr −0,48, dilué par 20 s de blancs) et mesurait
la similarité de la transcription du trou contre ces 2 mots (0,29). Mesuré : la preuve par trame de tout le passage
fait paraître soutenu un mauvais texte (test `test_un_mauvais_texte_dilue_…`) ; sur la seule parole alignée, il ne
l'est plus. Cas 2 : ce n'est pas un trou, le mot est dans la fenêtre reconnue ; [1-12] et [1-13] comparés sur
les mêmes trames : +6,9 nats pour [1-13] (le treillis diluait ce coût dans 415 trames).

## 2. Non-régression (base contre nouveau)

| Fichier | Versets base | Versets nouveau | Perdus | Gagnés | Étendus ou raccordés |
|---|---|---|---|---|---|
| 6 lot3 (THd1, Nneb, ONqC, Xf6_, S_tL, -_IR) | 50+5+14+26+53+58 = 206 | 206 | **0** | 3 | 19 |
| lot1-05 | 55 | 55 | **0** | 0 | 1 |
| lot1-06 | 276 | 276 | **0** | 0 | 8 |
| lot2-04 | 37 | 37 | **0** | 0 | 1 |
| lot2-11 (sans Coran) | 0 | 0 | 0 | **0** | 0 |
| lot2-12 (sans Coran, 55 min) | 5 | 5 | 0 | **0** | 0 |

« Perdu » = un verset de base sans verset de même référence qui le recouvre dans le temps dans la sortie nouvelle.
Les sorties de référence des sessions de l'atelier (`prediction.recognition.json`) donnent les mêmes décomptes
(52, 5, 14, 26, 53, 58, 55, 276, 37, 0, 5).

**Versets gagnés (3, tous sur lot3-04)** : 1:1 [2-4] et 1:2 [1-4] (suite acceptée, llr −0,25) ; 17:76 [1-13] redit
(llr −0,25, similarité 0,75). 29 versets étendus ou raccordés, dont les cinq du tableau 1.

**Versets gagnés puis écartés par la mesure** : 2:88 [1-1] (lot3-04) et 11:91 [1-1] (lot3 S_tL), un mot du verset
d'après, sans transcription : nommer un verset sur un mot est trop peu (règle `gap_new_verse_min_words` = 3).

### EveryAyah reconstitué (3 récitants × 10 sourates, 216 versets)
Rappel **216/216 = 100 %** avant et après, 1 faux verset avant et après (2:1 chez Husary, la sourate 1 : déjà là).
Cinq sourates reçoivent une extension, toutes vers le verset complet : 67:16 [2-11] → [1-11], 110:1 [6-9] → [5-9],
67:28 [11-15] → [10-15], 112:4 [1-3] → [1-5], 67:9 [1-4],[10-18] → [1-5],[8-18]. Aucune n'éloigne d'un verset entier.

## 3. Ajouts à écouter (proches du seuil ou sans second témoin)
Liste complète des 31 contrôles `gap` acceptés avec leur preuve : `a-ecouter.txt` (hors dépôt). 16 sont à écouter :
- **llr à 0,3 du seuil** : 22:36 [1-2] (lot1-06, 1347,9 s, llr −0,99, gain +31 nats), 11:61 [14] (lot3 S_tL, 51,1 s,
  llr −0,83, gain +4,0 nats/mot, au seuil).
- **extensions à moins de 8 nats par mot** : 21:81 [13-14], 22:40 [20], 2:87 [13] (le cas 2), 43:36 [1], 12:19 [7-8]
  (11:61 [14] et 22:36 [1-2] sont déjà dans la ligne précédente).
- **un mot de suite sans transcription** (audio fort, ≤ 3 mots) : 67:27 [8], 3:145 [9], 11:63 [14], 21:73 [11], 43:42 [5].
- **transcription pauvre** (audio fort, 0,3 ≤ similarité < 0,6) : 17:74 [2-9] (cas 4), 11:66 [4-5], 21:74 [10-11],
  12:21 [7-9] (lot3 Xf6_).

## 4. Calibrage et seuils (provisoires, à confirmer sur des annotations)
| Réglage | Valeur | Origine |
|---|---|---|
| preuve de la parole alignée | ≥ −1,0 (inchangé) | seuil des suites, ADR-0008 |
| audio « fort » | ≥ −0,5 | les cinq cas vrais : −0,25 à −0,39 ; le mot isolé « بسم » : −0,84 refusé |
| similarité de la transcription | 0,6 ; 0,3 si audio fort | cas 3 (0,72), cas 4 (0,45), 12:21 [1-2] de la session (0,29, texte de 2 mots) |
| mot « sans soutien » | < −3 par trame ; ≤ 15 % des mots | mots faibles mesurés dans des versets VRAIS : 2:87 mot 6 à −4,8, cas 3 un sur 12, cas 4 un sur 8, cas 5 un sur 13 |
| gain d'une extension | ≥ 4 nats par mot | gains observés : 5 à 126 nats ; 4,0 le plus bas retenu |
| écart décisif entre textes | 3 nats | rapport de vraisemblance ≈ 20 |
| répétition | ≥ 3 mots | une répétition d'un mot ne se distingue pas d'un bruit |
| verset nouveau | ≥ 3 mots | 2:88 [1-1] et 11:91 [1-1] écartés |

## 5. Coût
Un treillis par trou ayant de la parole (le modèle n'émet pas ≥ 3 trames non blanches : rien, pas même une trace) et
une dizaine d'alignements courts. Temps de la même machine, base puis nouveau (processus en parallèle, donc
bruités) : lot1-06 257 → 243 s, lot2-12 238 → 192 à 343 s, lot3-04 102 → 92 à 115 s : dans le bruit de la mesure.

## 6. Ce que cette mesure ne dit pas
Aucune annotation humaine complète : « 0 perdu » est mesuré contre la sortie du moteur d'avant, pas contre une
vérité terrain. Les gains sont jugés par la preuve acoustique, pas à l'oreille ; la liste du §3 est faite pour cela.
