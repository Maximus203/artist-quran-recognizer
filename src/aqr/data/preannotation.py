"""Préannotation modèle : étiquettes Audacity à corriger + fichier de provenance.

Une sortie `aqr.recognition/1` devient un fichier d'étiquettes (`labels/<id>.txt`, format
docs/DATA-COLLECTION.md §5) et un compagnon `labels/<id>.provenance.json`. Ce n'est JAMAIS une
vérité terrain : le cas du manifeste n'est pas modifié (il reste `a_annoter`), et la provenance
dit `independent_truth: false` / `must_be_reviewed_by_human: true`.

Étiquettes produites :
- lisibles par l'import (à confirmer ou corriger à l'oreille) : versets `recognized`
  (`67:4|recognized`, `2:255[1-5]|recognized`) et zones `NON_QURAN:<nature>` connues
  (basmala, istiadha, takbir, amin) ;
- NON lisibles par l'import (`UNCONFIRMED:<sorte>:<détail>`) : versets `inferred` / `uncertain`,
  `abstention`, `non_quran` non classé. L'import échoue tant qu'il en reste : l'annotateur doit
  les trancher (renommer en étiquette de vérité, ou supprimer), jamais les laisser passer.
Les versets sans horodatage ne peuvent pas être posés : ils sont listés dans la provenance.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from aqr.data.config import DataConfig
from aqr.data.labels import _write_labels, format_labels, labels_path
from aqr.data.manifest import ExpectedItem, Manifest, NonQuranItem, WordRange
from aqr.domain.models import NonQuranKind, Status, VerseRef
from aqr.eval.recognition import (
    SCHEMA,
    AbstentionInterval,
    NonQuranInterval,
    Recognition,
    RecognitionError,
    VerseInterval,
    load_recognition,
)

UNCONFIRMED = "UNCONFIRMED"
_KNOWN_NON_QURAN = {
    "basmala": NonQuranKind.BASMALA,
    "istiadha": NonQuranKind.ISTIADHA,
    "takbir": NonQuranKind.TAKBIR,
    "amin": NonQuranKind.AMIN,
}
WordCount = Callable[[VerseRef], int | None]


class PreannotationRefused(ValueError):
    pass


@dataclass(frozen=True)
class Preannotation:
    label_text: str
    provenance: dict[str, Any]
    n_unlocated: int


def provenance_path(audio_dir: Path, case_id: str) -> Path:
    return labels_path(audio_dir, case_id).with_name(f"{case_id}.provenance.json")


def _words(ref: VerseRef, first: int, last: int, full: WordCount | None) -> WordRange:
    count = full(ref) if full else None
    if count is not None and first == 1 and last == count:
        return WordRange.all()
    return WordRange(first, last)


def _readable_label(item: ExpectedItem | NonQuranItem) -> str:
    return (
        format_labels(
            (item,) if isinstance(item, ExpectedItem) else (),
            (item,) if isinstance(item, NonQuranItem) else (),
        )
        .split("\t")[2]
        .rstrip("\n")
    )


def _suffix(ref: VerseRef, words: WordRange) -> str:
    return str(ref) if words.is_all else f"{ref}[{words}]"


def build_preannotation(
    recognition: Recognition, *, full_word_count: WordCount | None = None, case_id: str = ""
) -> Preannotation:
    rows: list[tuple[float, float, str]] = []
    unlocated: list[dict[str, Any]] = []
    n_unconfirmed = 0
    for interval in recognition.intervals:
        if isinstance(interval, VerseInterval):
            words = _words(interval.ref, interval.first_word, interval.last_word, full_word_count)
            if interval.t is None:
                unlocated.append(
                    {
                        "ref": str(interval.ref),
                        "status": interval.status.value,
                        "candidates": [str(c) for c in interval.candidates],
                    }
                )
                continue
            start, end = interval.t
            if interval.status is Status.RECOGNIZED:
                item = ExpectedItem(interval.t, interval.ref, words, Status.RECOGNIZED)
                rows.append((start, end, _readable_label(item)))
                continue
            label = f"{UNCONFIRMED}:{interval.status.value}:{_suffix(interval.ref, words)}"
            if interval.candidates:
                label += "?candidates=" + ",".join(str(c) for c in interval.candidates)
            rows.append((start, end, label))
            n_unconfirmed += 1
        elif isinstance(interval, NonQuranInterval):
            kind = _KNOWN_NON_QURAN.get(interval.label)
            if kind is not None:
                rows.append((*interval.t, _readable_label(NonQuranItem(interval.t, kind))))
            else:
                rows.append((*interval.t, f"{UNCONFIRMED}:non_quran:{interval.label}"))
                n_unconfirmed += 1
        elif isinstance(interval, AbstentionInterval):
            rows.append((*interval.t, f"{UNCONFIRMED}:abstention:{interval.reason}"))
            n_unconfirmed += 1
    rows.sort()
    text = "".join(f"{a:.6f}\t{b:.6f}\t{label}\n" for a, b, label in rows)
    provenance: dict[str, Any] = {
        "produced_by": dict(recognition.engine),
        "independent_truth": False,
        "must_be_reviewed_by_human": True,
        "case_id": case_id,
        "recognition_schema": SCHEMA,
        "source": {k: recognition.source.get(k) for k in ("file", "sha256", "duration_s")},
        "n_labels": len(rows),
        "n_unconfirmed_labels": n_unconfirmed,
        "unlocated": unlocated,
        "note": (
            "Préannotation modèle : proposition à corriger à l'oreille, jamais une vérité "
            "terrain. Les étiquettes UNCONFIRMED:* doivent être tranchées ou supprimées avant "
            "l'import ; seul un humain relecteur peut enregistrer annotation.by: human."
        ),
    }
    return Preannotation(text, provenance, len(unlocated))


def write_preannotation(
    manifest_path: Path,
    audio_dir: Path,
    recognition_path: Path,
    *,
    case_id: str | None = None,
    corpus_dir: Path | None = None,
    force: bool = False,
) -> tuple[Path, Path]:
    """Écrit `labels/<id>.txt` + `.provenance.json` ; jamais d'écrasement sans `force`."""
    try:
        recognition = load_recognition(recognition_path)
    except RecognitionError as exc:
        raise PreannotationRefused(str(exc)) from exc
    cid = case_id or Path(str(recognition.source.get("file", ""))).stem or recognition_path.stem
    manifest = Manifest.load(manifest_path)
    try:
        case = manifest.get(cid)
    except KeyError as exc:
        raise PreannotationRefused(f"cas inconnu du manifeste : {cid}") from exc
    if case.split == "test":
        raise PreannotationRefused(
            f"cas {cid} : jeu test réservé, aucune préannotation modèle dessus (mesures finales)"
        )
    if case.split == DataConfig().quarantine_split:
        raise PreannotationRefused(
            f"cas {cid} : récitant en quarantaine, aucune préannotation modèle dessus"
        )
    sha = recognition.source.get("sha256")
    if sha and str(sha) != case.sha256:
        raise PreannotationRefused(
            f"cas {cid} : sha256 de la sortie différent de celui du manifeste (autre fichier)"
        )
    labels, provenance = labels_path(audio_dir, cid), provenance_path(audio_dir, cid)
    if not force:
        for path in (labels, provenance):
            if path.exists():
                raise FileExistsError(
                    f"{path} existe déjà (peut contenir des corrections manuelles) : "
                    "relancer avec force pour l'écraser"
                )
    pre = build_preannotation(recognition, full_word_count=_word_counter(corpus_dir), case_id=cid)
    _write_labels(labels, pre.label_text, force)
    provenance.write_text(
        json.dumps(pre.provenance, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    return labels, provenance


def _word_counter(corpus_dir: Path | None) -> WordCount | None:
    if corpus_dir is None or not corpus_dir.is_dir():
        return None
    from aqr.corpus.tanzil_repository import TanzilCorpusRepository

    try:
        repo = TanzilCorpusRepository(corpus_dir)
        repo.words(VerseRef(1, 1))
    except (OSError, ValueError, KeyError):
        return None
    return lambda ref: len(repo.words(ref))
