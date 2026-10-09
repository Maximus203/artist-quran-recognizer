"""Corpus de référence : schéma figé, sérialisation, disjonction des jeux, dégradations."""

from __future__ import annotations

import hashlib
from collections.abc import Callable
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
    claim_sources,
    degraded_case,
    frozen_splits,
    ref_meta,
    validate_ref_manifest,
    with_ref_meta,
)
from aqr.domain.models import NonQuranKind, Status, VerseRef

SHA_B = "b" * 64


def sha_of(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def clean_case(case_id: str = "mix-a-1", recitant: str = "Alafasy_128kbps") -> AudioCase:
    case = AudioCase(
        id=case_id,
        file=f"mix/{case_id}.wav",
        sha256=sha_of(case_id),
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


@pytest.mark.parametrize(
    "kind, params, shift",
    [
        ("silence_pad", {"pad_s": 3}, 2.0),  # décalage déclaré != silence réellement ajouté
        ("silence_pad", {"pad_s": 2}, 0.0),  # silence ajouté mais vérité non décalée
        ("silence_pad", {}, 2.0),  # pas de pad_s : le décalage n'a pas de source
        ("silence_pad", {"pad_s": 0}, 0.0),  # un « silence » de 0 s n'est pas une dégradation
        ("silence_pad", {"pad_s": 1.2345}, 1.2345),  # adelay travaille à la milliseconde
        ("silence_pad", {"pad_s": "2"}, 2.0),
        ("noise", {"snr_db": 10, "seed": 1}, 5.0),  # le bruit ne décale rien
        ("telephone", {}, 0.5),
        ("reverb", {"decay": 0.4}, 1.0),
        ("mp3_low", {"kbps": 32}, 0.1),
    ],
)
def test_shift_doit_egaler_pad(kind: str, params: dict[str, object], shift: float) -> None:
    with pytest.raises(RefCorpusError, match=r"shift_s|pad_s"):
        Degradation(kind, params, shift_s=shift)  # type: ignore[arg-type]
    with pytest.raises(RefCorpusError):  # même refus à la relecture d'un manifeste
        Degradation.from_dict({"kind": kind, "params": params, "shift_s": shift})


def test_shift_egal_pad_accepte() -> None:
    assert Degradation("silence_pad", {"pad_s": 2}, shift_s=2.0).shift_s == 2.0
    assert Degradation("silence_pad", {"pad_s": 1.5}, shift_s=1.5).label == "silencepad-pad_s1.5"
    for kind in ("noise", "telephone", "reverb", "mp3_low"):
        assert Degradation(kind, {"snr_db": 10, "seed": 1}).shift_s == 0.0


def test_manifeste_au_decalage_incoherent_signale(tmp_path: Path) -> None:
    parent = replace(clean_case("p"), split="dev")
    child = replace(
        degraded_case(
            parent,
            Degradation("silence_pad", {"pad_s": 2}, shift_s=2.0),
            sha256=SHA_B,
            duree_s=14.5,
        ),
        split="dev",
    )
    path = tmp_path / "manifest.yaml"
    Manifest(cases=[parent, child]).save(path)
    text = path.read_text(encoding="utf-8").replace("shift_s: 2.0", "shift_s: 5.0")
    path.write_text(text, encoding="utf-8")
    problems = validate_ref_manifest(Manifest.load(path))
    assert any(p.startswith(f"cas {child.id}") and "shift_s" in p for p in problems)


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
    cases += [
        degraded_case(c, Degradation("telephone"), sha256=sha_of(f"{c.id}-tel"), duree_s=12.5)
        for c in cases
    ]
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


def test_affectation_figee_prime_sur_le_hachage() -> None:
    cases = _recitants(4)
    free = {c.recitant: c.split for c in assign_ref_splits(cases, DataConfig())}
    opposite = {r: ("test" if side == "dev" else "dev") for r, side in free.items()}
    forced = assign_ref_splits(cases, DataConfig(), frozen=opposite)
    assert {c.recitant: c.split for c in forced} == opposite
    # une affectation écrite sur les cas eux-mêmes prime sur le dictionnaire figé
    first = cases[0].recitant
    pinned = [replace(c, split="dev") if c.recitant == first else c for c in cases]
    kept = assign_ref_splits(pinned, DataConfig(), frozen={first: "test"})
    assert {c.split for c in kept if c.recitant == first} == {"dev"}


def test_frozen_splits_releve_les_affectations_et_refuse_la_fuite() -> None:
    a = replace(clean_case("a", "R1_128kbps"), split="dev")
    b = replace(clean_case("b", "R2_128kbps"), split="test")
    c = clean_case("c", "R3_128kbps")  # pas encore affecté
    assert frozen_splits([a, b, c]) == {"R1_128kbps": "dev", "R2_128kbps": "test"}
    with pytest.raises(RefCorpusError, match="R1_128kbps"):
        frozen_splits([a, replace(clean_case("a2", "R1_128kbps"), split="test")])


def test_fuite_dev_test_detectee() -> None:
    a = replace(clean_case("a"), split="dev")
    b = replace(clean_case("b"), split="test")  # même récitant
    problems = validate_ref_manifest(Manifest(cases=[a, b]))
    assert any("fuite" in p for p in problems)


def _off_target(case_id: str, recitant: str, split: str, sha: str, **extra: object) -> AudioCase:
    case = replace(
        clean_case(case_id, recitant),
        split=split,
        sha256=sha,
        expected=(),
        non_quran=(NonQuranItem((0.0, 5.0), NonQuranKind.FRENCH),),
        annotated_windows=(),
        extra=dict(extra),
    )
    return with_ref_meta(case, RefMeta(condition="off_target", non_quran=True))


def test_meme_sha_deux_jeux_signale() -> None:
    """Même audio sous deux pseudo-récitants : test reverrait ce qu'on a vu en dev."""
    shared = sha_of("french-clip")
    dev = _off_target("off-0", "speech-french-a", "dev", shared)
    test = _off_target("off-1", "speech-french-b", "test", shared)
    problems = validate_ref_manifest(Manifest(cases=[dev, test]))
    assert any("sha256" in p and "dev" in p and "test" in p and "off-0" in p for p in problems)
    # même jeu : pas de fuite (deux cas peuvent partager un audio du même côté)
    twin = _off_target("off-1", "speech-french-b", "dev", shared)
    assert validate_ref_manifest(Manifest(cases=[dev, twin])) == []


def test_meme_source_deux_jeux_signale() -> None:
    """Un enregistrement source (speech/ ou specials/) réutilisé dans des mixages dev ET test."""
    source = [{"kind": "takbir", "file": "specials/takbir.wav", "sha256": sha_of("takbir")}]
    other = [{"kind": "takbir", "file": "specials/takbir_2.wav", "sha256": sha_of("takbir 2")}]
    dev = _off_target("a", "Reciter1_128kbps", "dev", sha_of("a"), sources=source)
    test = _off_target("b", "Reciter2_128kbps", "test", sha_of("b"), sources=source)
    problems = validate_ref_manifest(Manifest(cases=[dev, test]))
    assert any("source" in p and "specials/takbir.wav" in p and "fuite" in p for p in problems)
    apart = _off_target("b", "Reciter2_128kbps", "test", sha_of("b"), sources=other)
    assert validate_ref_manifest(Manifest(cases=[dev, apart])) == []
    broken = _off_target("c", "Reciter3_128kbps", "test", sha_of("c"), sources="takbir")
    assert any("sources" in p for p in validate_ref_manifest(Manifest(cases=[broken])))


def test_cas_a_source_deja_dans_l_autre_jeu_ecarte() -> None:
    """Premier arrivé, premier servi : le jeu qui réclame un enregistrement le garde."""
    takbir = [{"kind": "takbir", "file": "specials/takbir.wav", "sha256": sha_of("takbir")}]
    amin = [{"kind": "amin", "sha256": sha_of("amin")}]
    first = _off_target("a", "Reciter1_128kbps", "dev", sha_of("a"), sources=takbir)
    second = _off_target("b", "Reciter2_128kbps", "test", sha_of("b"), sources=takbir)
    third = _off_target("c", "Reciter2_128kbps", "test", sha_of("c"), sources=amin)
    bare = _off_target("d", "Reciter2_128kbps", "test", sha_of("d"))
    claims: dict[str, str] = {}
    kept, dropped = claim_sources([first, second, third, bare], claims)
    assert [c.id for c in kept] == ["a", "c", "d"]
    assert [c.id for c, _ in dropped] == ["b"]
    assert "specials/takbir.wav" in dropped[0][1] and "dev" in dropped[0][1]
    assert claims == {sha_of("takbir"): "dev", sha_of("amin"): "test"}
    # une réclamation déjà connue (cas conservés d'un ancien manifeste) vaut aussi
    assert claim_sources([second], {sha_of("takbir"): "dev"})[0] == []
    assert claim_sources([first], {sha_of("takbir"): "dev"})[0] == [first]


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


def _pair(degradation: Degradation, child_duration: float) -> tuple[AudioCase, AudioCase]:
    parent = replace(clean_case("p"), split="dev")
    child = degraded_case(parent, degradation, sha256=SHA_B, duree_s=child_duration)
    return parent, replace(child, split="dev")


PAD = Degradation("silence_pad", {"pad_s": 2}, shift_s=2.0)
NOISE = Degradation("noise", {"snr_db": 10, "seed": 1})


def test_enfant_conforme_au_parent_decale_valide() -> None:
    for degradation, duration in ((PAD, 14.5), (NOISE, 12.5), (NOISE, 12.6)):
        parent, child = _pair(degradation, duration)
        assert validate_ref_manifest(Manifest(cases=[parent, child])) == []


def _drop_shift(child: AudioCase) -> AudioCase:
    return replace(child, expected=clean_case().expected)  # vérité du parent, non décalée


@pytest.mark.parametrize(
    "degradation, tamper, needle",
    [
        (PAD, _drop_shift, "expected"),
        (PAD, lambda c: replace(c, non_quran=clean_case().non_quran), "non_quran"),
        (PAD, lambda c: replace(c, annotated_windows=((0.0, 12.5),)), "annotated_windows"),
        (PAD, lambda c: replace(c, annotated_windows=()), "annotated_windows"),
        (PAD, lambda c: replace(c, duree_s=12.5), "durée"),  # le silence n'a pas été ajouté
        (PAD, lambda c: replace(c, duree_s=None), "durée"),
        (NOISE, lambda c: replace(c, expected=c.expected[:1]), "expected"),  # un verset perdu
        (
            NOISE,
            lambda c: replace(c, expected=(replace(c.expected[0], t=(0.5, 4.0)), *c.expected[1:])),
            "expected",
        ),  # frontière déplacée sans décalage déclaré
        (
            NOISE,
            lambda c: replace(
                c, expected=(replace(c.expected[0], status=Status.INFERRED), *c.expected[1:])
            ),
            "expected",
        ),  # la dégradation ne change pas le statut de preuve
        (NOISE, lambda c: replace(c, duree_s=20.0), "durée"),
    ],
)
def test_enfant_verite_non_decalee_signalee(
    degradation: Degradation, tamper: Callable[[AudioCase], AudioCase], needle: str
) -> None:
    parent, child = _pair(degradation, 14.5 if degradation.shift_s else 12.5)
    problems = validate_ref_manifest(Manifest(cases=[parent, tamper(child)]))
    assert any(p.startswith(f"cas {child.id}") and needle in p for p in problems), problems


def test_enfant_dont_le_parent_est_derive_signale() -> None:
    parent, child = _pair(NOISE, 12.5)
    grandchild = replace(
        child, id="g", extra={**child.extra, "ref": {**child.extra["ref"], "parent": child.id}}
    )
    problems = validate_ref_manifest(Manifest(cases=[parent, child, grandchild]))
    assert any("dégradation d'une dégradation" in p for p in problems)


def test_enfant_orphelin_ou_dans_un_autre_jeu() -> None:
    parent = replace(clean_case("p"), split="dev")
    child = replace(
        degraded_case(parent, Degradation("telephone"), sha256=SHA_B, duree_s=1.0), split="test"
    )
    problems = validate_ref_manifest(Manifest(cases=[parent, child]))
    assert any("split de p" in p for p in problems)
    orphan = replace(child, split="dev")
    assert any("absent" in p for p in validate_ref_manifest(Manifest(cases=[orphan])))


VERSIONED = Path(__file__).resolve().parents[1] / "fixtures" / "ref-corpus" / "manifest.yaml"


def test_manifeste_versionne_conforme_au_schema_fige() -> None:
    manifest = Manifest.load(VERSIONED)
    assert manifest.cases
    assert validate_ref_manifest(manifest) == []


def test_everyayah_par_recitant_jamais_partage_entre_jeux() -> None:
    """Non-régression : un récitant EveryAyah (donc ses clips) n'est que dans un seul jeu, et
    aucun audio (sha256) n'apparaît des deux côtés."""
    manifest = Manifest.load(VERSIONED)
    reciter_splits: dict[str, set[str | None]] = {}
    sha_splits: dict[str, set[str | None]] = {}
    for case in manifest.cases:
        reciter_splits.setdefault(case.recitant, set()).add(case.split)
        sha_splits.setdefault(case.sha256, set()).add(case.split)
        if case.source and "everyayah.com/data/" in case.source:
            assert case.source.endswith(f"everyayah.com/data/{case.recitant}"), case.id
    assert {len(v) for v in reciter_splits.values()} == {1}
    assert {len(v) for v in sha_splits.values()} == {1}
    sides = {s for v in reciter_splits.values() for s in v}
    assert sides == {"dev", "test"}
