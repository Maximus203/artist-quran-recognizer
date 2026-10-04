"""Échange des lots audio d'évaluation via un dataset Hugging Face PRIVÉ (jamais via git).

    python scripts/audio_lot.py upload --lot 1 --src D:\\01-Dev\\Data\\aqr-audio\\inbox
    python scripts/audio_lot.py fetch  --lot 1            # écrit dans $AQR_AUDIO_DIR/inbox

Variables : HF_TOKEN (écriture pour upload, lecture pour fetch), AQR_HF_DATASET (« user/nom »),
AQR_AUDIO_DIR (fetch). Dépendance : pip install -e ".[data]".
Le manifeste docs/data-lots/lot-N.yaml fait foi (id, sha256, durée, catégories, source).
"""

from __future__ import annotations

import argparse
import hashlib
import os
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]


def load_manifest(lot: int) -> list[dict]:
    path = ROOT / "docs" / "data-lots" / f"lot-{lot}.yaml"
    return yaml.safe_load(path.read_text(encoding="utf-8"))["fichiers"]


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _env(name: str) -> str:
    value = os.environ.get(name, "")
    if not value:
        sys.exit(f"Variable d'environnement manquante : {name}")
    return value


def upload(lot: int, src: Path) -> None:
    from huggingface_hub import HfApi

    api = HfApi(token=_env("HF_TOKEN"))
    repo = _env("AQR_HF_DATASET")
    api.create_repo(repo, repo_type="dataset", private=True, exist_ok=True)
    if not api.repo_info(repo, repo_type="dataset").private:
        sys.exit(f"ABANDON : {repo} n'est pas privé. Passe-le en privé avant tout envoi.")
    by_hash = {sha256_of(p): p for p in src.glob("*.mp3")}
    for item in load_manifest(lot):
        local = by_hash.get(item["sha256"])
        if local is None:
            sys.exit(f"Fichier introuvable pour {item['id']} (sha256 absent de {src}).")
        api.upload_file(
            path_or_fileobj=str(local),
            path_in_repo=f"lot-{lot}/{item['id']}.mp3",
            repo_id=repo,
            repo_type="dataset",
        )
        print(f"envoyé {item['id']}")


def fetch(lot: int) -> None:
    from huggingface_hub import hf_hub_download

    token, repo = _env("HF_TOKEN"), _env("AQR_HF_DATASET")
    inbox = Path(_env("AQR_AUDIO_DIR")) / "inbox"
    inbox.mkdir(parents=True, exist_ok=True)
    for item in load_manifest(lot):
        cached = hf_hub_download(
            repo, f"lot-{lot}/{item['id']}.mp3", repo_type="dataset", token=token
        )
        if sha256_of(Path(cached)) != item["sha256"]:
            sys.exit(f"sha256 différent pour {item['id']} : fichier corrompu ou remplacé.")
        dest = inbox / f"{item['id']}.mp3"
        dest.write_bytes(Path(cached).read_bytes())
        sidecar = {k: item[k] for k in ("categorie", "recitant", "riwaya", "langues", "source")}
        sidecar["fichier"] = dest.name
        sidecar["droits"] = "usage interne d'évaluation uniquement, jamais redistribué"
        dest.with_suffix(".yaml").write_text(
            yaml.safe_dump(sidecar, allow_unicode=True, sort_keys=False), encoding="utf-8"
        )
        print(f"ok {item['id']}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)
    up = sub.add_parser("upload")
    up.add_argument("--lot", type=int, required=True)
    up.add_argument("--src", type=Path, required=True)
    fe = sub.add_parser("fetch")
    fe.add_argument("--lot", type=int, required=True)
    args = parser.parse_args()
    if args.cmd == "upload":
        upload(args.lot, args.src)
    else:
        fetch(args.lot)


if __name__ == "__main__":
    main()
