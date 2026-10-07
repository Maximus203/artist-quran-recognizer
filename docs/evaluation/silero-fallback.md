# Repli Silero VAD : mesure de fond, pas de verdict de précision

Date des mesures : 2026-10-06. Script : `scripts/measure_segmenters.py`.

## Conclusion

**Le repli `SileroVadSegmenter` avec ses réglages par défaut (`min_silence_ms=100`,
`min_speech_ms=250`) n'est pas fiable par défaut pour la récitation à pauses longues** : sur
l'extrait mesuré il produit des fragments d'environ un mot (53 % de segments < 1 s) là où
recitation-segmenter-v2 donne 7 segments de 11 à 28 s. Aucune valeur de `min_silence_ms` du
balayage ne convient aux deux extraits : 800 ms laisse encore 36 % de segments < 1 s sur le premier
et produit un segment de 131 s sur le second (au-delà de la fenêtre de 30 s de Whisper).

Limite de la mesure : **il n'y a pas de vérité terrain ici**. Rien ci-dessous n'est une précision
ou un rappel ; ce sont des statistiques de forme de la segmentation. Le caractère « fragmenté » se
voit sans vérité terrain ; le « bon » découpage, non. Le comportement par défaut n'est donc pas
modifié (voir Propositions).

## Méthode

- Audio : `lot1-05.mp3` (récitation Husary, pauses longues), extrait 60-240 s ; `lot1-06.mp3`,
  extrait 600-780 s. Fichiers lus hors dépôt, rien copié.
- Segmenteurs via leurs adapters (`aqr.adapters.segmenters`, `FfmpegAudioExtractor`), 16 kHz mono.
- Matériel : CPU 4 cœurs, pas de GPU, `OMP_NUM_THREADS=2`. torch 2.14.1+cpu, silero-vad 6.2.3,
  recitations-segmenter 1.0.0.
- recitation-segmenter-v2 : config par défaut, `device="cpu"` (float32 ; le bf16 par défaut ne
  s'applique pas au CPU). Silero : balayage de `min_silence_ms` dans (100, 300, 500, 800), reste aux
  défauts (`threshold=0.5`, `min_speech_ms=250`, `speech_pad_ms=30`).
- Le temps de calcul inclut le chargement du modèle. Une seule exécution par ligne : pas de
  répétition, donc pas d'incertitude estimée sur les temps.
- Budget de calcul : l'exécution de v2 sur CPU (~5 min) a consommé l'essentiel des 10 minutes
  allouées ; **v2 n'a pas été exécuté sur le second extrait**.

## Résultats

Extrait 1 : `lot1-05.mp3`, 60-240 s (180 s).

| Segmenteur | Segments | Médiane | Min | Max | Part < 1 s | Couverture | Calcul |
|---|---|---|---|---|---|---|---|
| recitation-segmenter-v2 (défaut, CPU) | 7 | 17,49 s | 11,20 s | 27,69 s | 0,0 % | 74,2 % | 298,6 s |
| Silero `min_silence_ms=100` (défaut) | 30 | 0,90 s | 0,30 s | 9,30 s | 53,3 % | 31,2 % | 2,52 s |
| Silero 300 | 23 | 1,10 s | 0,40 s | 11,20 s | 43,5 % | 32,4 % | 2,17 s |
| Silero 500 | 19 | 1,60 s | 0,40 s | 11,20 s | 36,8 % | 33,8 % | 1,58 s |
| Silero 800 | 14 | 4,70 s | 0,40 s | 11,20 s | 35,7 % | 36,4 % | 1,48 s |

Extrait 2 : `lot1-06.mp3`, 600-780 s (180 s), Silero seul.

| Segmenteur | Segments | Médiane | Min | Max | Part < 1 s | Couverture | Calcul |
|---|---|---|---|---|---|---|---|
| Silero `min_silence_ms=100` (défaut) | 22 | 7,70 s | 0,30 s | 15,20 s | 9,1 % | 95,9 % | 2,55 s |
| Silero 300 | 5 | 32,70 s | 8,20 s | 62,30 s | 0,0 % | 97,8 % | 1,66 s |
| Silero 500 | 3 | 32,70 s | 13,70 s | 131,10 s | 0,0 % | 98,6 % | 1,60 s |
| Silero 800 | 2 | 89,00 s | 46,90 s | 131,10 s | 0,0 % | 98,9 % | 1,53 s |

« Couverture » = somme des durées de segments / durée de l'extrait. Elle ne dit pas si ce qui est
couvert est de la parole utile ni si les bornes sont justes.

## Lecture (et ce qu'elle ne permet pas de dire)

- Sur l'extrait 1, le défaut de Silero fragmente en quasi-mots ; élargir `min_silence_ms` réduit le
  nombre de segments mais la part de fragments courts reste élevée (36 % à 800 ms).
- Sur l'extrait 2 (parole quasi continue, couverture ~96 %), le même balayage va d'un découpage
  raisonnable (défaut, médiane 7,7 s) à des segments de plus de 2 minutes. Un réglage qui corrige
  l'extrait 1 dégrade donc l'extrait 2 : l'écueil est celui d'un seuil unique, pas d'un mauvais
  chiffre à ajuster.
- La couverture de Silero sur l'extrait 1 (31-36 %) est très inférieure à celle de v2 (74 %) ; sans
  vérité terrain on ne sait pas si v2 inclut des pauses dans ses segments ou si Silero perd de la
  parole. Non tranché.
- Écart avec l'observation antérieure rapportée (34 fragments Silero, 9 segments v2, 5 détections en
  aval) : cette mesure donne 30 et 7. Causes non établies (bornes d'extrait, version, device/dtype de
  v2 : CPU float32 ici). Les détections en aval n'ont pas été remesurées. Ce document ne s'appuie
  pas sur les chiffres antérieurs.
- Coût de v2 sur CPU : 298,6 s pour 180 s d'audio (sans GPU, 2 threads, une exécution) ; non
  comparable à la mesure GPU de `.artist/decision-log.md`.

## Propositions (non appliquées)

Aucun défaut n'a été modifié : sans vérité terrain, un réglage ajusté sur ces deux extraits serait
du surapprentissage et ne respecterait pas « seuils calibrés par benchmark ».

1. Ajouter à `tests/fixtures/audio/manifest.yaml` des cas de récitation à pauses longues avec bornes
   de versets vérifiées, puis calibrer le repli sur ce manifeste (précision des détections en aval,
   I3 d'abord).
2. Étudier pour le repli une fusion de segments voisins (écart < X s) bornée par une durée maximale
   (fenêtre Whisper de 30 s), X et le plafond étant des paramètres de configuration.
3. Faire remonter à la CLI/au rapport qu'une bascule a eu lieu (`FallbackSegmenter.last_used`) et
   marquer les détections correspondantes comme dégradées, jusqu'à preuve du contraire.
4. Ne passer `RELIABLE_BY_DEFAULT` à `True` qu'après (1), avec les chiffres consignés ici.

## Reproduire

```bash
OMP_NUM_THREADS=2 PYTHONPATH=src python scripts/measure_segmenters.py \
  --audio <lot1-05.mp3> --start 60 --duration 180 --models-dir <AQR_MODELS_DIR> \
  --lock models/LOCK.json --out mesure.json
# second extrait, Silero seul (rapide) :
#   --audio <lot1-06.mp3> --start 600 --duration 180 --skip-v2
```
