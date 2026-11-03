# Alignement forcé du texte du corpus — mesures du 2026-10-19 (ADR-0006)

Statut : **mesures d'outil, pas de vérité terrain humaine.** Les références de limites sont
construites (étendue d'énergie d'un clip EveryAyah) ou absentes (audio réel) ; aucun seuil n'est
validé à l'oreille. Ce document dit ce qui a tourné, avec quoi, et ce que les chiffres montrent.

## Pins
| Élément | Valeur |
|---|---|
| Code | branche `feat/ctc-forced-alignment` (base `develop` @ `d6560c6`) |
| Modèle | `fastconformer-quran@b33af7936f9a`, sortie CTC (`ctc_decoder` de NeMo), trame de 80 ms |
| Corpus | Tanzil Hafs, `data/corpus/LOCK.json` ; graphies `simple` (sha256 `c8c2ea9e…`) et `simple-clean` |
| Matériel | NVIDIA GeForce RTX 5090 Laptop GPU, Windows 11, torch 2.11.0+cu128, nemo 3.0.0 |
| Audio | EveryAyah local (3 récitants : Abdul Basit, Alafasy, Husary ; sourates 1, 67, 97, 103, 108–110, 112–114) ; lot1-06 (dev, prière, C08) |

## 1. Quelle graphie aligner ? (216 clips d'un verset)
Preuve acoustique `llr_per_frame` du vrai verset contre le meilleur de 4 faux (3 versets de longueur
voisine tirés au hasard, graine 7, et le verset suivant) :

| Graphie | vrai > faux | médiane du vrai |
|---|---|---|
| Uthmani brut | 79,2 % | −2,43 |
| `simple-clean` (sans voyelles) | 93,1 % | −2,06 |
| `simple` (avec voyelles) | 89,8 % | −0,53 |
| meilleure des deux imla'i | 93,1 % (**189 / 189 hors versets 1**) | −0,19 |

Les 15 échecs étaient tous des versets 1 : Tanzil y concatène la basmala, absente des clips. D'où
`recited_span` (basmala exclue d'un verset entier) et l'essai des deux graphies imla'i.

## 2. Limites des versets (85 passages reconstitués, 40,7 min)
Passages = clips consécutifs d'une sourate mis bout à bout (≤ 40 s). Référence de chaque verset =
trames de 20 ms dont la RMS dépasse `ratio_ref` × la RMS maximale de son clip. Commande :
```bash
PYTHONPATH=src python scripts/measure_alignment.py --audio-dir $AQR_AUDIO_DIR/everyayah \
  --models-dir $AQR_MODELS_DIR --energy-ratio <ratio_ref> --boundary-ratios <…> --out <json>
```
Sorties : `docs/evaluation/alignment/everyayah-ref{0.02,0.05,0.1}.json`. Erreurs absolues médianes,
part sous 300 ms, maximum (216 versets) :

| `energy_ratio` de l'aligneur | début | fin (réf. 0,05) | fin (réf. 0,02) | fin (réf. 0,1) |
|---|---|---|---|---|
| désactivé (symboles CTC seuls) | 90 ms · 93 % | 471 ms · 34 % · max 3,98 s | — | — |
| 0,05 | 25 ms · 99 % | 26 ms · 98 % · max 0,38 s | 200 ms · 72 % · max 0,58 s | 90 ms · 94 % · max 0,42 s |
| 0,10 | 20 ms · 100 % | 60 ms · 95 % · max 0,96 s | 294 ms · 51 % · max 0,98 s | 22 ms · 99,5 % · max 0,88 s |
| 0,20 | 20 ms · 99 % | 159 ms · 86 % · max 1,72 s | — | — |

Lecture :
- Les **débuts** sont robustes (20–40 ms, ≥ 96 % sous 300 ms quelle que soit la référence).
- La **fin** dépend de la définition de la fin d'un son qui s'éteint : la référence et l'aligneur
  sont tous deux énergétiques, la mesure est en partie circulaire. Ce qui est établi : sans
  l'énergie, la fin arrive ≈ 0,5 s trop tôt et jusqu'à 4 s de travers (symbole posé sur le
  silence) ; avec, ≥ 86 % des fins sous 500 ms pour toutes les références essayées.
- Plafond optimiste : récitants EveryAyah, audio studio, probablement vus à l'entraînement.
- Calcul : ≈ 0,4 % du temps réel pour l'alignement (Python pur) ; le treillis lui-même est l'inférence
  du FastConformer (≈ 2 % du temps réel sur ce GPU).

## 3. Audio réel : prière lot1-06, 46–160 s, déclaration « 21:51-21:62 »
`aqr align lot1-06.mp3 --verses 21:51-21:62 --at 46-160` (sortie non versionnée). Comparé aux fenêtres
de `aqr recognize --asr fastconformer` du 2026-10-07 (`D:\01-Dev\Data\aqr-out`, pas une vérité) :

| verset | moteur | align 0 | align 0,05 | align 0,15 | align 0,3 |
|---|---|---|---|---|---|
| 21:51 | 47,1–56,8 | 47,2–56,3 | 46,0–57,4 | 47,1–56,7 | 47,2–56,6 |
| 21:53 | `inferred` 68,1–74,8 | 68,6–73,9 | 68,6–74,9 | 68,6–74,4 | 68,6–74,3 |
| 21:56 | 91,8–99,9 | 91,8–104,4 | 91,8–105,3 | 91,8–104,8 | 91,8–104,7 |
| 21:59 | 123,3–132,1 | 123,4–131,5 | 123,4–132,0 | 123,4–131,9 | 123,4–131,2 |
| 21:62 | `inferred` 150,7–159,6 | 151,5–159,0 | 151,4–160,0 | 151,4–159,2 | 151,4–159,0 |

- Preuve acoustique : **−0,26** par trame pour la bonne déclaration, **−1,47** pour une déclaration
  décalée d'un verset (21:52-21:63) : la vérification distingue la bonne suite.
- 21:53 et 21:62, que le moteur ne savait que supposer, sont placés dans leur trou.
- 21:56 s'étire jusqu'à ≈ 104,5 s même sans énergie : le modèle y place lui-même les derniers mots.
  Le moteur s'abstenait sur 100–105 s : vraisemblablement une **reprise** de la fin du verset, à
  déclarer (« 21:56, 21:56[x-8] ») après écoute. Non vérifié à l'oreille.
- Réverbération de mosquée : à 0,05 l'énergie ne retombe pas entre les versets (début de 21:51 tiré
  jusqu'au bord du passage, fins collées au verset suivant) ; de 0,15 à 0,3 les limites rejoignent
  les pauses. **Défaut provisoire retenu : 0,10**, compromis mesuré des deux côtés.

## Ce que cela ne montre pas
Aucune limite validée à l'oreille ; une seule prière réelle, un seul passage ; pas d'assise ni de
parole non coranique ; pas de mesure sur le jeu test. Prochaine mesure défendable : les limites que
l'humain valide dans l'atelier (étape A).
