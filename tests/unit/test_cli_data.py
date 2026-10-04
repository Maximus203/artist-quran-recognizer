"""CLI `aqr data ...` : ingest, étiquettes, split, pré-annotation (moteur : phase 5)."""

from __future__ import annotations

import io
import math
import struct
import wave
from pathlib import Path

import pytest
import yaml

from aqr.cli import main
from aqr.data.manifest import Manifest


def fake_convert(src: Path, dest: Path, sample_rate: int) -> None:
    with wave.open(str(dest), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(
            b"".join(struct.pack("<h", int(6000 * math.sin(i / 7))) for i in range(sample_rate * 3))
        )


class Run:
    def __init__(self, tmp_path: Path) -> None:
        self.audio = tmp_path / "audio"
        self.manifest = tmp_path / "manifest.yaml"
        self.out, self.err = io.StringIO(), io.StringIO()

    def __call__(self, *args: str, env: dict[str, str] | None = None) -> int:
        full_env = {"AQR_AUDIO_DIR": str(self.audio)} if env is None else env
        return main(
            ["data", "--manifest", str(self.manifest), *args],
            env=full_env,
            out=self.out,
            err=self.err,
            convert=fake_convert,
        )


@pytest.fixture()
def run(tmp_path: Path) -> Run:
    return Run(tmp_path)


def drop(run: Run, name: str, recitant: str, content: bytes, duree_cat: str = "C09") -> None:
    inbox = run.audio / "inbox"
    inbox.mkdir(parents=True, exist_ok=True)
    (inbox / name).write_bytes(content)
    (inbox / name).with_suffix(".yaml").write_text(
        yaml.safe_dump(
            {
                "fichier": name,
                "categorie": [duree_cat],
                "recitant": recitant,
                "riwaya": "inconnu",
                "langues": ["fr", "ar"],
                "droits": "usage interne test",
            }
        ),
        encoding="utf-8",
    )


def test_ingest_affiche_le_rapport_et_remplit_le_manifeste(run: Run):
    drop(run, "a.mp3", "assise_a", b"aaa")
    assert run("ingest") == 0
    assert "a" in Manifest.load(run.manifest).get("a").id
    assert "1 ajouté" in run.out.getvalue()


def test_ingest_code_de_sortie_1_si_une_fiche_est_en_erreur(run: Run):
    drop(run, "ko.mp3", "x", b"ko")
    (run.audio / "inbox" / "ko.yaml").write_text("fichier: ko.mp3\n", encoding="utf-8")
    assert run("ingest") == 1
    assert "champ obligatoire manquant" in run.err.getvalue()


def test_export_puis_import_des_etiquettes(run: Run):
    drop(run, "a.mp3", "assise_a", b"aaa")
    run("ingest")
    assert run("export-labels", "a") == 0
    labels = run.audio / "labels" / "a.txt"
    labels.write_text("0.0\t1.5\t112:1|recognized\n1.5\t2.5\tNON_QURAN:french\n", encoding="utf-8")
    assert run("import-labels", "a") == 0
    case = Manifest.load(run.manifest).get("a")
    assert case.statut == "annote" and len(case.expected) == 1 and len(case.non_quran) == 1


def test_export_refuse_d_ecraser_sans_force(run: Run):
    drop(run, "a.mp3", "assise_a", b"aaa")
    run("ingest")
    run("export-labels", "a")
    assert run("export-labels", "a") == 1
    assert "force" in run.err.getvalue()
    assert run("export-labels", "a", "--force") == 0


def test_import_signale_les_lignes_en_erreur(run: Run):
    drop(run, "a.mp3", "assise_a", b"aaa")
    run("ingest")
    run("export-labels", "a")
    (run.audio / "labels" / "a.txt").write_text("0\t1\t999:1|recognized\n", encoding="utf-8")
    assert run("import-labels", "a") == 1
    assert "ligne 1" in run.err.getvalue()


def test_split_affecte_les_recitants_sans_fuite_et_est_stable(run: Run):
    for i, recitant in enumerate(["r1", "r2", "r3", "r4", "r1"]):
        drop(run, f"f{i}.mp3", recitant, f"contenu {i}".encode())
    run("ingest")
    assert run("split") == 0
    cases = Manifest.load(run.manifest).cases
    sides: dict[str, set[str | None]] = {}
    for case in cases:
        sides.setdefault(case.recitant, set()).add(case.split)
    assert all(len(s) == 1 and None not in s for s in sides.values())
    before = {c.id: c.split for c in cases}
    run("split")
    assert {c.id: c.split for c in Manifest.load(run.manifest).cases} == before


def test_split_dry_run_n_ecrit_rien(run: Run):
    drop(run, "a.mp3", "r1", b"x")
    run("ingest")
    assert run("split", "--dry-run") == 0
    assert Manifest.load(run.manifest).get("a").split is None


def test_preannotate_explique_que_le_moteur_vient_en_phase_5(run: Run):
    drop(run, "a.mp3", "assise_a", b"aaa")
    run("ingest")
    assert run("preannotate", "a") == 2
    assert "phase 5" in run.err.getvalue()


def test_variable_audio_dir_manquante_message_clair(run: Run):
    assert run("ingest", env={}) == 2
    assert "AQR_AUDIO_DIR" in run.err.getvalue()


def test_cas_inconnu(run: Run):
    drop(run, "a.mp3", "assise_a", b"aaa")
    run("ingest")
    assert run("export-labels", "nexiste-pas") == 1
    assert "nexiste-pas" in run.err.getvalue()


def test_sans_commande_affiche_l_aide(run: Run):
    out = io.StringIO()
    assert main([], env={}, out=out, err=io.StringIO()) == 0
    assert "data" in out.getvalue()
