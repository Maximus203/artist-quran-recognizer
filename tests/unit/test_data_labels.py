"""Étiquettes Audacity <-> manifeste : format DATA-COLLECTION §5, aller-retour exact."""

from __future__ import annotations

from pathlib import Path

import pytest
from hypothesis import given
from hypothesis import strategies as st

from aqr.data.config import DataConfig
from aqr.data.labels import (
    LabelError,
    PreAnnotation,
    export_labels,
    format_labels,
    import_labels,
    parse_labels,
    preannotate,
)
from aqr.data.manifest import (
    AudioCase,
    ExpectedItem,
    Manifest,
    NonQuranItem,
    WordRange,
)
from aqr.domain.models import NonQuranKind, Status, VerseRef

SPEC_EXAMPLE = (
    "0.000000\t6.100000\t67:4|recognized\n"
    "6.100000\t11.400000\t67:5|inferred\n"
    "11.400000\t17.800000\t67:6|recognized\n"
    "17.800000\t25.000000\tNON_QURAN:french\n"
)


def test_exemple_de_la_documentation_est_lu_tel_quel():
    expected, non_quran = parse_labels(SPEC_EXAMPLE)
    assert [(i.ref, i.status) for i in expected] == [
        (VerseRef(67, 4), Status.RECOGNIZED),
        (VerseRef(67, 5), Status.INFERRED),
        (VerseRef(67, 6), Status.RECOGNIZED),
    ]
    assert non_quran == (NonQuranItem((17.8, 25.0), NonQuranKind.FRENCH),)


def test_et_ecrit_au_meme_format():
    expected, non_quran = parse_labels(SPEC_EXAMPLE)
    assert format_labels(expected, non_quran) == SPEC_EXAMPLE


def test_plage_de_mots_partielle():
    expected, _ = parse_labels("1.0\t2.5\t2:255[1-9]|recognized\n3.0\t4.0\t112:1[5]|recognized\n")
    assert expected[0].words == WordRange(1, 9)
    assert expected[1].words == WordRange(5, 5)
    text = format_labels(expected, ())
    assert "2:255[1-9]|recognized" in text and "112:1[5]|recognized" in text


def test_toutes_les_natures_non_coraniques():
    lines = "".join(f"{i}.0\t{i}.5\tNON_QURAN:{k.value}\n" for i, k in enumerate(NonQuranKind))
    _, non_quran = parse_labels(lines)
    assert [n.kind for n in non_quran] == list(NonQuranKind)


def test_lignes_vides_commentaires_et_selections_spectrales_ignores():
    text = "# note\n\n\\\t100.0\t900.0\n0.0\t1.0\t1:1|recognized\n"
    expected, non_quran = parse_labels(text)
    assert len(expected) == 1 and non_quran == ()


def test_tri_chronologique_a_l_export():
    a = ExpectedItem((5.0, 6.0), VerseRef(1, 2), WordRange.all(), Status.RECOGNIZED)
    b = ExpectedItem((1.0, 2.0), VerseRef(1, 1), WordRange.all(), Status.RECOGNIZED)
    lines = format_labels((a, b), ()).splitlines()
    assert lines[0].endswith("1:1|recognized") and lines[1].endswith("1:2|recognized")


@pytest.mark.parametrize(
    "line",
    [
        "0\t1\t115:1|recognized",
        "0\t1\t1:8|recognized",
        "0\t1\t67:4|uncertain",
        "0\t1\t67:4",
        "0\t1\tNON_QURAN:klingon",
        "5\t3\t67:4|recognized",
        "-1\t3\t67:4|recognized",
        "0\t1\t67:4[9-2]|recognized",
        "zéro\t1\t67:4|recognized",
        "0\t1",
    ],
)
def test_etiquette_invalide_rejetee_avec_le_numero_de_ligne(line):
    with pytest.raises(LabelError) as exc:
        parse_labels("0\t1\t1:1|recognized\n" + line + "\n")
    assert "ligne 2" in str(exc.value)


def test_toutes_les_erreurs_sont_remontees():
    with pytest.raises(LabelError) as exc:
        parse_labels("0\t1\t115:1|recognized\n0\t1\tbidon\n")
    assert len(exc.value.problems) == 2


_times = st.integers(min_value=0, max_value=3_600_000).map(lambda ms: ms / 1000)


@st.composite
def _items(draw):
    start = draw(_times)
    length = draw(st.integers(min_value=1, max_value=60_000)) / 1000
    span = (start, round(start + length, 6))
    if draw(st.booleans()):
        surah = draw(st.integers(min_value=1, max_value=114))
        from aqr.domain.quran_structure import ayah_count

        ref = VerseRef(surah, draw(st.integers(min_value=1, max_value=ayah_count(surah))))
        first = draw(st.integers(min_value=1, max_value=20))
        words = draw(
            st.sampled_from([WordRange.all(), WordRange(first, first + draw(st.integers(0, 20)))])
        )
        status = draw(st.sampled_from([Status.RECOGNIZED, Status.INFERRED]))
        return ExpectedItem(span, ref, words, status)
    return NonQuranItem(span, draw(st.sampled_from(list(NonQuranKind))))


@given(st.lists(_items(), max_size=12))
def test_aller_retour_exact_propriete(items):
    expected = tuple(i for i in items if isinstance(i, ExpectedItem))
    non_quran = tuple(i for i in items if isinstance(i, NonQuranItem))
    again_expected, again_non_quran = parse_labels(format_labels(expected, non_quran))

    # Clé de tri COMPLÈTE : deux éléments au même instant (statuts ou natures différents) ne
    # doivent pas dépendre de l'ordre d'écriture.
    def key(item: ExpectedItem | NonQuranItem) -> str:
        return repr(item)

    assert sorted(again_expected, key=key) == sorted(expected, key=key)
    assert sorted(again_non_quran, key=key) == sorted(non_quran, key=key)


# --- services sur le manifeste -------------------------------------------------------------


def _case(**over) -> AudioCase:
    base = dict(
        id="cas1",
        file="C09/cas1.mp3",
        sha256="a" * 64,
        categorie=("C09",),
        recitant="assise_a",
        riwaya="inconnu",
        langues=("fr", "ar"),
        license="x",
        duree_s=30.0,
    )
    base.update(over)
    return AudioCase(**base)  # type: ignore[arg-type]


@pytest.fixture()
def env(tmp_path: Path):
    manifest = tmp_path / "manifest.yaml"
    Manifest(cases=[_case()]).save(manifest)
    return tmp_path / "audio", manifest


def test_import_met_a_jour_le_cas_et_le_passe_a_annote(env):
    audio_dir, manifest_path = env
    (audio_dir / "labels").mkdir(parents=True)
    (audio_dir / "labels" / "cas1.txt").write_text(SPEC_EXAMPLE, encoding="utf-8")
    import_labels(manifest_path, audio_dir, "cas1", config=DataConfig())
    case = Manifest.load(manifest_path).get("cas1")
    assert case.statut == "annote"
    assert len(case.expected) == 3 and len(case.non_quran) == 1


def test_export_puis_import_redonne_la_verite_terrain(env):
    audio_dir, manifest_path = env
    labels = audio_dir / "labels" / "cas1.txt"
    labels.parent.mkdir(parents=True)
    labels.write_text(SPEC_EXAMPLE, encoding="utf-8")
    import_labels(manifest_path, audio_dir, "cas1", config=DataConfig())
    before = Manifest.load(manifest_path).get("cas1")
    labels.unlink()
    export_labels(manifest_path, audio_dir, "cas1")
    import_labels(manifest_path, audio_dir, "cas1", config=DataConfig())
    after = Manifest.load(manifest_path).get("cas1")
    assert (after.expected, after.non_quran) == (before.expected, before.non_quran)


def test_export_ne_ecrase_jamais_un_fichier_corrige_a_la_main(env):
    audio_dir, manifest_path = env
    labels = audio_dir / "labels" / "cas1.txt"
    labels.parent.mkdir(parents=True)
    labels.write_text("0.0\t1.0\t1:1|recognized\n", encoding="utf-8")
    with pytest.raises(FileExistsError):
        export_labels(manifest_path, audio_dir, "cas1")
    assert labels.read_text(encoding="utf-8") == "0.0\t1.0\t1:1|recognized\n"
    export_labels(manifest_path, audio_dir, "cas1", force=True)


def test_import_refuse_une_etiquette_hors_de_la_duree(env):
    audio_dir, manifest_path = env
    labels = audio_dir / "labels" / "cas1.txt"
    labels.parent.mkdir(parents=True)
    labels.write_text("0.0\t99.0\t1:1|recognized\n", encoding="utf-8")
    with pytest.raises(LabelError, match="durée"):
        import_labels(manifest_path, audio_dir, "cas1", config=DataConfig())


def test_import_sans_fichier_d_etiquettes(env):
    audio_dir, manifest_path = env
    with pytest.raises(FileNotFoundError):
        import_labels(manifest_path, audio_dir, "cas1", config=DataConfig())


class _FakeAnnotator:
    """Mélange réaliste d'une assise (C09/C11) : français, citation coranique, hadith, français."""

    def preannotate(self, wav: Path) -> PreAnnotation:
        return PreAnnotation(
            expected=(
                ExpectedItem((12.0, 18.5), VerseRef(2, 255), WordRange(1, 9), Status.RECOGNIZED),
            ),
            non_quran=(
                NonQuranItem((0.0, 12.0), NonQuranKind.FRENCH),
                NonQuranItem((18.5, 25.0), NonQuranKind.ARABIC_SPEECH),
                NonQuranItem((25.0, 30.0), NonQuranKind.FRENCH),
            ),
        )


def test_preannotate_ecrit_un_fichier_d_etiquettes_sans_annoter_le_cas(env):
    audio_dir, manifest_path = env
    (audio_dir / "_derived").mkdir(parents=True)
    (audio_dir / "_derived" / "cas1.wav").write_bytes(b"")
    path = preannotate(manifest_path, audio_dir, "cas1", _FakeAnnotator())
    text = path.read_text(encoding="utf-8")
    assert "2:255[1-9]|recognized" in text and "NON_QURAN:arabic_speech" in text
    assert Manifest.load(manifest_path).get("cas1").statut == "a_annoter"
    # le résultat se relit tel quel (le mélange français/Coran/hadith survit à l'aller-retour)
    expected, non_quran = parse_labels(text)
    assert len(expected) == 1 and len(non_quran) == 3


def test_preannotate_sans_moteur_branche_est_un_message_clair(env):
    from aqr.data.labels import PreannotationUnavailable, UnavailablePreAnnotator

    audio_dir, manifest_path = env
    (audio_dir / "_derived").mkdir(parents=True)
    (audio_dir / "_derived" / "cas1.wav").write_bytes(b"")
    with pytest.raises(PreannotationUnavailable, match="phase 5"):
        preannotate(manifest_path, audio_dir, "cas1", UnavailablePreAnnotator())


def test_elements_au_meme_instant_survivent_a_l_aller_retour():
    # Cas trouvé par la propriété : mêmes bornes, statuts/natures différents.
    a = ExpectedItem((0.0, 0.001), VerseRef(1, 1), WordRange.all(), Status.RECOGNIZED)
    b = ExpectedItem((0.0, 0.001), VerseRef(1, 1), WordRange.all(), Status.INFERRED)
    n1 = NonQuranItem((0.0, 0.001), NonQuranKind.SILENCE)
    n2 = NonQuranItem((0.0, 0.001), NonQuranKind.NOISE)
    expected, non_quran = parse_labels(format_labels((a, b), (n1, n2)))
    assert set(expected) == {a, b} and len(expected) == 2
    assert set(non_quran) == {n1, n2} and len(non_quran) == 2
