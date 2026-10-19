# `aqr align` — contrat de sortie `aqr.alignment/1` (ADR-0006)

```bash
aqr align FICHIER --verses SPEC [--at DEBUT-FIN] [--out-dir DIR] [--force]
                  [--models-dir D] [--lock models/LOCK.json] [--corpus-dir data/corpus]
                  [--device auto|cpu|cuda] [--energy-ratio R]
```
`--verses` : ce qui est récité, **dans l'ordre**, séparé par des virgules : `112:1-4`, `21:51-23:118`
(à travers les sourates), `2:255[1-10]` (plage de mots Uthmani), reprise : `1:7, 1:7[5-9]`. Un verset
entier exclut la basmala que Tanzil concatène au verset 1. `--at` : passage en secondes (défaut : tout
le fichier, au plus 120 s). `--energy-ratio 0` désactive l'affinage des limites par l'énergie.
Codes : 0 succès · 1 erreur sur les données (fichier absent, sortie déjà présente sans `--force`,
passage invalide, texte trop long pour le passage) · 2 utilisation impossible (`--verses` illisible,
`AQR_MODELS_DIR` absent). Modèle : FastConformer (seul ASR qui expose un treillis CTC).

## JSON (`<fichier>.alignment.json`)
```
{"schema": "aqr.alignment/1", "kind": "forced_alignment", "notice": "...",
 "source": {"file", "sha256", "duration_s"},
 "declared": "21:51-21:62", "passage": {"t": [46.0, 160.0]},
 "engine": {"model": "fastconformer-quran@b33af7936f9a/ctc", "corpus": "tanzil.net hafs (...)"},
 "config": {"energy_ratio": 0.1, "verse_end_extension_s": 0.0, "variants": ["simple", "simple_clean"]},
 "variant": "simple",
 "evidence": {"llr_per_frame": -0.26, "forced_logprob": ..., "free_logprob": ..., "frames": 1425},
 "spans": [{"ref": "21:51", "words": [1, 9], "t": [47.1, 56.7], "word_times": [[1, 47.1, 48.0], ...]}]}
```

## Ce que la sortie AFFIRME
- Où les versets **déclarés** seraient dits si la déclaration est juste ; jamais qu'ils le sont. Ce n'est
  pas une reconnaissance (pas de statut `recognized`) : une vérité terrain exige l'écoute humaine.
- `evidence.llr_per_frame` ≤ 0 : proche de 0, l'audio soutient le texte déclaré ; nettement négatif,
  la déclaration ne colle pas (mauvais verset, reprise oubliée, passage mal choisi). Seuil non calibré.
- `words` et `word_times` : indices de mots **Uthmani** (ceux du rendu, `CorpusRepository.words`).
- Aucun texte n'est écrit : le texte d'un verset se lit dans le corpus (I1).
