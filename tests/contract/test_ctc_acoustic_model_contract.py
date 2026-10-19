"""Contrat du port `CtcAcousticModel` contre le FastConformer réel (`slow`, GPU conseillé).

Ressources lues dans l'environnement (`AQR_MODELS_DIR`, `AQR_AUDIO_DIR`) ; absentes, le test saute.
Ce qui est vérifié : un treillis normalisé, aux temps absolus du passage ; un encodeur dont le
découpage ne traverse pas les espaces (l'aligneur encode mot par mot) ; et, de bout en bout avec
`PassageAligner`, que le texte du corpus du verset dit est préféré à un autre et tient dans le clip.
"""

from __future__ import annotations

import math
from pathlib import Path

import pytest
from tests.support.real import LOCK_PATH, everyayah_clip, models_dir

from aqr.alignment.forced import PassageAligner
from aqr.corpus.alignment_text import AlignmentTexts, recited_span
from aqr.domain.models import TimeSpan, VerseRef, WordSpan

pytestmark = pytest.mark.slow
CORPUS_DIR = Path(__file__).resolve().parents[2] / "data" / "corpus"


@pytest.fixture(scope="module")
def model():  # type: ignore[no-untyped-def]
    from aqr.adapters.fastconformer import FastConformerConfig, FastConformerQuranASR

    return FastConformerQuranASR(FastConformerConfig(models_dir=models_dir(), lock_path=LOCK_PATH))


@pytest.fixture(scope="module")
def texts():  # type: ignore[no-untyped-def]
    if not (CORPUS_DIR / "quran-simple.txt").exists():
        pytest.skip("corpus (avec quran-simple.txt) absent : `python scripts/fetch_corpus.py`")
    from aqr.corpus.tanzil_repository import TanzilCorpusRepository

    return AlignmentTexts.from_corpus_dir(CORPUS_DIR, TanzilCorpusRepository(CORPUS_DIR))


def test_treillis_normalise_et_en_temps_absolus(model):  # type: ignore[no-untyped-def]
    clip = everyayah_clip("Alafasy_128kbps", "112001.mp3")
    duration = len(clip.samples) / clip.sample_rate
    lattice = model.lattice(clip, TimeSpan(0.5, duration))
    assert lattice.start_s == 0.5
    assert lattice.frames == pytest.approx((duration - 0.5) / lattice.frame_s, abs=2)
    for row in lattice.log_probs[:: max(1, lattice.frames // 5)]:
        assert math.log(sum(math.exp(v) for v in row)) == pytest.approx(0.0, abs=1e-3)
    assert 0 <= lattice.blank < len(lattice.log_probs[0])


def test_encodage_mot_par_mot_egal_a_l_encodage_du_texte(model):  # type: ignore[no-untyped-def]
    text = "قُلْ هُوَ اللَّهُ أَحَدٌ"
    assert model.encode(text) == tuple(s for w in text.split() for s in model.encode(w))


def test_le_verset_dit_est_aligne_dans_le_clip_et_prefere(model, texts):  # type: ignore[no-untyped-def]
    clip = everyayah_clip("Alafasy_128kbps", "112001.mp3")
    duration = len(clip.samples) / clip.sample_rate
    lattice = model.lattice(clip, TimeSpan(0.0, duration))
    aligner = PassageAligner(texts, model.encode)
    said = aligner.align(
        lattice, [recited_span(VerseRef(112, 1), texts.word_count(VerseRef(112, 1)))]
    )
    other = aligner.align(lattice, [WordSpan(VerseRef(112, 3), 1, 4)])
    assert said is not None
    assert [w.word for w in said.spans[0].words] == [5, 6, 7, 8]  # après la basmala de Tanzil
    assert 0.0 <= said.spans[0].time.start_s < said.spans[0].time.end_s <= duration
    assert other is None or other.evidence.llr_per_frame < said.evidence.llr_per_frame - 0.5
