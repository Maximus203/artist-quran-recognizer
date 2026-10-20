# Vérification acoustique des suites et temps au mot (ADR-0008) — mesures du 2026-10-20

Statut : **comparaison avec / sans sur les mêmes transcriptions**, pas de vérité terrain humaine. Code :
branche `feat/acoustic-chain-check` ; moteur `fastconformer-quran@b33af7936f9a` (+ Whisper-Tarteel et Muno
pour le micro), segmenteur `recitation-segmenter-v2`, modèle acoustique = FastConformer (sortie CTC), seuil
`min_llr_per_frame` −1,0, plancher de sauvetage 0,5, `energy_ratio` 0,10 ; RTX 5090 Laptop, Windows.
Commande (sorties hors dépôt) :
```bash
PYTHONPATH=src python scripts/measure_acoustic_check.py --models-dir $AQR_MODELS_DIR \
  --everyayah $AQR_AUDIO_DIR/everyayah --lot <lot1-09> <lot1-01> <lot1-06> --out mesure.json
PYTHONPATH=src python scripts/measure_acoustic_check.py --models-dir $AQR_MODELS_DIR \
  --asrs fastconformer,whisper,muno-streaming --micro <sessions micro de l'atelier>
```
`texte` = preuve par la suite sur le texte (ADR-0007, comportement de `develop`) ; `audio` = suites vérifiées
sur le treillis, temps de l'alignement (ADR-0008). Chaque fichier passe une seule fois par l'ASR.

## 0. Bug trouvé en mesurant (corrigé dans la même PR)
NeMo laisse l'encodeur en **mode entraînement** à la fin de `transcribe()` (`encoder.unfreeze()`). Quand le
même FastConformer sert d'ASR puis de modèle acoustique, le treillis tournait avec dropout et mettait à jour
la BatchNorm : treillis bruité, puis transcriptions suivantes ruinées (lot1-01 : 68 versets reconnus → **5**
après 30 treillis ; 155 transcriptions sur 160 changées). Corrigé (`model.eval()` avant chaque treillis),
contrat ajouté sur le vrai modèle. `aqr align` seul (aucune transcription) n'était pas touché. Les mesures
ci-dessous sont celles du code corrigé ; le mode `texte` y retrouve exactement la référence d'ADR-0007
(91,2 % sur EveryAyah), ce que les passages antérieurs au correctif ne faisaient pas (88 à 90 %).

## 1. Voix de Cherif au micro (3 enregistrements, basmala puis 55:1-4)
| Moteur | Texte (ADR-0007) | Audio (ADR-0008) |
|---|---|---|
| FastConformer | 3 / 3 | 3 / 3 |
| Whisper-Tarteel | 3 / 3 | 3 / 3 |
| Muno streaming | **1 / 3** | **3 / 3** |

Muno ampute le début de deux fenêtres (« لَّمَ » et « جَلَّمَ » pour « عَلَّمَ », « مَهُ » pour « عَلَّمَهُ ») :
le matcher ne propose que 55:2 [2-2] ou 55:4 [2-2] (qualité 0,5) et la suite se coupe. Alignée sur l'audio, la
suite 55:1-4 obtient −0,33 à −0,44 par trame ; la même suite décalée d'un verset (55:2-5) −3,0 à −3,8, des
suites étrangères (16:4-7, 1:1-4) −3,7 à −14 (sonde du 2026-10-19). Le verset sauvé couvre ses deux mots
(« عَلَّمَ » est rendu par le corpus), avec les temps de l'alignement.

## 2. EveryAyah (3 récitants × 10 sourates, 216 versets, sourates reconstituées)
| | Rappel `recognized` | Faux versets |
|---|---|---|
| Texte | 197 / 216 = **91,2 %** | 0 |
| Audio | 209 / 216 = **96,8 %** | **0** |

Gains : An-Nas (114) 4/6 → 6/6 (Abdul Basit), 2/6 → 4/6 (Alafasy) ; Al-Kafirun (109) 3/6 → 6/6 (Husary) et
5/6 → 6/6 (les deux autres) ; Al-Fatiha 6/7 → 7/7 (Husary) ; Al-Mulk 28/30 → 29/30 (Alafasy, Husary).

**Limites des versets** (183 versets reconnus entiers dans les deux modes ; référence = étendue d'énergie du
clip à 0,05, convention de `scripts/measure_alignment.py`) :
| | Début : médiane · ≤ 100 ms | Fin : médiane (signée) · ≤ 300 ms · ≤ 500 ms |
|---|---|---|
| Texte (bords de fenêtre) | 63 ms · 98,4 % | 84 ms (+60) · 97,8 % · 98,9 % |
| Audio (alignement) | **21 ms** · 99,5 % | 64 ms (−64) · 92,9 % · 97,8 % |

Les débuts deviennent précis au mot. Les fins médianes aussi, mais elles tombent en moyenne 64 ms **avant**
la référence (l'énergie à 0,10 coupe la queue d'un son qui s'éteint, la référence est à 0,05 : ADR-0006) et
la part sous 300 ms baisse. Bornes de fenêtre gardées : sans elles, la fin d'un verset débordait jusqu'à
+2,7 s dans la pause suivante (Husary 67:4, passage intermédiaire). Le pire cas, identique dans les deux modes
(1:7 de Husary, −4,6 s), vient de la référence (clip à longue traîne), pas du moteur.

**Preuve des suites** (`llr_per_frame`) : 58 suites vraies entre −0,36 et 0 (médiane −0,07). Six suites
« hors sourate » acceptées, toutes des **quasi-homonymes** : 23:78-79 posé sur 67:23-24 (« وَهُوَ الَّذِي
أَنْشَأَ لَكُمُ السَّمْعَ… » contre « قُلْ هُوَ الَّذِي أَنْشَأَكُمْ… »), 32:9 [7-14] ; −0,15 à −0,85. Aucune
n'a produit de faux verset : la vraie suite est promue aussi et le décodeur tranche par le contexte. Un seuil
absolu ne sépare pas des textes qui diffèrent d'un ou deux mots.

Plafond optimiste : EveryAyah est vraisemblablement vu à l'entraînement du modèle. Vérification : 45 s pour
les 30 sourates (≈ 41 min d'audio).

## 3. Audio réel du lot 1 (dev), versets `recognized`
| Fichier | Texte | Audio | Ajouts (relus) | Suites refusées |
|---|---|---|---|---|
| lot1-09 (assise, 30 min) | 7 | 7 | — | 1 / 6 |
| lot1-01 (assise, 26 min) | 68 | 82 | 14 | 0 / 23 |
| lot1-06 (prière, 52 min) | 272 | 276 | 4 | 6 / 70 |

- **lot1-01** : les ajouts sont la récitation d'Al-Qiyama par l'orateur (75:6, 75:7, 75:10-12, 75:20-23,
  75:26-30), y compris 75:22 et 75:23 désormais **séparés au mot** dans une même fenêtre (« وُجُوهٌ يَوْمَئِذٍ
  نَاضِرَةٌ إِلَى رَبِّهَا نَاظِرَةٌ »), et une vraie citation de 12:23 (« وَغَلَّقَتِ الْأَبْوَابَ… قَالَ مَعَاذَ
  اللَّهِ »). Un retrait : la reprise de 75:22 à 583 s devient `uncertain` (75:22 | 75:24) — une suite sauvée
  finit sur 75:24 [1-2] « وَوُجُوهٌ يَوْمَئِذٍ », quasi-homonyme du début de la reprise, et l'audio l'accepte
  (−0,23) : pas de faux verset nommé, une reprise perdue.
- **lot1-06** : 21:62 (que le moteur ne savait que supposer, ADR-0006), 22:10, 22:64, 23:50 ; transcriptions
  concordantes malgré les erreurs de l'ASR. Les 6 suites refusées (−1,27 à −2,42) sont des homonymes d'autres
  sourates : 23:52-53 posé sur 21:92-93 et l'inverse, 19:49 sur 21:72, 34:4-5 sur 22:50-51, 27:68 sur 23:83,
  7:8-9 sur 23:102-103. Le décodeur les écartait déjà par le contexte : la sortie ne change pas.
- **lot1-09** : la suite refusée (17:85, −2,23) est une vraie citation dont la première fenêtre est mal
  transcrite (« وَأونك عنِ الوروح ») ; le verset reste reconnu par sa propre preuve.
- Coût de la vérification : 1,3 s, 7,1 s et 113 s (3,6 % du temps réel sur la prière).

## 4. Suite d'un verset commencé (ajout du 2026-10-20, ADR-0008 § 6-8)
Liste de référence : 81 cas « verset commencé, puis abstention, suite jamais reconnue » sur les fichiers dev du
lot 1 (sorties FastConformer du 2026-10-07, `D:-Dev\Dataqr-out\suites-non-detectees-dev.json`, établie
par la session d'audit ; fichiers test non utilisés). Un cas est résolu si ce verset, ou le suivant, est reconnu
sur le temps de l'abstention. Trois décisions sur les mêmes transcriptions (`--cases`) :

| Fichier | Cas | Texte (ADR-0007) | Suites vérifiées | + suite d'un verset |
|---|---|---|---|---|
| lot1-04 (assise) | 35 | 12 | 15 | **19** |
| lot1-06 (prière) | 24 | 15 | 21 | **24** |
| lot1-05 | 8 | 5 | 8 | 8 |
| lot1-01 | 6 | 1 | 1 | **4** |
| lot1-03 | 3 | 0 | 0 | 0 |
| lot1-12 | 3 | 0 | 1 | 1 |
| lot1-09 | 2 | 1 | 1 | 1 |
| **Total** | **81** | **34** | **47** | **57** |

- 25 suites acceptées (lot1-04 : 9, lot1-01 : 6, lot1-03 : 4, lot1-06 : 3, lot1-09 : 3), relues une à une :
  toutes conformes à la transcription de leur fenêtre (« وَهُدًى », « أَفَلَا تَعْقِلُونَ », « إِلَّا قَلِيلًا »,
  « وَقَالَتْ هَيْتَ لَكَ », « فَنِعْمَ عُقْبَى الدَّارِ »…), preuve −0,67 à 0, similarité 0,61 à 1,00.
- **Second témoin indispensable** : sans lui, 23 suites étaient acceptées sur lot1-04 seul, dont une
  douzaine sur de la parole non coranique (9:24 [22] sur « ليه يال لك هنا انتم », 4:10 [11] sur « نيلك أونج
  تون », cinq homonymes de « هو » sur « لي القران ك تج »), et 12:23 [21] cinq fois sur un commentaire de
  l'orateur (lot1-01). Normaliser la preuve par les seules trames de parole ne les séparait pas (vraies suites
  jusqu'à −2,9, fausses dès −1,6) ; la similarité de Dice avec la transcription à 0,6 les écarte toutes, au
  prix de quelques reprises mal transcrites (12:23 « هيت ل », 17:12 « فمحو آت »).
- Non résolus : surtout des fenêtres de commentaire où l'orateur ne finit pas le verset dans la fenêtre
  suivante (lot1-04 : « يوم محمد صلى… », langue locale), ou des transcriptions trop dégradées.
- Les comptes de versets reconnus peuvent **baisser** (lot1-03 21 → 17, lot1-09 7 → 6) : deux moitiés d'un
  même verset deviennent une seule détection (vérifié : aucune détection n'apparaît ni ne disparaît).
- EveryAyah : 96,8 %, 0 faux, limites inchangées ; micro : inchangé (55:1-4 partout).
- Coût : 2 à 98 s par fichier (lot1-04, 134 min : 22 s).

## Limites
- Pas de vérité humaine : relecture des transcriptions seulement ; seuils provisoires.
- Un seuil absolu ne distingue pas les quasi-homonymes (§ 2, lot1-01 à 583 s) : il faut comparer entre elles
  les suites concurrentes sur les mêmes fenêtres (preuve relative). Non fait.
- `llr_per_frame` est dilué par les pauses : une vraie suite de prière réverbérée a obtenu −1,003 lors d'un
  passage antérieur au correctif ; le seuil −1,0 est au bord pour ce type d'audio.
- Les réponses de l'orateur faites de mots du Coran (« بَلَى إِنَّهُ عَلَى كُلِّ شَيْءٍ قَدِيرٌ » après 75:40 ->
  46:33 [17-21], lot1-01) restent nommées : les mots sont dits, l'audio les soutient (I4, étape D).
