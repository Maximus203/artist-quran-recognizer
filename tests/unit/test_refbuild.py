"""Construction du corpus de référence de bout en bout (sources synthétiques, vrai ffmpeg)."""

from __future__ import annotations

import json
import random
import shutil
from array import array
from dataclasses import replace
from pathlib import Path

import pytest
from tests.unit.test_data_mixer import CORPUS_DIR, SyntheticProvider, freq_of, tone

from aqr.corpus.tanzil_repository import TanzilCorpusRepository
from aqr.data.config import DataConfig
from aqr.data.degrade import read_samples, rms
from aqr.data.ingest import sha256_file
from aqr.data.manifest import AudioCase, ExpectedItem, Manifest, NonQuranItem, WordRange
from aqr.data.mixer import DiskClipProvider, clip_digest, read_wav, write_wav
from aqr.data.refbuild import (
    BuildReport,
    ReferenceClipProvider,
    build_ref_corpus,
    degrade_cases,
    ensure_outside_repo,
)
from aqr.data.refcorpus import (
    LICENSE_UNESTABLISHED,
    Degradation,
    RefCorpusError,
    RefMeta,
    ref_meta,
    validate_ref_manifest,
    with_ref_meta,
)
from aqr.data.split import quarantine_recitant
from aqr.domain.models import NonQuranKind, Status, VerseRef

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
    """Quatre récitants ; huit enregistrements de parole par nature (le tirage choisit)."""

    def reciters(self) -> tuple[str, ...]:
        return ("recit_a", "recit_b", "recit_c", "recit_d")

    def excluded_reciters(self) -> tuple[tuple[str, str], ...]:
        return (("recit_x", "bismillah.mp3 absent"),)

    def speech(self, kind: NonQuranKind, rng: random.Random) -> array[int] | None:
        if kind is NonQuranKind.OTHER_LANGUAGE:
            return None
        base = {NonQuranKind.FRENCH: 3100.0, NonQuranKind.ARABIC_SPEECH: 4100.0}[kind]
        return tone(base + 100.0 * rng.randint(0, 7), 3.0)


class OneClip(FourReciters):
    """Un seul enregistrement par nature (le cas du dossier speech/ presque vide)."""

    def speech(self, kind: NonQuranKind, rng: random.Random) -> array[int] | None:
        if kind is NonQuranKind.OTHER_LANGUAGE:
            return None
        return SyntheticProvider.speech(self, kind, rng)


class TwoClips(FourReciters):
    """Deux enregistrements par nature : le tirage décide lequel sort."""

    def speech(self, kind: NonQuranKind, rng: random.Random) -> array[int] | None:
        if kind is NonQuranKind.OTHER_LANGUAGE:
            return None
        base = {NonQuranKind.FRENCH: 3100.0, NonQuranKind.ARABIC_SPEECH: 3300.0}[kind]
        return tone(base + 500.0 * rng.randint(0, 1), 3.0)


class ThreeReciters(OneClip):
    def reciters(self) -> tuple[str, ...]:
        return ("recit_a", "recit_b", "recit_c")


class TwoReciters(FourReciters):
    def reciters(self) -> tuple[str, ...]:
        return ("recit_a", "recit_b")


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


def test_recitant_sans_basmala_ecarte(tmp_path: Path) -> None:
    root = tmp_path / "everyayah"
    for reciter in ("Complet_128kbps", "SansBasmala_128kbps"):
        (root / reciter).mkdir(parents=True)
    (root / "Complet_128kbps" / "bismillah.mp3").write_bytes(b"x")
    provider = ReferenceClipProvider(tmp_path)
    assert provider.reciters() == ("Complet_128kbps",)
    ((name, reason),) = provider.excluded_reciters()  # plus de filtre silencieux
    assert name == "SansBasmala_128kbps" and "bismillah" in reason


def test_decalage_des_zones_non_coraniques_de_la_construction(
    built: tuple[BuildReport, Path, Path],
) -> None:
    """Dans le corpus construit, l'audio sous chaque zone décalée est celui de la zone du parent."""
    report, out, _ = built
    by_id = {c.id: c for c in report.manifest.cases}
    pads = [c for c in report.manifest.cases if ref_meta(c).condition == "silence_pad"]
    with_zone = [c for c in pads if c.non_quran]
    assert with_zone, "aucun parent à zone non coranique dans le corpus de test"
    for child in with_zone:
        parent = by_id[ref_meta(child).parent or ""]
        pad = ref_meta(child).degradation.params["pad_s"]  # type: ignore[union-attr]
        got, rate = read_samples(out / child.file)
        want, _ = read_samples(out / parent.file)
        for c_zone, p_zone in zip(child.non_quran, parent.non_quran, strict=True):
            assert c_zone.t == pytest.approx((p_zone.t[0] + pad, p_zone.t[1] + pad))
            assert c_zone.kind is p_zone.kind
            a, b = (round(t * rate) for t in c_zone.t)
            pa, pb = (round(t * rate) for t in p_zone.t)
            assert got[a:b] == want[pa:pb]  # bit à bit : le silence n'a fait que translater


def test_decalage_non_quran_bout_en_bout(tmp_path: Path) -> None:
    """Parent à zone non coranique ET fenêtre annotée, dégradé en silence_pad par le constructeur :
    verset, zone et fenêtre sont décalés de pad_s, et l'audio correspondant s'y trouve vraiment."""
    rate, pad = 16000, 3.0
    samples = array("h", tone(500.0, 3.0))  # verset 0-3 s
    samples.extend([0] * rate)  # pause 3-4 s
    samples.extend(tone(2500.0, 2.0))  # zone non coranique 4-6 s
    write_wav(tmp_path / "mix" / "parent.wav", samples, rate)
    parent = AudioCase(
        id="parent",
        file="mix/parent.wav",
        sha256=sha256_file(tmp_path / "mix" / "parent.wav"),
        categorie=("C09",),
        recitant="recit_a",
        riwaya="hafs",
        langues=("ar",),
        license=LICENSE_UNESTABLISHED,
        duree_s=6.0,
        statut="annote",
        split="dev",
        origine="mix",
        expected=(ExpectedItem((0.0, 3.0), VerseRef(112, 1), WordRange.all(), Status.RECOGNIZED),),
        non_quran=(NonQuranItem((4.0, 6.0), NonQuranKind.FRENCH),),
        annotated_windows=((0.0, 6.0),),
    )
    parent = with_ref_meta(parent, RefMeta(condition="clean"))
    degradation = Degradation("silence_pad", {"pad_s": pad}, shift_s=pad)
    (child,) = degrade_cases([parent], tmp_path, [degradation], DataConfig())

    assert [i.t for i in child.expected] == [(3.0, 6.0)]
    assert [(i.t, i.kind) for i in child.non_quran] == [((7.0, 9.0), NonQuranKind.FRENCH)]
    assert child.annotated_windows == ((3.0, 9.0),)
    assert child.duree_s == pytest.approx(9.0, abs=0.01)
    assert validate_ref_manifest(Manifest(cases=[parent, child])) == []

    audio, _ = read_samples(tmp_path / child.file)
    assert rms(audio[: 3 * rate]) == 0  # le silence ajouté
    assert freq_of(audio[3 * rate : 6 * rate]) == pytest.approx(500.0, rel=0.02)  # le verset
    assert freq_of(audio[7 * rate : 9 * rate]) == pytest.approx(2500.0, rel=0.02)  # la zone
    assert (
        read_wav(tmp_path / child.file, rate)[7 * rate : 9 * rate] == samples[4 * rate : 6 * rate]
    )


SCENARIOS = ("murattal_continu", "assise_fr", "priere")


def build(
    out: Path,
    manifest: Path,
    *,
    per_scenario: int = 2,
    degradations: tuple[Degradation, ...] = DEGRADATIONS,
    provider: type[SyntheticProvider] = FourReciters,
    seed: int = 3,
) -> BuildReport:
    corpus = TanzilCorpusRepository(CORPUS_DIR)
    return build_ref_corpus(
        provider(corpus),
        corpus,
        out,
        manifest,
        seed=seed,
        per_scenario=per_scenario,
        scenarios=SCENARIOS,
        degradations=degradations,
    )


def splits_by_recitant(cases: list[AudioCase]) -> dict[str, str | None]:
    found: dict[str, set[str | None]] = {}
    for case in cases:
        found.setdefault(case.recitant, set()).add(case.split)
    assert all(len(v) == 1 for v in found.values())
    return {recitant: next(iter(v)) for recitant, v in found.items()}


def test_reconstruction_conserve_les_affectations(tmp_path: Path) -> None:
    """Une affectation dev/test écrite n'est jamais recalculée : on inverse le manifeste écrit
    (toutes les affectations), on reconstruit avec d'autres paramètres, l'inversion subsiste."""
    out, manifest = tmp_path / "aqr-ref", tmp_path / "manifest.yaml"
    first = build(out, manifest)
    original = splits_by_recitant(first.manifest.cases)
    assert set(original.values()) == {"dev", "test"}

    flip = {"dev": "test", "test": "dev"}
    Manifest(
        cases=[replace(c, split=flip[c.split or ""]) for c in Manifest.load(manifest).cases]
    ).save(manifest)

    newer = (
        Degradation("noise", {"snr_db": 10, "seed": 1}),
        Degradation("silence_pad", {"pad_s": 2}, shift_s=2.0),
        Degradation("mp3_low", {"kbps": 32}),
    )
    again = build(out, manifest, per_scenario=3, degradations=newer)

    assert again.problems == []
    after = splits_by_recitant(again.manifest.cases)
    assert set(after) >= set(original)
    for recitant, side in original.items():
        assert after[recitant] == flip[side or ""], recitant  # type: ignore[index]
    assert Manifest.load(manifest).cases == again.manifest.cases
    assert validate_ref_manifest(again.manifest) == []


def test_reconstruction_retire_les_derives_dont_la_degradation_a_disparu(tmp_path: Path) -> None:
    out, manifest = tmp_path / "aqr-ref", tmp_path / "manifest.yaml"
    first = build(out, manifest)
    gone = {
        c.id for c in first.manifest.cases if ref_meta(c).condition in ("telephone", "silence_pad")
    }
    assert gone
    newer = (Degradation("noise", {"snr_db": 10, "seed": 1}),)
    again = build(out, manifest, degradations=newer)
    ids = {c.id for c in again.manifest.cases}
    assert not gone & ids  # aucun ancien sha conservé en silence
    assert {name for name, _ in again.removed} == gone
    assert all("absente de ce lancement" in reason for _, reason in again.removed)
    assert {ref_meta(c).condition for c in again.manifest.cases if ref_meta(c).parent} == {"noise"}
    assert validate_ref_manifest(again.manifest) == []
    assert read_trace(manifest)["removed"] == [  # la trace garde la raison du retrait
        {"name": name, "reason": reason} for name, reason in again.removed
    ]


def test_reconstruction_avec_un_recitant_de_plus_ne_reaffecte_rien(tmp_path: Path) -> None:
    """Mêmes identifiants, un récitant de plus : sans affectation figée, recit_b passait de test
    à dev (le hachage et les poids sont recalculés sur un autre ensemble)."""

    out, manifest = tmp_path / "aqr-ref", tmp_path / "manifest.yaml"
    before = splits_by_recitant(build(out, manifest, provider=TwoReciters, seed=7).manifest.cases)
    after = splits_by_recitant(build(out, manifest, provider=ThreeReciters, seed=7).manifest.cases)
    common = before.keys() & after.keys()
    assert {"recit_a", "recit_b"} <= common
    assert {r: after[r] for r in common} == {r: before[r] for r in common}


def off_target(report: BuildReport) -> list[AudioCase]:
    return [c for c in report.manifest.cases if ref_meta(c).condition == "off_target"]


def test_hors_cible_meme_audio_meme_jeu(tmp_path: Path) -> None:
    """Un seul clip par nature : avant, `per_scenario` cas de même sha256 (pseudo-récitants
    `speech-<nature>-<n>` indépendants) étaient répartis au hasard entre dev et test."""
    report = build(tmp_path / "aqr-ref", tmp_path / "manifest.yaml", provider=ThreeReciters)
    cases = off_target(report)
    assert {c.non_quran[0].kind for c in cases} == {NonQuranKind.FRENCH, NonQuranKind.ARABIC_SPEECH}
    assert len(cases) == 2  # dédupliqué : un enregistrement, un cas
    skipped = dict(report.skipped)
    assert "distinct" in skipped["off_target:french"]
    provider = ThreeReciters(TanzilCorpusRepository(CORPUS_DIR))
    for case in cases:
        kind = case.non_quran[0].kind
        digest = clip_digest(provider.speech(kind, random.Random(0)))  # type: ignore[arg-type]
        assert case.recitant == f"speech-{kind.value}-{digest[:12]}"
        assert case.extra["sources"] == [{"kind": kind.value, "sha256": digest}]
    sides: dict[str, set[str | None]] = {}
    for case in report.manifest.cases:
        sides.setdefault(case.sha256, set()).add(case.split)
    assert {len(v) for v in sides.values()} == {1}
    assert report.problems == [] and validate_ref_manifest(report.manifest) == []


def test_hors_cible_tire_des_clips_distincts_au_recitant_stable(tmp_path: Path) -> None:
    out, manifest = tmp_path / "aqr-ref", tmp_path / "manifest.yaml"
    report = build(out, manifest, provider=TwoClips)
    cases = off_target(report)
    assert len(cases) == 4  # 2 natures x 2 clips distincts
    assert len({c.sha256 for c in cases}) == 4 and len({c.recitant for c in cases}) == 4
    assert all(c.recitant.rsplit("-", 1)[1] in c.extra["sources"][0]["sha256"] for c in cases)
    again = build(out, manifest, provider=TwoClips)  # le pseudo-récitant suit le contenu
    assert {c.id: (c.recitant, c.split) for c in off_target(again)} == {
        c.id: (c.recitant, c.split) for c in cases
    }


def test_sources_des_mixages_consignees_et_jamais_dans_deux_jeux(
    built: tuple[BuildReport, Path, Path],
) -> None:
    report, _out, _ = built
    mixes = [c for c in report.manifest.cases if ref_meta(c).condition == "clean"]
    zones = {NonQuranKind.FRENCH, NonQuranKind.ARABIC_SPEECH, NonQuranKind.TAKBIR}
    with_zones = [c for c in mixes if {z.kind for z in c.non_quran} & zones]
    assert with_zones
    for case in with_zones:  # chaque clip réellement collé est consigné
        used = {z.kind.value for z in case.non_quran}
        assert {s["kind"] for s in case.extra["sources"]} == used, case.id
    by_source: dict[str, set[str | None]] = {}
    for case in report.manifest.cases:
        for source in case.extra.get("sources", []):
            by_source.setdefault(source["sha256"], set()).add(case.split)
    assert by_source and {len(v) for v in by_source.values()} == {1}
    assert validate_ref_manifest(report.manifest) == []


def test_source_disque_nom_et_sha256_du_fichier(tmp_path: Path) -> None:
    speech = tone(3100.0, 1.0)
    write_wav(tmp_path / "speech" / "french_01.wav", speech, 16000)
    write_wav(tmp_path / "speech" / "french_02.wav", tone(3200.0, 1.0), 16000)
    write_wav(tmp_path / "specials" / "takbir.wav", tone(2300.0, 1.0), 16000)
    disk = DiskClipProvider(tmp_path)
    chosen = disk.speech(NonQuranKind.FRENCH, random.Random(5))
    origin = disk.origin(clip_digest(chosen))  # type: ignore[arg-type]
    assert origin is not None and origin.name in ("speech/french_01.wav", "speech/french_02.wav")
    assert origin.sha256 == sha256_file(tmp_path / origin.name)
    special = disk.special(NonQuranKind.TAKBIR)
    assert disk.origin(clip_digest(special)).name == "specials/takbir.wav"  # type: ignore[arg-type, union-attr]
    assert disk.origin("0" * 64) is None


def test_priere_un_seul_enregistrement_special_un_seul_jeu(tmp_path: Path) -> None:
    """Les specials/ n'ont qu'un clip par nature : la prière ne peut exister que d'un côté. Les
    mixages du récitant de l'autre jeu sont écartés (signalés, audio effacé), pas dupliqués."""
    out, manifest = tmp_path / "aqr-ref", tmp_path / "manifest.yaml"
    corpus = TanzilCorpusRepository(CORPUS_DIR)
    report = build_ref_corpus(
        FourReciters(corpus),
        corpus,
        out,
        manifest,
        seed=5,
        per_scenario=6,
        scenarios=("murattal_continu", "priere"),
        degradations=(Degradation("telephone"),),
    )
    prayers = [c for c in report.manifest.cases if c.extra.get("scenario") == "priere"]
    assert prayers
    assert len({c.split for c in prayers}) == 1
    dropped = [(n, r) for n, r in report.skipped if n.startswith("ref-mix-priere")]
    assert dropped, "aucun mixage de prière n'est tombé dans l'autre jeu : changer de graine"
    assert all("déjà utilisée dans le jeu" in reason for _, reason in dropped)
    for name, _ in dropped:
        assert not (out / "mix" / f"{name}.wav").exists()
        assert name not in {c.id for c in report.manifest.cases}
    assert {s["kind"] for c in prayers for s in c.extra["sources"]} == {
        "takbir",
        "istiadha",
        "amin",
    }
    assert report.problems == [] and validate_ref_manifest(report.manifest) == []


TRACE_NAME = "manifest.build.json"


def read_trace(manifest: Path) -> dict[str, object]:
    return json.loads((manifest.parent / TRACE_NAME).read_text(encoding="utf-8"))  # type: ignore[no-any-return]


def test_trace_de_construction_ecrite(built: tuple[BuildReport, Path, Path]) -> None:
    """Tout ce qu'il faut pour rejouer le build est écrit à côté du manifeste, sans chemin local."""
    report, out, manifest = built
    assert (manifest.parent / TRACE_NAME).exists()
    trace = read_trace(manifest)
    assert trace["schema"] == 1 and trace["manifest"] == "manifest.yaml"
    params = trace["parameters"]
    assert isinstance(params, dict)
    assert (params["seed"], params["per_scenario"]) == (3, 2)
    assert params["scenarios"] == list(SCENARIOS)
    assert params["split_seed"] == DataConfig().split_seed
    assert params["dev_ratio"] == DataConfig().dev_ratio
    assert [d["kind"] for d in params["degradations"]] == ["noise", "telephone", "silence_pad"]
    assert params["degradations"][2] == {
        "kind": "silence_pad",
        "params": {"pad_s": 2},
        "shift_s": 2.0,
    }
    assert trace["reciters"] == {
        "retained": ["recit_a", "recit_b", "recit_c", "recit_d"],
        "excluded": [{"name": "recit_x", "reason": "bismillah.mp3 absent"}],
    }
    skipped = {item["name"]: item["reason"] for item in trace["skipped"]}  # type: ignore[attr-defined]
    assert skipped["reciter:recit_x"] == "bismillah.mp3 absent"  # le filtre n'est plus silencieux
    assert "off_target:other_language" in skipped
    assert dict(report.skipped) == skipped
    split_of = {c.recitant: c.split for c in report.manifest.cases}
    assert trace["splits"] == dict(sorted(split_of.items()))
    toolchain = trace["toolchain"]
    assert isinstance(toolchain, dict)
    assert toolchain["ffmpeg"][0].isdigit() and toolchain["libmp3lame"][0].isdigit()
    sources = trace["sources"]
    assert isinstance(sources, dict)
    assert sources["everyayah_lock_sha256"] is None  # pas de LOCK.json dans ce dossier de test
    kinds = {f["kind"] for f in sources["files"]}
    assert {"french", "arabic_speech", "takbir"} <= kinds
    text = (manifest.parent / TRACE_NAME).read_text(encoding="utf-8")
    for local in (str(out), str(manifest.parent), "/tmp", "/root", "/home"):
        assert local not in text


def test_trace_deterministe_et_environnement_transmis(tmp_path: Path) -> None:
    out, manifest = tmp_path / "aqr-ref", tmp_path / "manifest.yaml"
    lock = out / "everyayah" / "LOCK.json"
    lock.parent.mkdir(parents=True)
    lock.write_text('{"files": {}}', encoding="utf-8")
    corpus = TanzilCorpusRepository(CORPUS_DIR)
    kwargs = dict(
        seed=3, per_scenario=1, scenarios=("murattal_continu",), degradations=DEGRADATIONS[:1]
    )
    env = {"command": "python scripts/build_ref_corpus.py --seed 3", "git": {"sha": "abc"}}
    build_ref_corpus(FourReciters(corpus), corpus, out, manifest, environment=env, **kwargs)  # type: ignore[arg-type]
    first = (tmp_path / TRACE_NAME).read_text(encoding="utf-8")
    trace = json.loads(first)
    assert trace["environment"] == env
    assert trace["sources"]["everyayah_lock_sha256"] == sha256_file(lock)
    build_ref_corpus(FourReciters(corpus), corpus, out, manifest, environment=env, **kwargs)  # type: ignore[arg-type]
    assert (tmp_path / TRACE_NAME).read_text(encoding="utf-8") == first  # rejeu : octet pour octet


def quarantined_build(tmp_path: Path) -> tuple[Path, Path, str]:
    """Construit (graine 6 : recit_b et recit_c en test), met un récitant en quarantaine."""
    out, manifest = tmp_path / "aqr-ref", tmp_path / "manifest.yaml"
    build(out, manifest, seed=6)
    old = Manifest.load(manifest)
    assert "test" in {c.split for c in old.cases if c.recitant.startswith("recit_")}
    target = next(c.recitant for c in old.cases if c.split == "test" and c.recitant[:6] == "recit_")
    Manifest(cases=quarantine_recitant(old.cases, target, DataConfig())).save(manifest)
    return out, manifest, target


def test_reconstruction_garde_un_recitant_en_quarantaine(tmp_path: Path) -> None:
    """Un récitant mis en quarantaine (jeu test exposé au réglage) ne revient jamais en dev/test :
    ni lui, ni ses parents régénérés, ni ses dérivés."""
    quarantine = DataConfig().quarantine_split
    out, manifest, target = quarantined_build(tmp_path)
    newer = (Degradation("noise", {"snr_db": 10, "seed": 1}), Degradation("mp3_low", {"kbps": 32}))
    again = build(out, manifest, seed=6, per_scenario=3, degradations=newer)

    assert again.problems == []
    ours = [c for c in again.manifest.cases if c.recitant == target]
    assert ours and {c.split for c in ours} == {quarantine}
    assert any(ref_meta(c).parent for c in ours)  # les dérivés régénérés y sont aussi
    assert {c.split for c in again.manifest.cases if c.recitant != target} <= {"dev", "test"}
    assert validate_ref_manifest(again.manifest) == []
    assert read_trace(manifest)["splits"][target] == quarantine  # type: ignore[index]


def test_voix_mix_d_un_recitant_en_quarantaine_suit_la_quarantaine(tmp_path: Path) -> None:
    """Tout est régénéré sous le nom `mix-<récitant>` (le mixeur local) : aucun cas du récitant en
    quarantaine ne reste dans le manifeste, mais sa voix ne repart pas en dev/test."""
    quarantine = DataConfig().quarantine_split
    out, manifest, target = quarantined_build(tmp_path)

    class SameVoice(FourReciters):
        def reciters(self) -> tuple[str, ...]:
            return (f"mix-{target}",)

    again = build(out, manifest, seed=6, provider=SameVoice)
    assert again.problems == []
    mixes = [c for c in again.manifest.cases if c.recitant == f"mix-{target}"]
    assert mixes and {c.split for c in mixes} == {quarantine}
    assert not {c.split for c in again.manifest.cases if c.recitant == target} - {quarantine}


class NoSpecials(FourReciters):
    def special(self, kind: NonQuranKind) -> array[int] | None:
        return None


def test_trace_incrementale_declare_les_cas_conserves(tmp_path: Path) -> None:
    """Graine 3 puis 4 dans le même manifeste : il contient les deux lots, la trace doit le dire
    (sinon « rejouer la commande » promettrait un manifeste qu'elle ne redonne pas)."""
    out, manifest = tmp_path / "aqr-ref", tmp_path / "manifest.yaml"
    build(out, manifest, seed=3)
    assert read_trace(manifest)["carried_over"] == {"cases": 0, "seeds": [], "scenarios": []}

    second = build(out, manifest, seed=4)
    trace = read_trace(manifest)
    assert trace["parameters"]["seed"] == 4  # type: ignore[index]
    carried = trace["carried_over"]
    assert isinstance(carried, dict)
    old = [c for c in second.manifest.cases if c.extra.get("seed") == 3]
    assert old and carried["cases"] == len(old)
    assert carried["seeds"] == [3]
    assert carried["scenarios"] == sorted({c.extra["scenario"] for c in old})
    alone_manifest = tmp_path / "alone" / "manifest.yaml"
    alone = build(tmp_path / "alone" / "aqr-ref", alone_manifest, seed=4)  # la graine 4 seule
    assert len(alone.manifest.cases) + carried["cases"] == len(second.manifest.cases)
    assert read_trace(alone_manifest)["carried_over"]["cases"] == 0  # type: ignore[index]


def test_scenario_ecarte_mais_conserve_est_marque_comme_tel(tmp_path: Path) -> None:
    out, manifest = tmp_path / "aqr-ref", tmp_path / "manifest.yaml"
    first = build(out, manifest)
    prayers = [c for c in first.manifest.cases if c.extra.get("scenario") == "priere"]
    assert prayers
    again = build(out, manifest, provider=NoSpecials)  # plus de specials/ : « priere » écartée
    skipped = dict(again.skipped)
    assert "clips absents" in skipped["priere"]
    assert f"{len(prayers)} cas conservés d'un lancement précédent" in skipped["priere"]
    assert {c.id for c in prayers} <= {c.id for c in again.manifest.cases}
    trace = read_trace(manifest)
    assert "priere" in trace["carried_over"]["scenarios"]  # type: ignore[index]
    assert {i["name"]: i["reason"] for i in trace["skipped"]}["priere"] == skipped["priere"]  # type: ignore[attr-defined]


def test_scenarios_dupliques_dedoublonnes(tmp_path: Path) -> None:
    """`--scenarios a,a` écrivait deux fois les mêmes identifiants : manifeste illisible ensuite."""
    out, manifest = tmp_path / "aqr-ref", tmp_path / "manifest.yaml"
    corpus = TanzilCorpusRepository(CORPUS_DIR)
    report = build_ref_corpus(
        FourReciters(corpus),
        corpus,
        out,
        manifest,
        seed=3,
        per_scenario=1,
        scenarios=("murattal_continu", "murattal_continu"),
        degradations=DEGRADATIONS[:1],
    )
    ids = [c.id for c in report.manifest.cases]
    assert report.problems == [] and len(ids) == len(set(ids))
    assert Manifest.load(manifest).cases == report.manifest.cases  # relisible
    assert read_trace(manifest)["parameters"]["scenarios"] == ["murattal_continu"]  # type: ignore[index]


def test_degradations_de_meme_identifiant_refusees_avant_toute_ecriture(tmp_path: Path) -> None:
    clash = (
        Degradation("noise", {"snr_db": 20, "seed": 1}),
        Degradation("noise", {"snr_db": 20.0, "seed": 1}),
    )
    out, manifest = tmp_path / "aqr-ref", tmp_path / "manifest.yaml"
    with pytest.raises(RefCorpusError, match="noise-seed1-snr_db20"):
        build(out, manifest, degradations=clash)
    assert not out.exists() and not manifest.exists()
    with pytest.raises(RefCorpusError, match="noise-seed1-snr_db20"):
        degrade_cases([], out, clash, DataConfig())
