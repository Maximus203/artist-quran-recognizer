"""Provenance et comparaison des rapports d'évaluation (`scripts/evaluate.py`).

Un chiffre sans son contexte ne se compare pas : le rapport porte la machine (CPU, cœurs), le SHA
git, les empreintes des modèles épinglés (`models/LOCK.json`), l'empreinte du manifeste, le
split, les
seuils et la version de normalisation. `compare_reports` REFUSE de comparer deux rapports dont les
manifestes (fichier ou cas évalués), le split, le schéma ou la normalisation diffèrent : les
différences de git, de modèles, de seuils ou de machine sont au contraire ce qu'on veut comparer et
sont listées (`context_changes`). Aucune valeur n'est inventée : ce qui n'est pas mesuré est `None`.
"""

from __future__ import annotations

import hashlib
import json
import os
import platform
import subprocess
from collections.abc import Iterable, Mapping, Sequence
from pathlib import Path
from typing import Any

from aqr.eval.metrics import CaseResult


class BaselineRefused(ValueError):
    """Les deux rapports ne sont pas comparables (manifeste, split, schéma ou normalisation)."""


def machine_id() -> dict[str, Any]:
    """CPU et cœurs de la machine qui exécute (jamais le nom d'hôte : vie privée)."""
    model = ""
    try:
        for line in Path("/proc/cpuinfo").read_text(encoding="utf-8").splitlines():
            if line.lower().startswith(("model name", "hardware", "cpu model")):
                model = line.split(":", 1)[1].strip()
                break
    except OSError:
        pass
    return {
        "cpu_model": model or platform.processor() or platform.machine() or "inconnu",
        "cores": os.cpu_count() or 1,
        "platform": platform.platform(),
        "python": platform.python_version(),
    }


def _git(root: Path, *args: str) -> str | None:
    try:
        done = subprocess.run(
            ["git", "-C", str(root), *args],
            capture_output=True,
            text=True,
            check=True,
            timeout=30,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return done.stdout.strip()


def git_state(root: Path) -> dict[str, Any]:
    """SHA du commit courant et arbre modifié ou non ; `None` hors dépôt git."""
    sha = _git(root, "rev-parse", "HEAD")
    if not sha:
        return {"sha": None, "dirty": None}
    status = _git(root, "status", "--porcelain")
    return {"sha": sha, "dirty": None if status is None else bool(status)}


def _sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def models_state(lock_path: Path) -> dict[str, Any]:
    """Empreintes épinglées de `models/LOCK.json` (révision + SHA-256 de chaque fichier)."""
    if not lock_path.exists():
        return {"lock_sha256": None, "models": {}}
    data = json.loads(lock_path.read_text(encoding="utf-8"))
    return {
        "lock_sha256": _sha256_file(lock_path),
        "models": {
            key: {
                "repo_id": model["repo_id"],
                "revision": model["revision"],
                "files": {name: f["sha256"] for name, f in sorted(model["files"].items())},
            }
            for key, model in sorted(data.get("models", {}).items())
        },
    }


def manifest_identity(path: Path, cases: Iterable[tuple[str, str, str | None]]) -> dict[str, Any]:
    """Identité du manifeste : empreinte du fichier + celle des cas évalués (id, sha, split)."""
    listing = json.dumps(sorted([c[0], c[1], c[2]] for c in cases), ensure_ascii=False)
    return {
        "name": path.name,
        "sha256": _sha256_file(path) if path.exists() else None,
        "cases_sha256": hashlib.sha256(listing.encode("utf-8")).hexdigest(),
    }


def speed_block(
    results: Sequence[CaseResult], *, peaks: Mapping[str, float], machine: Mapping[str, Any]
) -> dict[str, Any]:
    """Bloc « vitesse » : temps mur, facteur temps réel (somme/somme), pic de RAM, machine."""
    timed = [r for r in results if r.realtime_factor is not None]
    wall = sum(r.total_s or 0.0 for r in timed)
    audio = sum(r.duration_s or 0.0 for r in timed)
    measured = [peaks[r.case_id] for r in results if r.case_id in peaks]
    return {
        "wall_s": wall,
        "audio_s": audio,
        "realtime_factor": wall / audio if audio else None,
        "n_cases_with_timing": len(timed),
        "peak_ram_mb": max(measured) if measured else None,
        "peak_ram_note": None
        if measured
        else "non mesuré : aucun pic de RAM fourni par les sorties",
        "machine": dict(machine),
    }


# --- comparaison -----------------------------------------------------------------------------


def _numeric_leaves(node: Any, prefix: str) -> dict[str, float]:
    if isinstance(node, bool):
        return {}
    if isinstance(node, int | float):
        return {prefix: float(node)}
    if isinstance(node, Mapping):
        out: dict[str, float] = {}
        for key, value in node.items():
            out.update(_numeric_leaves(value, f"{prefix}.{key}" if prefix else str(key)))
        return out
    return {}


def _require_same(label: str, current: Any, baseline: Any, what: str) -> None:
    if current != baseline:
        raise BaselineRefused(f"{label} différent : {what}")


def compare_reports(current: Mapping[str, Any], baseline: Mapping[str, Any]) -> dict[str, Any]:
    """Écarts (courant − base) des valeurs numériques communes ; refuse un couple non comparable."""
    _require_same(
        "schéma",
        current.get("schema"),
        baseline.get("schema"),
        f"{baseline.get('schema')!r} (base) ≠ {current.get('schema')!r}",
    )
    manifest_now, manifest_then = current.get("manifest") or {}, baseline.get("manifest") or {}
    for key in ("sha256", "cases_sha256"):
        if not manifest_now.get(key) or manifest_now.get(key) != manifest_then.get(key):
            raise BaselineRefused(
                f"manifeste différent ({key}) : on ne compare que des mesures du même manifeste "
                "et des mêmes cas évalués"
            )
    _require_same(
        "split",
        current.get("split"),
        baseline.get("split"),
        f"{baseline.get('split')!r} (base) ≠ {current.get('split')!r}",
    )
    norm_now, norm_then = current.get("normalization") or {}, baseline.get("normalization") or {}
    if norm_now != norm_then:
        raise BaselineRefused(
            "normalisation différente (version ou dictionnaire imla'i) : "
            f"{norm_then.get('version')} ≠ {norm_now.get('version')} ; WER/CER non comparables"
        )

    now = {
        **_numeric_leaves(current.get("vitesse"), "vitesse"),
        **_numeric_leaves(current.get("exactitude"), "exactitude"),
    }
    then = {
        **_numeric_leaves(baseline.get("vitesse"), "vitesse"),
        **_numeric_leaves(baseline.get("exactitude"), "exactitude"),
    }
    metrics = {
        path: {"baseline": then[path], "current": now[path], "delta": now[path] - then[path]}
        for path in sorted(now.keys() & then.keys())
    }
    changes = [
        f"{label} : {then_v} -> {now_v}"
        for label, now_v, then_v in (
            ("git", current.get("git"), baseline.get("git")),
            ("modèles", current.get("models"), baseline.get("models")),
            ("seuils", current.get("thresholds"), baseline.get("thresholds")),
            (
                "machine",
                (current.get("vitesse") or {}).get("machine"),
                (baseline.get("vitesse") or {}).get("machine"),
            ),
        )
        if now_v != then_v
    ]
    return {
        "baseline_git": baseline.get("git"),
        "metrics": metrics,
        "context_changes": changes,
    }
