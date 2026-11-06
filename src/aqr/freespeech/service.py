"""Parole libre : choisit les passages éligibles, transcrit, contrôle, traduit (ADR-0027).

Éligible : une zone `non_quran` d'étiquette `arabic_speech`, ou une abstention `no_candidate`
(aucun verset ne ressemble au passage : le moteur n'émet pas encore de zone `arabic_speech`, la
parole arabe hors Coran se trouve là). Les formules connues ont leur texte fixe ; le français, les
autres langues, le silence et le bruit n'ont rien à traduire ; une abstention `below_threshold`, un
transcript vide ou un verset incertain reste tel quel, sans transcription ni traduction. À chaque
doute, le passage est retenu sans aucun texte (I3).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from aqr.corpus.normalize import normalize_arabic
from aqr.domain.models import NonQuranKind, TimeSpan
from aqr.domain.ports import AudioClip
from aqr.freespeech.checks import (
    arabic_letter_share,
    plausible_length,
    repeat_share,
    roundtrip_similarity,
    words_of,
)
from aqr.freespeech.config import FreeSpeechConfig
from aqr.freespeech.glossary import glossary_translation
from aqr.freespeech.guard import CorpusGuard
from aqr.freespeech.ports import BackTranslator, FrenchTranslator, SpeechTranscriber
from aqr.freespeech.sidecar import FreeSpeechItem
from aqr.pipeline.formulae import FormulaConfig, classify_formula

ELIGIBLE_LABEL = NonQuranKind.ARABIC_SPEECH.value
SILENCE_RMS = 1e-4


def _is_candidate(interval: Mapping[str, Any], config: FreeSpeechConfig) -> bool:
    if interval.get("kind") == "non_quran":
        return interval.get("label") == ELIGIBLE_LABEL
    return (
        interval.get("kind") == "abstention" and interval.get("reason") in config.abstention_reasons
    )


def eligible_intervals(
    intervals: Sequence[Mapping[str, Any]], config: FreeSpeechConfig | None = None
) -> list[tuple[int, TimeSpan]]:
    config = config or FreeSpeechConfig()
    out: list[tuple[int, TimeSpan]] = []
    for index, interval in enumerate(intervals):
        t = interval.get("t")
        if not _is_candidate(interval, config):
            continue
        if not (isinstance(t, list) and len(t) == 2 and t[1] > t[0] >= 0):
            continue
        out.append((index, TimeSpan(float(t[0]), float(t[1]))))
    return out


def _held(index: int, span: TimeSpan, reason: str) -> FreeSpeechItem:
    return FreeSpeechItem(index, (span.start_s, span.end_s), "withheld", reason)


def _rms(clip: AudioClip, span: TimeSpan) -> float:
    first = int(span.start_s * clip.sample_rate)
    last = min(len(clip.samples), int(span.end_s * clip.sample_rate))
    chunk = clip.samples[first:last]
    if not len(chunk):
        return 0.0
    return float((sum(x * x for x in chunk) / len(chunk)) ** 0.5)


def process_interval(
    index: int,
    span: TimeSpan,
    clip: AudioClip,
    transcriber: SpeechTranscriber,
    translator: FrenchTranslator,
    guard: CorpusGuard,
    config: FreeSpeechConfig,
    back: BackTranslator | None = None,
) -> FreeSpeechItem:
    if span.end_s - span.start_s < config.min_duration_s:
        return _held(index, span, "too_short")
    if _rms(clip, span) < SILENCE_RMS:
        return _held(index, span, "silent")
    heard = transcriber.transcribe(clip, span)
    if heard.language != "ar" or heard.language_prob < config.min_language_prob:
        return _held(index, span, "language")
    if arabic_letter_share(heard.text) < config.min_arabic_letters:
        return _held(index, span, "language")
    words = words_of(normalize_arabic(heard.text))
    if len(words) < config.min_words:
        return _held(index, span, "too_few_words")
    if heard.confidence < config.min_confidence:
        return _held(index, span, "low_confidence")
    if repeat_share(words) > config.max_repeat_share:
        return _held(index, span, "hallucination")
    if guard.check(words).quranic:
        return _held(index, span, "quran_like")
    if classify_formula(words, (), FormulaConfig()) is not None:
        return _held(index, span, "known_formula")
    fixed = glossary_translation(words)
    french = fixed or translator.translate(heard.text).text.strip()
    if not french:
        return _held(index, span, "no_translation")
    if not fixed:
        if not plausible_length(heard.text, french, config.ratio_low, config.ratio_high):
            return _held(index, span, "translation_implausible")
        if back is not None and (
            roundtrip_similarity(heard.text, back.translate_back(french)) < config.min_roundtrip
        ):
            return _held(index, span, "translation_unreliable")
    return FreeSpeechItem(
        index,
        (span.start_s, span.end_s),
        "translated",
        transcript_ar=heard.text.strip(),
        translation_fr=french,
        confidence=heard.confidence,
        language=heard.language,
        review="pending",
        translation_source="glossary" if fixed else "model",
    )


def run_free_speech(
    intervals: Sequence[Mapping[str, Any]],
    clip: AudioClip,
    transcriber: SpeechTranscriber,
    translator: FrenchTranslator,
    guard: CorpusGuard,
    config: FreeSpeechConfig,
    back: BackTranslator | None = None,
) -> list[FreeSpeechItem]:
    return [
        process_interval(index, span, clip, transcriber, translator, guard, config, back)
        for index, span in eligible_intervals(intervals, config)
    ]
