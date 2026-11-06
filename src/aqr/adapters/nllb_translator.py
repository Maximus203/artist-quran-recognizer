"""Traducteur arabe → français : NLLB-200 (Meta), modèle de traduction dédié multilingue.

Comme le Marian (`marian_translator`), c'est un modèle de traduction, pas de conversation : il
traduit la phrase reçue, sans consigne ni contexte, en recherche par faisceau déterministe
(ADR-0027). Licence des poids : CC-BY-NC-4.0 (usage non commercial, ce qui est celui du projet).
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from aqr.freespeech.ports import FrenchText

DEFAULT_MODEL_NAME = "nllb-200-distilled-1.3B"
SOURCE_LANGUAGE = "arb_Arab"
TARGET_LANGUAGE = "fra_Latn"


@dataclass(frozen=True)
class NllbConfig:
    model_dir: Path
    """Dossier local des poids (`<AQR_MODELS_DIR>/nllb-200-distilled-1.3B`), sans téléchargement."""
    device: str = "auto"
    num_beams: int = 4
    max_new_tokens: int = 256


class NllbTranslator:  # pragma: no cover - modèle réel (banc)
    def __init__(self, config: NllbConfig) -> None:
        self._config = config
        self._model: Any = None
        self._tokenizer: Any = None
        self._device = "cpu"

    @property
    def engine(self) -> str:
        return f"nllb/{self._config.model_dir.name}"

    def _load(self) -> None:
        if self._model is not None:
            return
        import torch
        from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

        cfg = self._config
        if not cfg.model_dir.is_dir():
            raise FileNotFoundError(f"modèle de traduction absent : {cfg.model_dir}")
        self._device = "cuda" if cfg.device == "auto" and torch.cuda.is_available() else cfg.device
        if self._device == "auto":
            self._device = "cpu"
        self._tokenizer = AutoTokenizer.from_pretrained(
            str(cfg.model_dir), src_lang=SOURCE_LANGUAGE, local_files_only=True
        )
        self._model = AutoModelForSeq2SeqLM.from_pretrained(
            str(cfg.model_dir), local_files_only=True
        ).to(self._device)
        self._model.eval()

    def translate_back(self, french: str) -> str:
        """Français → arabe, pour le contrôle par aller-retour (jamais affiché)."""
        import torch

        self._load()
        self._tokenizer.src_lang = TARGET_LANGUAGE
        try:
            batch = self._tokenizer([french], return_tensors="pt", truncation=True).to(self._device)
        finally:
            self._tokenizer.src_lang = SOURCE_LANGUAGE
        with torch.no_grad():
            out = self._model.generate(
                **batch,
                forced_bos_token_id=self._tokenizer.convert_tokens_to_ids(SOURCE_LANGUAGE),
                num_beams=self._config.num_beams,
                do_sample=False,
                max_new_tokens=self._config.max_new_tokens,
            )
        return str(self._tokenizer.batch_decode(out, skip_special_tokens=True)[0]).strip()

    def translate(self, arabic: str) -> FrenchText:
        import torch

        self._load()
        batch = self._tokenizer([arabic], return_tensors="pt", truncation=True).to(self._device)
        with torch.no_grad():
            out = self._model.generate(
                **batch,
                forced_bos_token_id=self._tokenizer.convert_tokens_to_ids(TARGET_LANGUAGE),
                num_beams=self._config.num_beams,
                do_sample=False,
                max_new_tokens=self._config.max_new_tokens,
            )
        text = self._tokenizer.batch_decode(out, skip_special_tokens=True)[0]
        return FrenchText(text.strip(), self.engine)
