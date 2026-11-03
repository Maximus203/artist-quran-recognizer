"""Script `build_finetune_manifest.py` : hors dépôt, construction complète d'un mini-shard."""

from __future__ import annotations

import hashlib
import io
import json
from pathlib import Path

import pytest
from scripts.build_finetune_manifest import ROOT, main, part_name

from aqr.data.finetune_sources import EXCLUDED_TADABUR_RECITERS, TADABUR
from aqr.models.lock import LockedModel, LockedModelFile, ModelsLock

CORPUS = ROOT / "data" / "corpus"


def test_nom_de_part_stable() -> None:
    assert part_name("data/train-00384.parquet") == "data__train-00384"
    assert part_name("audio/ar/dev/ar_dev_0.tar") == "audio__ar__dev__ar_dev_0"


def test_dossier_dans_le_depot_refuse() -> None:
    with pytest.raises(SystemExit, match="hors dépôt"):
        main(["--data-dir", str(ROOT / "data"), "fetch", "--dry-run"])


def test_variable_d_environnement_exigee(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AQR_FINETUNE_DIR", raising=False)
    with pytest.raises(SystemExit, match="AQR_FINETUNE_DIR"):
        main(["fetch", "--dry-run"])


def _wav(seconds: float) -> bytes:
    np = pytest.importorskip("numpy")
    sf = pytest.importorskip("soundfile")
    buffer = io.BytesIO()
    sf.write(buffer, np.full((int(seconds * 44100), 2), 0.1, "float32"), 44100, format="WAV")
    return buffer.getvalue()


def _mini_tadabur(raw: Path) -> dict[str, bytes]:
    pa = pytest.importorskip("pyarrow")
    pq = pytest.importorskip("pyarrow.parquet")
    pytest.importorskip("soxr")
    excluded = next(iter(EXCLUDED_TADABUR_RECITERS))
    rows = [  # (récitant, sourate base 0, verset, texte source)
        (500, 111, 1, "قل هو الله احد"),
        (excluded, 111, 2, "الله الصمد"),
        (500, 111, 3, "لم يلد ولم يولد ولا شيء"),
    ]
    table = pa.table(
        {
            "audio": [{"bytes": _wav(1.0), "path": None} for _ in rows],
            "reciter_id": pa.array([r[0] for r in rows], pa.int32()),
            "surah_id": pa.array([r[1] for r in rows], pa.int32()),
            "ayah_id": pa.array([r[2] for r in rows], pa.int32()),
            "text_ar_simple": [r[3] for r in rows],
            "ayah_duration_s": pa.array([1.0] * len(rows), pa.float32()),
            "metadata": [
                json.dumps(
                    {"audio_filename": f"tadabur_spk{r[0]:04d}_S{r[1]}_A{r[2]}_x_000001.wav"}
                )
                for r in rows
            ],
        }
    )
    shard = raw / TADABUR / "data" / "train-00000.parquet"
    shard.parent.mkdir(parents=True)
    pq.write_table(table, shard)
    sheikh = raw / TADABUR / "sheikh_dict.json"
    names = {f"r{i}": i for i in [500, *EXCLUDED_TADABUR_RECITERS]}
    sheikh.write_text(json.dumps(names), encoding="utf-8")
    return {"data/train-00000.parquet": shard.read_bytes(), "sheikh_dict.json": sheikh.read_bytes()}


@pytest.mark.skipif(not (CORPUS / "quran-simple.txt").exists(), reason="corpus non téléchargé")
def test_construction_tadabur_de_bout_en_bout(tmp_path: Path) -> None:
    data_dir = tmp_path / "ft"
    files = _mini_tadabur(data_dir / "raw")
    lock_path = tmp_path / "LOCK.json"
    ModelsLock(
        {
            TADABUR: LockedModel(
                repo_id="FaisaI/tadabur",
                revision="a" * 40,
                license="cc-by-nc-4.0",
                files={
                    n: LockedModelFile(hashlib.sha256(b).hexdigest(), len(b))
                    for n, b in files.items()
                },
            )
        }
    ).save(lock_path)
    argv = ["--data-dir", str(data_dir), "--lock", str(lock_path), "build", "--source", TADABUR]
    assert main([*argv, "--corpus", str(CORPUS), "--prune-raw"]) == 0

    manifests = data_dir / "manifests" / TADABUR
    lines = [
        json.loads(line)
        for split in ("train", "val")
        for line in (manifests / f"{split}.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert [line["aqr_ref"] for line in lines] == ["112:1"]
    # Texte du corpus (vocalisé), sans la basmala que la source ne récite pas ici.
    corpus_line = next(
        line
        for line in (CORPUS / "quran-simple.txt").read_text(encoding="utf-8").splitlines()
        if line.startswith("112|1|")
    )
    assert lines[0]["text"] == " ".join(corpus_line.split("|")[2].split()[4:])
    audio = (manifests / lines[0]["audio_filepath"]).resolve()
    assert audio.is_file() and data_dir in audio.parents
    assert lines[0]["duration"] == pytest.approx(1.0, abs=1e-3)
    report = json.loads((manifests / "report.json").read_text(encoding="utf-8"))
    assert report["rejected"]["voix_exclue"]["count"] == 1
    assert report["rejected"]["texte_different_du_corpus"]["count"] == 1
    trace = json.loads((manifests / "build.json").read_text(encoding="utf-8"))
    assert trace["revision"] == "a" * 40 and trace["config"]["quran_ngram"] == 4
    assert not (data_dir / "raw" / TADABUR / "data" / "train-00000.parquet").exists()  # élagué
    # Relancer ne retraite rien (part déjà faite, source élaguée) et refusionne à l'identique.
    assert main([*argv, "--corpus", str(CORPUS)]) == 0
    assert json.loads((manifests / "report.json").read_text(encoding="utf-8")) == report
