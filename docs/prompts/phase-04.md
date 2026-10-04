# Phase 4 — Adapters audio (à coller dans Claude Code)

Machine : RTX 5090 24 Go, 64 Go RAM. Lis `docs/ARCHITECTURE.md` §3 et `docs/RESEARCH.md`.

1. **B1 `FfmpegAudioExtractor`** : tout format → PCM 16 kHz mono ; tests sur fichiers
   générés (sinus, silence, vidéo courte générée par ffmpeg).
2. **Tests de contrat** (`tests/contract/`) pour chaque port audio, rejoués contre un
   fake ET contre l'adapter réel (marqueur `slow`).
3. **B2 segmenter** : `obadx/recitation-segmenter-v2` + repli Silero VAD derrière le même
   port ; mesure le temps de traitement pour 10 min d'audio.
4. **B4 ASR** : `FastConformerQuranASR` (NeMo, `msyukriafifi/fastconformer-quran-ar`) et
   `WhisperTarteelASR` (`tarteel-ai/whisper-base-ar-quran`), timestamps par mot. Relève
   le **format réel de sortie** de chacun (orthographe, diacritiques) et ajoute ces
   exemples réels aux tests du matcher (phase 2) : c'est le contrat qui compte.
5. **Décodage contraint (option, ADR-0003)** : sur les logits CTC du FastConformer,
   décodage contraint à un trie des séquences coraniques + chemin « poubelle » ;
   comparer à la voie libre sur 20 extraits EveryAyah + 5 extraits non coraniques.
6. Téléchargements de modèles dans `$AQR_MODELS_DIR` (jamais dans git), versions
   épinglées dans un `models/LOCK.json` versionné.
Si une installation lourde (CUDA, PyTorch, NeMo) échoue, arrête-toi et décris
précisément l'erreur plutôt que de contourner.

---
**Règles communes (toutes phases)** : TDD strict (test rouge → code → vert) ; une PR par
brique, fusionnée dans `develop` avant la suivante, SHA vérifié dans `origin/develop` ;
`src/aqr/domain` sans dépendance externe ; aucun seuil en dur (configuration) ;
`pytest`, `ruff check src tests`, `ruff format --check src tests`, `mypy` verts ;
consigne chaque décision non triviale dans `.artist/decision-log.md` ; mets à jour
`docs/PLAN.md` (statut de la phase). Termine par un compte rendu : SHA, sorties réelles
des commandes, métriques, décisions, ce qui reste à trancher par Cherif.

**Signature** : aucune mention de Claude/IA dans les commits et PR (ni `Co-Authored-By`, ni `Claude-Session`, ni « Generated with »), cf. AGENTS.md § Signature.
