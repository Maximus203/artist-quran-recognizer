"""Corpus de référence : schéma figé, sérialisation, disjonction des jeux, dégradations."""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import pytest

from aqr.data.config import DataConfig
from aqr.data.manifest import AudioCase, ExpectedItem, Manifest, NonQuranItem, WordRange
from aqr.data.refcorpus import (
    LICENSE_UNESTABLISHED,
    REF_SCHEMA_VERSION,
    Degradation,
    RefCorpusError,
    RefMeta,
    assign_ref_splits,
    degraded_case,
    ref_meta,
    validate_ref_manifest,
    with_ref_meta,
)
from aqr.domain.models import NonQuranKind, Status, VerseRef

SHA_A = "a" * 64
SHA_B = "b" * 64


def clean_case(case_id: str = "mix-a-1", recitant: str = "Alafasy_128kbps") -> AudioCase:
    case = AudioCase(
        id=case_id,
        file=f"mix/{case_id}.wav",
        sha256=SHA_A,
        categorie=("C01",),
        recitant=recitant,
        riwaya="hafs",
        langues=("ar",),
        license=LICENSE_UNESTABLISHED,
        duree_s=12.5,
        statut="annote",
        source="everyayah.com/data/Alafasy_128kbps",
        origine="mix",
        boundaries="approximate",
        expected=(
            ExpectedItem((0.0, 4.0), VerseRef(112, 1), WordRange.all(), Status.RECOGNIZED),
            ExpectedItem((4.35, 8.0), VerseRef(112, 2), WordRange(1, 2), Status.INFERRED),
        ),
        non_quran=(NonQuranItem((8.5, 12.5), NonQuranKind.FRENCH),),
        annotated_windows=((0.0, 12.5),),
        extra={"scenario": "priere", "seed": 7},
    )
    return with_ref_meta(case, RefMeta(condition="clean"))


def test_schema_version_gelee() -> None:
    assert REF_SCHEMA_VERSION == 1


def test_serialisation_aller_retour(tmp_path: Path) -> None:
    parent = clean_case()
    noisy = degraded_case(
        parent, Degradation("noise", {"snr_db": 10, "seed": 3}), sha256=SHA_B, duree_s=12.5
    )
    path = tmp_path / "manifest.yaml"
    Manifest(cases=[parent, noisy]).save(path)
    loaded = Manifest.load(path)
    assert loaded.cases == [parent, noisy]
    assert ref_meta(loaded.get(noisy.id)) == ref_meta(noisy)
    # le fichier reste lisible par le chargeur standard : mêmes champs de base
    assert loaded.get("mix-a-1").extra["scenario"] == "priere"


def test_bloc_ref_ecrit_dans_le_yaml(tmp_path: Path) -> None:
    path = tmp_path / "manifest.yaml"
    Manifest(cases=[clean_case()]).save(path)
    text = path.read_text(encoding="utf-8")
    assert "ref:" in text and "schema: 1" in text and "condition: clean" in text
    assert "non_quran: false" in text


def test_bloc_ref_absent_ou_schema_inconnu() -> None:
    case = clean_case()
    bare = replace(case, extra={})
    with pytest.raises(RefCorpusError, match="mix-a-1"):
        ref_meta(bare)
    future = replace(case, extra={"ref": {**case.extra["ref"], "schema": 2}})
    with pytest.raises(RefCorpusError, match="schéma"):
        ref_meta(future)


@pytest.mark.parametrize(
    "kwargs",
    [
        {"condition": "inconnue"},
        {"condition": "noise"},  # dégradation sans bloc
        {"condition": "clean", "parent": "x"},  # parent sans dégradation
        {"condition": "reverb", "parent": "x", "degradation": Degradation("noise")},
    ],
)
def test_refmeta_incoherent_refuse(kwargs: dict[str, object]) -> None:
    with pytest.raises(RefCorpusError):
        RefMeta(**kwargs)  # type: ignore[arg-type]


def test_degradation_inconnue_ou_decalage_negatif() -> None:
    with pytest.raises(RefCorpusError):
        Degradation("echo")
    with pytest.raises(RefCorpusError):
        Degradation("silence_pad", {"pad_s": 1}, shift_s=-1.0)


def test_label_stable_et_trie() -> None:
    assert Degradation("noise", {"seed": 3, "snr_db": 10}).label == "noise-seed3-snr_db10"
    assert Degradation("mp3_low", {"kbps": 32}).label == "mp3low-kbps32"


def test_degradation_garde_la_verite_terrain() -> None:
    parent = clean_case()
    for degradation in (
        Degradation("noise", {"snr_db": 5, "seed": 1}),
        Degradation("telephone"),
        Degradation("reverb", {"decay": 0.4}),
        Degradation("mp3_low", {"kbps": 32}),
    ):
        child = degraded_case(parent, degradation, sha256=SHA_B, duree_s=12.5)
        assert child.expected == parent.expected
        assert child.non_quran == parent.non_quran
        assert child.annotated_windows == parent.annotated_windows
        assert (child.boundaries, child.tolerance_ms) == (parent.boundaries, parent.tolerance_ms)
        assert (child.recitant, child.split, child.license) == (
            parent.recitant,
            parent.split,
            parent.license,
        )
        assert child.sha256 == SHA_B != parent.sha256
        assert child.categorie == (*parent.categorie, "C12")
        meta = ref_meta(child)
        assert (meta.parent, meta.condition) == (parent.id, degradation.kind)


def test_decalage_declare_deplace_toute_la_verite() -> None:
    parent = clean_case()
    child = degraded_case(
        parent,
        Degradation("silence_pad", {"pad_s": 2}, shift_s=2.0),
        sha256=SHA_B,
        duree_s=14.5,
    )
    assert [i.t for i in child.expected] == [(2.0, 6.0), (6.35, 10.0)]
    assert [(i.ref, i.words, i.status) for i in child.expected] == [
        (i.ref, i.words, i.status) for i in parent.expected
    ]
    assert child.non_quran[0].t == (10.5, 14.5)
    assert child.annotated_windows == ((2.0, 14.5),)


def test_on_ne_degrade_pas_une_degradation() -> None:
    child = degraded_case(clean_case(), Degradation("telephone"), sha256=SHA_B, duree_s=1.0)
    with pytest.raises(RefCorpusError):
        degraded_case(child, Degradation("reverb"), sha256=SHA_B, duree_s=1.0)


def _recitants(count: int) -> list[AudioCase]:
    cases = []
    for r in range(count):
        for n in range(2):
            cases.append(clean_case(f"mix-r{r}-{n}", recitant=f"Reciter{r}_128kbps"))
    return cases


def test_split_recitants_disjoints_et_degradations_heritent() -> None:
    cases = _recitants(4)
    cases += [degraded_case(c, Degradation("telephone"), sha256=SHA_B, duree_s=12.5) for c in cases]
    assigned = assign_ref_splits(cases, DataConfig())
    sides: dict[str, set[str | None]] = {}
    for case in assigned:
        sides.setdefault(case.recitant, set()).add(case.split)
    assert all(len(s) == 1 for s in sides.values())
    assert {c.split for c in assigned} == {"dev", "test"}
    manifest = Manifest(cases=assigned)
    assert validate_ref_manifest(manifest) == []


def test_split_deterministe_et_affectation_existante_jamais_modifiee() -> None:
    cases = _recitants(4)
    first = assign_ref_splits(cases, DataConfig())
    assert assign_ref_splits(list(reversed(cases)), DataConfig())[::-1] == first
    pinned = [replace(c, split="test") if c.recitant == "Reciter0_128kbps" else c for c in cases]
    again = assign_ref_splits(pinned, DataConfig())
    assert {c.split for c in again if c.recitant == "Reciter0_128kbps"} == {"test"}


def test_fuite_dev_test_detectee() -> None:
    a = replace(clean_case("a"), split="dev")
    b = replace(clean_case("b"), split="test")  # même récitant
    problems = validate_ref_manifest(Manifest(cases=[a, b]))
    assert any("fuite" in p for p in problems)


def test_validation_signale_les_defauts() -> None:
    good = replace(clean_case("g"), split="dev")
    bad_sha = replace(clean_case("s", "Other_128kbps"), split="test", sha256="xyz")
    no_license = replace(clean_case("l", "Other_128kbps"), split="test", license=" ")
    no_split = clean_case("n", "Third_128kbps")
    no_truth = replace(clean_case("t", "Fourth_128kbps"), split="dev", expected=(), non_quran=())
    problems = validate_ref_manifest(
        Manifest(cases=[good, bad_sha, no_license, no_split, no_truth])
    )
    joined = "\n".join(problems)
    for needle in ("s : sha256", "l : license", "n : split", "t : aucun verset"):
        assert needle in joined
    assert not any(p.startswith("cas g") for p in problems)


def test_cas_non_quran_sans_verset() -> None:
    case = replace(
        clean_case("off", "speech:abc"),
        split="test",
        expected=(),
        non_quran=(NonQuranItem((0.0, 5.0), NonQuranKind.FRENCH),),
    )
    case = with_ref_meta(case, RefMeta(condition="off_target", non_quran=True))
    assert validate_ref_manifest(Manifest(cases=[case])) == []
    wrong = with_ref_meta(replace(case, expected=clean_case().expected), ref_meta(case))
    assert any("non_quran mais" in p for p in validate_ref_manifest(Manifest(cases=[wrong])))


def test_enfant_orphelin_ou_dans_un_autre_jeu() -> None:
    parent = replace(clean_case("p"), split="dev")
    child = replace(
        degraded_case(parent, Degradation("telephone"), sha256=SHA_B, duree_s=1.0), split="test"
    )
    problems = validate_ref_manifest(Manifest(cases=[parent, child]))
    assert any("split de p" in p for p in problems)
    orphan = replace(child, split="dev")
    assert any("absent" in p for p in validate_ref_manifest(Manifest(cases=[orphan])))
