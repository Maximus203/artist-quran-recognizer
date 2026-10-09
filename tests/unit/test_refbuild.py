"""Construction du corpus de référence de bout en bout (sources synthétiques, vrai ffmpeg)."""

from __future__ import annotations

import random
import shutil
from array import array
from pathlib import Path

import pytest
from tests.unit.test_data_mixer import CORPUS_DIR, SyntheticProvider

from aqr.corpus.tanzil_repository import TanzilCorpusRepository
from aqr.data.degrade import read_samples, rms
from aqr.data.ingest import sha256_file
from aqr.data.manifest import Manifest
from aqr.data.refbuild import (
    BuildReport,
    build_ref_corpus,
    ensure_outside_repo,
)
from aqr.data.refcorpus import Degradation, RefCorpusError, ref_meta, validate_ref_manifest
from aqr.domain.models import NonQuranKind

pytestmark = [
    pytest.mark.skipif(not (CORPUS_DIR / "LOCK.json").exists(), reason="corpus non téléchargé"),
    pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg requis"),
]

DEGRADATIONS = (
    Degradation("noise", {"snr_db": 10, "seed": 1}),
    Degradation("telephone"),
    Degradation("silence_pad", {"pad_s": 2}, shift_s=2.0),
)


class FourReciters(SyntheticProvider):
    def reciters(self) -> tuple[str, ...]:
        return ("recit_a", "recit_b", "recit_c", "recit_d")

    def speech(self, kind: NonQuranKind, rng: random.Random) -> array[int] | None:
        if kind is NonQuranKind.OTHER_LANGUAGE:
            return None
        return super().speech(kind, rng)


@pytest.fixture(scope="module")
def built(tmp_path_factory: pytest.TempPathFactory) -> tuple[BuildReport, Path, Path]:
    out = tmp_path_factory.mktemp("aqr-ref")
    manifest = tmp_path_factory.mktemp("manifest") / "manifest.yaml"
    corpus = TanzilCorpusRepository(CORPUS_DIR)
    report = build_ref_corpus(
        FourReciters(corpus),
        corpus,
        out,
        manifest,
        seed=3,
        per_scenario=2,
        scenarios=("murattal_continu", "assise_fr", "priere"),
        degradations=DEGRADATIONS,
    )
    return report, out, manifest


def test_manifeste_valide_et_ecrit(built: tuple[BuildReport, Path, Path]) -> None:
    report, _out, manifest = built
    assert report.problems == []
    assert Manifest.load(manifest).cases == report.manifest.cases


def test_sha256_correspond_aux_fichiers(built: tuple[BuildReport, Path, Path]) -> None:
    report, out, _ = built
    for case in report.manifest.cases:
        assert sha256_file(out / case.file) == case.sha256, case.id


def test_toutes_les_conditions_presentes(built: tuple[BuildReport, Path, Path]) -> None:
    report, _out, _ = built
    conditions = {ref_meta(c).condition for c in report.manifest.cases}
    assert conditions == {"clean", "noise", "telephone", "silence_pad", "silence", "off_target"}
    skipped = dict(report.skipped)
    assert "off_target:other_language" in skipped  # source absente : écartée avec sa raison


def test_recitants_disjoints_dev_test(built: tuple[BuildReport, Path, Path]) -> None:
    report, _out, _ = built
    split_of: dict[str, set[str | None]] = {}
    for case in report.manifest.cases:
        split_of.setdefault(case.recitant, set()).add(case.split)
    assert all(len(v) == 1 for v in split_of.values())
    assert {c.split for c in report.manifest.cases} == {"dev", "test"}


def test_degradations_gardent_la_verite(built: tuple[BuildReport, Path, Path]) -> None:
    report, out, _ = built
    by_id = {c.id: c for c in report.manifest.cases}
    children = [c for c in report.manifest.cases if ref_meta(c).parent]
    assert children
    for child in children:
        parent = by_id[ref_meta(child).parent or ""]
        shift = ref_meta(child).degradation.shift_s  # type: ignore[union-attr]
        assert [(i.ref, i.words, i.status) for i in child.expected] == [
            (i.ref, i.words, i.status) for i in parent.expected
        ]
        for c_item, p_item in zip(child.expected, parent.expected, strict=True):
            assert c_item.t == pytest.approx((p_item.t[0] + shift, p_item.t[1] + shift))
        assert child.duree_s == pytest.approx((parent.duree_s or 0) + shift, abs=0.15)
    pad = next(c for c in children if ref_meta(c).condition == "silence_pad")
    samples, rate = read_samples(out / pad.file)
    assert rms(samples[: 2 * rate]) == 0  # la vérité décalée de 2 s tombe sur de l'audio réel
    assert rms(samples[2 * rate :]) > 0


def test_cas_hors_cible_et_silence(built: tuple[BuildReport, Path, Path]) -> None:
    report, _out, _ = built
    quiet = [c for c in report.manifest.cases if ref_meta(c).non_quran]
    assert {ref_meta(c).condition for c in quiet} == {"silence", "off_target"}
    for case in quiet:
        assert case.expected == () and len(case.non_quran) == 1
        assert case.non_quran[0].t == (0.0, case.duree_s)


def test_reconstruction_idempotente_et_jeux_figes(built: tuple[BuildReport, Path, Path]) -> None:
    first, out, manifest = built
    corpus = TanzilCorpusRepository(CORPUS_DIR)
    again = build_ref_corpus(
        FourReciters(corpus),
        corpus,
        out,
        manifest,
        seed=3,
        per_scenario=2,
        scenarios=("murattal_continu", "assise_fr", "priere"),
        degradations=DEGRADATIONS,
    )
    assert again.manifest.cases == first.manifest.cases
    assert validate_ref_manifest(again.manifest) == []


def test_sortie_dans_le_depot_refusee(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    (repo / "data").mkdir(parents=True)
    with pytest.raises(RefCorpusError):
        ensure_outside_repo(repo / "data", repo)
    ensure_outside_repo(tmp_path / "aqr-ref", repo)
