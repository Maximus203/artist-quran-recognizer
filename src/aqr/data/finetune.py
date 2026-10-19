"""Jeu de données du fine-tuning de l'ASR (étape C) : du fichier source au manifeste NeMo.

Chaque fichier de données téléchargé (« unité ») produit une « part » : un JSONL par jeu
(`train`, `val`) et un rapport de comptage, écrits ensemble. Les parts sont ensuite fusionnées
en `train.jsonl` / `val.jsonl` par source. Un fichier source peut donc être supprimé dès que sa
part existe (Tadabur pèse 938 Go), et une construction interrompue reprend où elle s'est arrêtée.

Règles (docs/evaluation/finetune-data.md) :
- Récitation : le texte cible vient TOUJOURS du corpus (graphie Tanzil `simple`, imla'i vocalisée),
  jamais de la source ; la source sert seulement à vérifier que l'audio dit bien ce verset.
- Parole non coranique : texte de la source nettoyé de sa ponctuation ; une phrase avec un
  caractère hors de l'alphabet du corpus (chiffres, lettres latines) est écartée, une phrase qui
  contient un passage du Coran aussi (I3/I4).
- Un locuteur n'est que d'un côté (train ou val) ; les voix des jeux d'évaluation du dépôt
  sont exclues des deux.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
import unicodedata
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path
from typing import Any, Protocol

from aqr.corpus.normalize import normalize_arabic, tokenize
from aqr.data.config import FinetuneConfig
from aqr.data.finetune_sources import DatasetSpec, ExcludedVoice
from aqr.domain.models import VerseRef
from aqr.domain.quran_structure import BASMALA_WORD_COUNT, verse_one_includes_basmala

_SECONDS_PER_HOUR = 3600
_REPORT_PRECISION = 4
_UNSAFE_CHARS = re.compile(r"[^\w.-]")
"""Décimales des heures et secondes dans les rapports."""


class Rejection(StrEnum):
    EXCLUDED_VOICE = "voix_exclue"
    BAD_REF = "reference_invalide"
    TEXT_MISMATCH = "texte_different_du_corpus"
    ALPHABET = "caracteres_hors_alphabet"
    EMPTY = "texte_vide"
    CONTAINS_QURAN = "contient_du_coran"
    UNREADABLE = "audio_illisible"
    DURATION = "duree_hors_bornes"


# --- Tadabur ------------------------------------------------------------------------------------


def tadabur_ref(surah_id: int, ayah_id: int) -> VerseRef:
    """Tadabur numérote les sourates à partir de 0 (`surah_dict.json` : « الفاتحة » → 0 ; S18 A95
    porte le texte de 19:95) et les versets à partir de 1. Lève ValueError hors du Mushaf."""
    return VerseRef(surah_id + 1, ayah_id)


def tadabur_speaker(reciter_id: int) -> str:
    return f"tadabur-{reciter_id}"


def quran_target_text(ref: VerseRef, simple_words: tuple[str, ...], source_text: str) -> str | None:
    """Texte du corpus pour ce que dit l'audio, ou None si la source annonce autre chose.

    Tanzil concatène la basmala au verset 1 des sourates (sauf 1 et 9) ; Tadabur l'inclut ou non
    selon l'enregistrement : on suit la source, comparée après normalisation (lettres seules)."""
    words = simple_words
    source = normalize_arabic(source_text)
    if ref.ayah == 1 and ref.surah != 1 and verse_one_includes_basmala(ref.surah):
        basmala = normalize_arabic(" ".join(words[:BASMALA_WORD_COUNT]))
        if not source.startswith(basmala + " ") and source != basmala:
            words = words[BASMALA_WORD_COUNT:]
    if normalize_arabic(" ".join(words)) != source:
        return None
    return " ".join(words)


# --- Découpage ----------------------------------------------------------------------------------


def speaker_split(speaker: str, config: FinetuneConfig) -> str:
    """Jeu d'un locuteur : hachage salé, uniforme, indépendant de l'ordre de lecture."""
    digest = hashlib.sha256(f"{config.split_seed}|{speaker}".encode()).digest()
    draw = int.from_bytes(digest[:8], "big") / 2**64
    return config.val_split if draw < config.val_ratio else config.train_split


# --- Parole non coranique -----------------------------------------------------------------------


def corpus_alphabet(texts: Iterable[str]) -> frozenset[str]:
    """Caractères du corpus (lettres et voyelles de la graphie cible), espaces exclus."""
    return frozenset(char for text in texts for char in text if not char.isspace())


def _is_separator(char: str) -> bool:
    """Ponctuation, symbole ou espace : remplacé par un espace (« ، » « ؟ » « . » « " »)."""
    return unicodedata.category(char)[0] in "PSZ" or char.isspace()


def clean_non_quran_text(text: str, alphabet: frozenset[str]) -> str | None:
    """Texte nettoyé de sa ponctuation ; None s'il reste un caractère hors alphabet (chiffre,
    lettre étrangère) : le lire à voix haute demanderait une verbalisation qu'on n'invente pas."""
    spaced = "".join(" " if _is_separator(c) else c for c in unicodedata.normalize("NFC", text))
    cleaned = " ".join(spaced.split())
    if any(char not in alphabet for char in cleaned.replace(" ", "")):
        return None
    return cleaned


class QuranNgramIndex:
    """Passages du Coran : N mots consécutifs normalisés d'un verset, ou un verset entier court."""

    def __init__(self, verses: Iterable[tuple[str, ...]], n: int) -> None:
        self._n = n
        self._grams: set[tuple[str, ...]] = set()
        self._short: set[tuple[str, ...]] = set()
        for words in verses:
            tokens = tuple(tokenize(" ".join(words)))
            if len(tokens) < n:
                self._short.add(tokens)
            self._grams.update(tokens[i : i + n] for i in range(len(tokens) - n + 1))

    def contains_quran(self, text: str) -> bool:
        tokens = tuple(tokenize(text))
        if len(tokens) < self._n:
            return tokens in self._short
        grams = (tokens[i : i + self._n] for i in range(len(tokens) - self._n + 1))
        return any(gram in self._grams for gram in grams)


def safe_name(identifier: str) -> str:
    """Nom de fichier sûr tiré d'un identifiant de la source : jamais de séparateur ni de « .. »
    (un nom venu des données ne doit pas sortir du dossier audio)."""
    return _UNSAFE_CHARS.sub("_", identifier).strip(".") or "_"


# --- Unités -------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Utterance:
    """Un exemple lu dans une source, avant tri."""

    speaker: str
    utt_id: str
    text: str
    """Texte annoncé par la source (vérifié pour le Coran, nettoyé sinon)."""
    ref: VerseRef | None
    """Verset annoncé (récitation) ; None pour la parole non coranique ou une référence invalide."""
    split: str | None
    """Jeu imposé par le découpage officiel de la source ; None = tirage par locuteur."""
    audio: bytes
    declared_duration: float | None = None
    """Durée annoncée par la source : sert à compter ce qui est écarté sans décoder."""


class DecodedAudio(Protocol):
    duration: float

    def save(self, path: Path) -> None: ...


Decoder = Callable[[bytes], DecodedAudio]


@dataclass(frozen=True)
class BuildContext:
    spec: DatasetSpec
    config: FinetuneConfig
    simple_words: Mapping[VerseRef, tuple[str, ...]]
    alphabet: frozenset[str]
    quran_index: QuranNgramIndex
    excluded: Mapping[str, ExcludedVoice]
    """Locuteur → raison de l'exclusion."""
    audio_root: Path
    manifest_dir: Path
    """Dossier des manifestes de la source : les chemins audio y sont relatifs (NeMo les résout
    depuis le manifeste), donc valables sous Windows comme sous WSL ou Linux."""


@dataclass(frozen=True)
class ManifestEntry:
    audio_filepath: str
    duration: float
    text: str
    source: str
    speaker: str
    ref: str | None

    def to_json(self) -> str:
        # Clés NeMo (`audio_filepath`, `duration`, `text`) + traçabilité préfixée `aqr_`, ignorée
        # par le chargeur de manifeste de NeMo.
        return json.dumps(
            {
                "audio_filepath": self.audio_filepath,
                "duration": self.duration,
                "text": self.text,
                "aqr_source": self.source,
                "aqr_speaker": self.speaker,
                "aqr_ref": self.ref,
            },
            ensure_ascii=False,
        )


@dataclass
class Tally:
    count: int = 0
    seconds: float = 0.0
    speakers: set[str] = field(default_factory=set)
    undeclared: int = 0
    """Exemples écartés sans durée connue (la source ne l'annonce pas et on ne décode pas)."""

    def add(self, seconds: float | None, speaker: str | None = None) -> None:
        self.count += 1
        if seconds is None:
            self.undeclared += 1
        else:
            self.seconds += seconds
        if speaker is not None:
            self.speakers.add(speaker)


@dataclass
class PartReport:
    kept: dict[str, Tally] = field(default_factory=dict)
    rejected: dict[Rejection, Tally] = field(default_factory=dict)
    excluded_voices: dict[str, float] = field(default_factory=dict)
    """Locuteur exclu → secondes annoncées écartées."""

    def keep(self, split: str, seconds: float, speaker: str) -> None:
        self.kept.setdefault(split, Tally()).add(seconds, speaker)

    def reject(self, reason: Rejection, utt: Utterance) -> None:
        self.rejected.setdefault(reason, Tally()).add(utt.declared_duration)
        if reason is Rejection.EXCLUDED_VOICE:
            seconds = self.excluded_voices.get(utt.speaker, 0.0)
            self.excluded_voices[utt.speaker] = seconds + (utt.declared_duration or 0.0)

    def to_json(self) -> dict[str, Any]:
        return {
            "kept": {
                k: {"count": t.count, "seconds": t.seconds, "speakers": sorted(t.speakers)}
                for k, t in sorted(self.kept.items())
            },
            "rejected": {
                k.value: {"count": t.count, "seconds": t.seconds, "undeclared": t.undeclared}
                for k, t in sorted(self.rejected.items())
            },
            "excluded_voices": dict(sorted(self.excluded_voices.items())),
        }


@dataclass
class Part:
    entries: dict[str, list[ManifestEntry]] = field(default_factory=dict)
    report: PartReport = field(default_factory=PartReport)


def _target_text(utt: Utterance, ctx: BuildContext) -> str | Rejection:
    if ctx.spec.quran:
        if utt.ref is None or utt.ref not in ctx.simple_words:
            return Rejection.BAD_REF
        text = quran_target_text(utt.ref, ctx.simple_words[utt.ref], utt.text)
        return Rejection.TEXT_MISMATCH if text is None else text
    cleaned = clean_non_quran_text(utt.text, ctx.alphabet)
    if cleaned is None:
        return Rejection.ALPHABET
    if not cleaned:
        return Rejection.EMPTY
    if ctx.quran_index.contains_quran(cleaned):
        return Rejection.CONTAINS_QURAN
    return cleaned


def process_utterances(utts: Iterable[Utterance], ctx: BuildContext, decode: Decoder) -> Part:
    """Trie les exemples d'une unité ; n'écrit l'audio que des exemples retenus."""
    part = Part()
    config = ctx.config
    for utt in utts:
        if utt.speaker in ctx.excluded:
            part.report.reject(Rejection.EXCLUDED_VOICE, utt)
            continue
        text = _target_text(utt, ctx)
        if isinstance(text, Rejection):
            part.report.reject(text, utt)
            continue
        try:
            audio = decode(utt.audio)
        except ValueError:
            part.report.reject(Rejection.UNREADABLE, utt)
            continue
        if not config.min_duration_s <= audio.duration <= config.max_duration_s:
            part.report.reject(Rejection.DURATION, utt)
            continue
        path = (
            ctx.audio_root / ctx.spec.key / safe_name(utt.speaker) / f"{safe_name(utt.utt_id)}.wav"
        )
        audio.save(path)
        relative = Path(os.path.relpath(path, ctx.manifest_dir)).as_posix()
        split = utt.split or speaker_split(utt.speaker, config)
        part.entries.setdefault(split, []).append(
            ManifestEntry(
                audio_filepath=relative,
                duration=round(audio.duration, 3),
                text=text,
                source=ctx.spec.key,
                speaker=utt.speaker,
                ref=str(utt.ref) if utt.ref is not None else None,
            )
        )
        part.report.keep(split, audio.duration, utt.speaker)
    return part


# --- Parts et manifestes ------------------------------------------------------------------------

_REPORT_SUFFIX = ".report.json"


def _write_atomic(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def part_done(parts_dir: Path, name: str) -> bool:
    """Une part est complète quand son rapport existe (écrit en dernier)."""
    return (parts_dir / f"{name}{_REPORT_SUFFIX}").exists()


def write_part(parts_dir: Path, name: str, part: Part) -> None:
    """JSONL par jeu d'abord, rapport ensuite : un rapport présent garantit des JSONL complets."""
    for split, entries in sorted(part.entries.items()):
        _write_atomic(
            parts_dir / f"{name}.{split}.jsonl", "".join(e.to_json() + "\n" for e in entries)
        )
    _write_atomic(
        parts_dir / f"{name}{_REPORT_SUFFIX}",
        json.dumps(part.report.to_json(), ensure_ascii=False, indent=2) + "\n",
    )


def _hours(seconds: float) -> float:
    return round(seconds / _SECONDS_PER_HOUR, _REPORT_PRECISION)


def merge_parts(manifest_dir: Path, config: FinetuneConfig) -> dict[str, Any]:
    """Fusionne les parts de `manifest_dir/parts` en `train.jsonl`, `val.jsonl` et `report.json`."""
    parts_dir = manifest_dir / "parts"
    reports = sorted(parts_dir.glob(f"*{_REPORT_SUFFIX}")) if parts_dir.is_dir() else []
    if not reports:
        raise FileNotFoundError(f"aucune part construite dans {parts_dir}")
    names = [p.name.removesuffix(_REPORT_SUFFIX) for p in reports]
    kept: dict[str, Tally] = {}
    rejected: dict[str, Tally] = {}
    excluded: dict[str, float] = {}
    for report_path in reports:
        data = json.loads(report_path.read_text(encoding="utf-8"))
        for split, t in data["kept"].items():
            tally = kept.setdefault(split, Tally())
            tally.count += t["count"]
            tally.seconds += t["seconds"]
            tally.speakers.update(t["speakers"])
        for reason, t in data["rejected"].items():
            tally = rejected.setdefault(reason, Tally())
            tally.count += t["count"]
            tally.seconds += t["seconds"]
            tally.undeclared += t["undeclared"]
        for speaker, seconds in data["excluded_voices"].items():
            excluded[speaker] = excluded.get(speaker, 0.0) + seconds
    for split in (config.train_split, config.val_split):
        lines = [
            (parts_dir / f"{name}.{split}.jsonl").read_text(encoding="utf-8")
            for name in names
            if (parts_dir / f"{name}.{split}.jsonl").exists()
        ]
        _write_atomic(manifest_dir / f"{split}.jsonl", "".join(lines))
    summary: dict[str, Any] = {
        "parts": names,
        "kept": {
            split: {"count": t.count, "hours": _hours(t.seconds), "speakers": len(t.speakers)}
            for split, t in sorted(kept.items())
        },
        "rejected": {
            reason: {
                "count": t.count,
                "hours": _hours(t.seconds),
                "without_duration": t.undeclared,
            }
            for reason, t in sorted(rejected.items())
        },
        "excluded_voices_hours": {s: _hours(v) for s, v in sorted(excluded.items())},
    }
    train_speakers = kept.get(config.train_split, Tally()).speakers
    val_speakers = kept.get(config.val_split, Tally()).speakers
    if train_speakers & val_speakers:
        raise ValueError(f"locuteurs des deux côtés : {sorted(train_speakers & val_speakers)[:5]}")
    _write_atomic(
        manifest_dir / "report.json", json.dumps(summary, ensure_ascii=False, indent=2) + "\n"
    )
    return summary
