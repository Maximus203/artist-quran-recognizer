# Preuve cumulée par la suite (ADR-0007) — mesures du 2026-10-19

Statut : **comparaison avec / sans sur les mêmes transcriptions**, pas de vérité terrain humaine. Code :
branche `feat/chain-proof` ; moteur `fastconformer-quran@b33af7936f9a` (+ Whisper et Muno pour le micro),
segmenteur `recitation-segmenter-v2`, RTX 5090 Laptop, Windows. Script hors dépôt (mêmes fenêtres et mêmes
transcriptions, seule la décision change).

## 1. Voix de Cherif au micro (3 enregistrements, basmala puis 55:1-4)
| Moteur | Avant | Après |
|---|---|---|
| FastConformer | 5 abstentions | 55:1, 55:2, 55:3, 55:4 `recognized` |
| Whisper-Tarteel | basmala + 4 abstentions | basmala + 55:1-4 `recognized` |
| Muno streaming | basmala + 4 abstentions | inchangé : « عَلَّمَ » transcrit « لَّمَ » (début de fenêtre amputé), le maillon tombe sous la qualité exigée et la suite se coupe |

Chaque fenêtre était bien transcrite ; seule la décision fenêtre par fenêtre (2 mots = 0,40 < 0,75) bloquait.

## 2. EveryAyah (3 récitants × 10 sourates, 216 versets, sourates reconstituées)
| | Rappel `recognized` | Faux versets |
|---|---|---|
| Sans | 155 / 216 = **71,8 %** | 0 |
| Avec | 197 / 216 = **91,2 %** | **0** |

Gains les plus nets : Al-Fatiha 2/7 → 7/7 (Alafasy, Abdul Basit), 6/7 (Husary) ; 108 0–1/3 → 3/3 ; 112 1/4 → 4/4
(Husary). Restent manquants : surtout An-Nas (114, fins de versets identiques) et Al-Kafirun (109, versets
répétés : l'ambiguïté reste `uncertain`, voulu). Plafond optimiste : EveryAyah vraisemblablement vu à
l'entraînement.

## 3. Audio réel du lot 1 (dev), versets `recognized`
| Fichier | Sans | Avec | Nouveaux |
|---|---|---|---|
| lot1-09 (assise en français, C09) | 5 | 7 | 22:5 [19-24] « ثُمَّ مِنْ مُضْغَةٍ / مُخَلَّقَةٍ وَغَيْرِ مُخَلَّقَةٍ », 17:85 [4-8] « قُلِ الرُّوح / مِنْ أَمْرِ رَبِّي » : citations réelles en deux souffles (transcriptions relues) |
| lot1-01 (assise, C09/C11) | 45 | 68 | sourate 75 seulement (75:5 à 75:35, avec 75:7-8 répétés trois fois) : récitation d'Al-Qiyama par l'orateur |
| lot1-06 (prière, C08) | 271 | 272 | 21:53 (supposé `inferred` auparavant), 22:59, 23:22 |

Aucun nouveau verset hors d'une suite coranique cohérente ; **non vérifié à l'oreille** (étape A).

## Limites
Pas de vérité humaine ; seuils provisoires (`ChainConfig`) ; la vérification acoustique de la suite (suite de
l'étape B) n'est pas encore là pour rattraper un maillon mal transcrit (cas Muno).
