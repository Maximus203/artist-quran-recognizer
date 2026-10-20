"""Fabrique de `aqr recognize` : la vérification acoustique (ADR-0008) est branchée quand les poids
du FastConformer sont là, quel que soit l'ASR ; sinon elle est signalée absente, jamais silencieuse.

Aucun modèle n'est chargé ici : les adapters sont paresseux, seule la présence du fichier compte.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from aqr.models.registry import MODELS
from aqr.pipeline.factory import ACOUSTIC_UNAVAILABLE, RecognizeOptions, build_recognizer

REPO = Path(__file__).resolve().parents[2]
CORPUS_DIR = REPO / "data" / "corpus"
pytestmark = pytest.mark.skipif(
    not (CORPUS_DIR / "quran-simple.txt").exists(),
    reason="corpus non téléchargé : lancer `python scripts/fetch_corpus.py` d'abord",
)


def _options(models_dir: Path, **kwargs) -> RecognizeOptions:
    return RecognizeOptions(
        models_dir=models_dir,
        lock_path=REPO / "models" / "LOCK.json",
        corpus_dir=CORPUS_DIR,
        translation_id=None,
        **kwargs,
    )


def _with_fastconformer(models_dir: Path) -> Path:
    spec = MODELS["fastconformer-quran"]
    checkpoint = models_dir / spec.key / spec.files[0]
    checkpoint.parent.mkdir(parents=True)
    checkpoint.write_bytes(b"")
    return models_dir


@pytest.mark.parametrize("asr", ["whisper", "fastconformer", "muno-streaming"])
def test_fastconformer_present_la_verification_acoustique_est_branchee(tmp_path, asr):
    recognizer = build_recognizer(_options(_with_fastconformer(tmp_path), asr=asr), {})
    acoustic = recognizer.pipeline._acoustic
    assert acoustic is not None
    assert acoustic.engine.startswith("fastconformer-quran@")
    assert "inconnue" not in acoustic.engine  # révision épinglée, même avant chargement
    assert ACOUSTIC_UNAVAILABLE not in " ".join(recognizer.pipeline._warnings)


def test_l_asr_fastconformer_sert_aussi_de_modele_acoustique(tmp_path):
    recognizer = build_recognizer(_options(_with_fastconformer(tmp_path), asr="fastconformer"), {})
    assert recognizer.pipeline._acoustic._model is recognizer.pipeline._asr


def test_fastconformer_absent_comportement_textuel_et_avertissement(tmp_path):
    recognizer = build_recognizer(_options(tmp_path, asr="whisper"), {})
    assert recognizer.pipeline._acoustic is None
    assert any(ACOUSTIC_UNAVAILABLE in w for w in recognizer.pipeline._warnings)


def test_desactivee_sur_demande_sans_avertissement(tmp_path):
    options = _options(_with_fastconformer(tmp_path), asr="whisper", acoustic_check=False)
    recognizer = build_recognizer(options, {})
    assert recognizer.pipeline._acoustic is None
    assert not any(ACOUSTIC_UNAVAILABLE in w for w in recognizer.pipeline._warnings)
