"""`aqr free-speech RÉSULTAT AUDIO` : transcrit et traduit les paroles arabes hors Coran (ADR-0027).

Lit un résultat `aqr.recognition/1`, ne touche qu'aux zones `arabic_speech`, écrit à côté un fichier
`<nom>.free-speech.json` (`aqr.free-speech/1`). Le résultat de reconnaissance n'est jamais modifié.
Codes : 0 succès · 1 erreur sur les données · 2 moteur ou modèle indisponible.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable, Mapping
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import TextIO

from aqr.domain.ports import AudioClip
from aqr.freespeech.config import FreeSpeechConfig
from aqr.freespeech.guard import CorpusGuard
from aqr.freespeech.ports import FrenchTranslator, SpeechTranscriber
from aqr.freespeech.service import eligible_intervals, run_free_speech
from aqr.freespeech.sidecar import build_document, validate_document


class FreeSpeechUnavailable(RuntimeError):
    """Moteur ou modèle absent (message en français, code de sortie 2)."""


@dataclass(frozen=True)
class FreeSpeechOptions:
    models_dir: Path | None = None
    corpus_dir: Path = Path("data/corpus")
    device: str = "auto"
    whisper_model: str = "large-v3"


@dataclass(frozen=True)
class FreeSpeechEngine:
    transcriber: SpeechTranscriber
    translator: FrenchTranslator
    guard: CorpusGuard
    extract: Callable[[Path], AudioClip]
    transcriber_name: str
    translator_name: str


FreeSpeechFactory = Callable[[FreeSpeechOptions, Mapping[str, str]], FreeSpeechEngine]


def build_engine(options: FreeSpeechOptions, env: Mapping[str, str]) -> FreeSpeechEngine:
    from aqr.adapters.ffmpeg_extractor import FfmpegAudioExtractor
    from aqr.adapters.free_whisper import FreeWhisperConfig, FreeWhisperTranscriber
    from aqr.adapters.marian_translator import DEFAULT_MODEL_NAME, MarianConfig, MarianTranslator
    from aqr.corpus.imlai_corrections import build_word_corrections, load_simple_clean_words
    from aqr.corpus.normalize import normalize_arabic, tokenize
    from aqr.corpus.tanzil_repository import TanzilCorpusRepository
    from aqr.matching.flow_matcher import FlowVerseMatcher

    models = options.models_dir or (
        Path(env["AQR_MODELS_DIR"]) if env.get("AQR_MODELS_DIR") else None
    )
    if models is None:
        raise FreeSpeechUnavailable(
            "Variable d'environnement manquante : AQR_MODELS_DIR (ou --models-dir)"
        )
    translator_dir = models / DEFAULT_MODEL_NAME
    if not translator_dir.is_dir():
        raise FreeSpeechUnavailable(
            f"modèle de traduction absent ({translator_dir}) : "
            "`python scripts/fetch_free_speech_models.py`"
        )
    config = FreeSpeechConfig()
    corpus = TanzilCorpusRepository(options.corpus_dir)
    corrections = build_word_corrections(corpus, load_simple_clean_words(options.corpus_dir))
    matcher = FlowVerseMatcher(corpus, word_corrections=corrections)
    verses = [tokenize(normalize_arabic(corpus.text(ref))) for ref in corpus.all_refs()]
    transcriber = FreeWhisperTranscriber(
        FreeWhisperConfig(model=options.whisper_model, device=options.device)
    )
    translator = MarianTranslator(MarianConfig(translator_dir, device=options.device))
    return FreeSpeechEngine(
        transcriber=transcriber,
        translator=translator,
        guard=CorpusGuard(verses, config, matcher=matcher, word_corrections=corrections),
        extract=FfmpegAudioExtractor().extract,
        transcriber_name=transcriber.engine,
        translator_name=translator.engine,
    )


def _stem(recognition: Path) -> str:
    return recognition.name.removesuffix(".recognition.json").removesuffix(".json")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def run_command(
    recognition: Path,
    audio: Path,
    out_dir: Path,
    options: FreeSpeechOptions,
    env: Mapping[str, str],
    out: TextIO,
    err: TextIO,
    factory: FreeSpeechFactory = build_engine,
    force: bool = False,
) -> int:
    for path in (recognition, audio):
        if not path.is_file():
            print(f"ERREUR fichier introuvable : {path}", file=err)
            return 1
    target = out_dir / f"{_stem(recognition)}.free-speech.json"
    if target.exists() and not force:
        print(f"ERREUR sortie déjà présente : {target} (--force pour écraser)", file=err)
        return 1
    try:
        document = json.loads(recognition.read_text(encoding="utf-8"))
        intervals = document["intervals"]
        if not isinstance(intervals, list):
            raise TypeError("intervals")
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print(f"ERREUR résultat de reconnaissance illisible : {recognition} ({exc})", file=err)
        return 1
    if not eligible_intervals(intervals):
        print("aucune parole arabe hors Coran dans ce résultat : rien à faire", file=out)
        return 0
    try:
        engine = factory(options, env)
        clip = engine.extract(audio)
        config = FreeSpeechConfig()
        items = run_free_speech(
            intervals, clip, engine.transcriber, engine.translator, engine.guard, config
        )
    except FreeSpeechUnavailable as exc:
        print(str(exc), file=err)
        return 2
    except (OSError, ValueError, RuntimeError) as exc:
        print(f"ERREUR {exc}", file=err)
        return 1
    result = build_document(
        items,
        transcriber=engine.transcriber_name,
        translator=engine.translator_name,
        recognition_sha256=_sha256(recognition),
        thresholds=asdict(config),
    )
    validate_document(result)
    out_dir.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(result, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    translated = sum(1 for i in items if i.status == "translated")
    print(
        f"{len(items)} passage(s) arabe(s) hors Coran · {translated} traduit(s) · "
        f"{len(items) - translated} retenu(s)",
        file=out,
    )
    print(f"écrit : {target}", file=out)
    return 0
