"""Modèles utilisés par les adapters : dépôt Hugging Face, fichiers retenus, licence.

Seuls les fichiers listés sont téléchargés (le dépôt `fastconformer-quran-ar` contient 9
checkpoints : on ne retient que le dernier, `phase3_full`, WER 0,14 % annoncé sur EveryAyah).
Révisions et empreintes : `models/LOCK.json` (versionné), jamais ici.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ModelSpec:
    key: str
    repo_id: str
    files: tuple[str, ...]
    license: str
    role: str


MODELS: dict[str, ModelSpec] = {
    spec.key: spec
    for spec in (
        ModelSpec(
            key="fastconformer-quran",
            repo_id="msyukriafifi/fastconformer-quran-ar",
            files=("phase3_full/phase3_full_wer0.0014.nemo",),
            license="cc-by-4.0",
            role="B4 ASR Coran (NeMo, hybride RNNT/CTC)",
        ),
        ModelSpec(
            key="whisper-base-quran",
            repo_id="tarteel-ai/whisper-base-ar-quran",
            files=(
                "config.json",
                "preprocessor_config.json",
                "tokenizer_config.json",
                "vocab.json",
                "merges.txt",
                "normalizer.json",
                "added_tokens.json",
                "special_tokens_map.json",
                "pytorch_model.bin",
            ),
            license="apache-2.0",
            role="B4 ASR Coran challenger (Whisper)",
        ),
        ModelSpec(
            key="recitation-segmenter",
            repo_id="obadx/recitation-segmenter-v2",
            files=("config.json", "preprocessor_config.json", "model.safetensors"),
            license="mit",
            role="B2 segmentation en pauses (Wav2Vec2-BERT)",
        ),
    )
}
