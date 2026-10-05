"""`Hub` réel : Hugging Face (huggingface_hub). I/O réseau, non couvert par la suite unitaire."""

from __future__ import annotations

import shutil
import tempfile
from pathlib import Path

from aqr.models.sync import RemoteFile, RemoteInfo


class HfHub:  # pragma: no cover - réseau
    def __init__(self, token: str | None = None) -> None:
        self._token = token

    def resolve(self, repo_id: str, revision: str | None) -> RemoteInfo:
        from huggingface_hub import HfApi

        info = HfApi(token=self._token).model_info(repo_id, revision=revision, files_metadata=True)
        if info.sha is None:
            raise RuntimeError(f"{repo_id} : révision introuvable")
        files: dict[str, RemoteFile] = {}
        for sibling in info.siblings or []:
            lfs = sibling.lfs
            files[sibling.rfilename] = RemoteFile(
                size=sibling.size or 0, sha256=lfs.sha256 if lfs is not None else None
            )
        return RemoteInfo(revision=info.sha, files=files)

    def download(self, repo_id: str, filename: str, revision: str, dest: Path) -> None:
        from huggingface_hub import hf_hub_download

        dest.parent.mkdir(parents=True, exist_ok=True)
        scratch = Path(tempfile.mkdtemp(dir=dest.parent, prefix=".hf-"))
        try:
            fetched = hf_hub_download(
                repo_id, filename, revision=revision, local_dir=scratch, token=self._token
            )
            shutil.move(fetched, dest)
        finally:
            shutil.rmtree(scratch, ignore_errors=True)
