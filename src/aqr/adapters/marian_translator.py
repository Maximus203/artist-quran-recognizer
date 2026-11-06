"""Traducteur arabe → français : Marian (`Helsinki-NLP/opus-mt-ar-fr`), modèle de traduction dédié.

Ce n'est pas un modèle de conversation : il traduit la phrase reçue, sans consigne ni contexte, en
recherche par faisceau déterministe (ADR-0027). Il ne sert jamais au texte coranique : le garde-fou
du service retient avant lui tout passage qui ressemble au Coran.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from aqr.freespeech.ports import FrenchText

DEFAULT_MODEL_NAME = "opus-mt-ar-fr"


@dataclass(frozen=True)
class MarianConfig:
    model_dir: Path
    """Dossier local des poids (`<AQR_MODELS_DIR>/opus-mt-ar-fr`), sans téléchargement implicite."""
    device: str = "auto"
    num_beams: int = 4
    max_new_tokens: int = 256


class MarianTranslator:  # pragma: no cover - modèle réel (banc et tests `slow`)
    def __init__(self, config: MarianConfig) -> None:
        self._config = config
        self._model: Any = None
        self._tokenizer: Any = None
        self._device = "cpu"

    @property
    def engine(self) -> str:
        return f"marian/{self._config.model_dir.name}"

    def _load(self) -> None:
        if self._model is not None:
            return
        import torch
        from transformers import MarianMTModel, MarianTokenizer

        cfg = self._config
        if not cfg.model_dir.is_dir():
            raise FileNotFoundError(
                f"modèle de traduction absent : {cfg.model_dir} "
                "(`python scripts/fetch_free_speech_models.py`)"
            )
        self._device = "cuda" if cfg.device == "auto" and torch.cuda.is_available() else cfg.device
        if self._device == "auto":
            self._device = "cpu"
        self._tokenizer = MarianTokenizer.from_pretrained(str(cfg.model_dir), local_files_only=True)
        self._model = MarianMTModel.from_pretrained(str(cfg.model_dir), local_files_only=True).to(
            self._device
        )
        self._model.eval()

    def translate(self, arabic: str) -> FrenchText:
        import torch

        self._load()
        batch = self._tokenizer([arabic], return_tensors="pt", truncation=True).to(self._device)
        with torch.no_grad():
            out = self._model.generate(
                **batch,
                num_beams=self._config.num_beams,
                do_sample=False,
                max_new_tokens=self._config.max_new_tokens,
            )
        text = self._tokenizer.batch_decode(out, skip_special_tokens=True)[0]
        return FrenchText(text.strip(), self.engine)
