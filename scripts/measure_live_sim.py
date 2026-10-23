#!/usr/bin/env python3
"""Banc de simulation du suivi en direct (ADR-0011, étape 1) : rejoue des audios comme un flux.

Trois étapes, reprenables (tout est mis en cache dans `--work-dir`, hors dépôt) :

  build   fabrique les entrées : montages EveryAyah (vérité calculée), mixages `make_mix` avec
          parole non coranique extraite des lots réels, extraits de lots réels (référence = la
          sortie du moteur par lots, qui N'EST PAS une vérité terrain) ;
  asr     fait passer le modèle streaming (Muno, ONNX CPU) sur chaque entrée, garde les mots ;
  report  rejoue les mots dans `HypothesisTracker` et mesure : temps jusqu'au premier CANDIDATES,
          à la liste courte, au LOCKED ; faux verrous (cible 0, I3) ; JUMP/LOST ; balayage de la
          configuration.

    python scripts/measure_live_sim.py --stage build,asr,report --work-dir D:/.../live

Aucun réseau, aucun modèle ajouté. Variables : AQR_AUDIO_DIR, AQR_MODELS_DIR.
"""

from __future__ import annotations

import argparse
import itertools
import json
import os
import random
import subprocess
import sys
import time
from array import array
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if (ROOT / "src").is_dir() and str(ROOT / "src") not in sys.path:
    sys.path.insert(0, str(ROOT / "src"))

from aqr.data.mixer import (  # noqa: E402
    DiskClipProvider,
    Mix,
    MixConfig,
    generate_mixes,
    read_wav,
    write_wav,
)
from aqr.domain.models import NonQuranKind, Status, VerseRef  # noqa: E402
from aqr.domain.quran_structure import ayah_count  # noqa: E402
from aqr.live.config import LiveConfig  # noqa: E402
from aqr.live.replay import ArrivalModel, restore_stream_times  # noqa: E402
from aqr.live.scenarios import (  # noqa: E402
    Piece,
    layout,
    load_words,
    save_words,
    scenario_from_words,
    speech_bounds,
)
from aqr.live.simulation import (  # noqa: E402
    Scenario,
    ScenarioResult,
    TruthVerse,
    TruthZone,
    distribution,
    evaluate,
    run_stream,
    summarize,
)

SAMPLE_RATE = 16000
RECITERS = ("Alafasy_128kbps", "Husary_128kbps", "Abdul_Basit_Murattal_192kbps")
SEQUENCE_SURAHS = (1, 67, 97, 103, 108, 109, 110, 112, 113, 114)
GAP_RANGE_S = (0.3, 0.8)
LEAD_S, TAIL_S = 0.5, 1.5

# Extraits de lots réels (identifiant du manifeste, début, durée) : récitations puis parole.
REAL_RECITATIONS = (
    ("lot2-02", 0.0, 600.0),
    ("lot2-03", 0.0, 600.0),
    ("lot1-05", 0.0, 600.0),
    ("lot2-05", 0.0, 600.0),
    ("lot1-06", 0.0, 600.0),
)
REAL_SPEECH = (
    ("lot1-09", 0.0, 900.0),
    ("lot2-11", 0.0, 900.0),
    ("lot2-12", 0.0, 900.0),
    ("lot1-03", 0.0, 900.0),
)
SPEECH_SOURCES = (("french", "lot1-09"), ("arabic_speech", "lot2-12"))
SPECIAL_SOURCES = (
    (NonQuranKind.ISTIADHA, "lot1-04"),
    (NonQuranKind.TAKBIR, "lot1-06"),
    (NonQuranKind.AMIN, "lot1-03"),
)
MIXSRC = "mixsrc-dev"
"""Sources des mixages et des montages (dossier du travail) : uniquement des lots du split dev."""
MANIFEST = ROOT / "tests" / "fixtures" / "audio" / "manifest.yaml"
LOT_FOLDERS = {"C01": "C01", "C08": "C08", "C09": "C09", "C10": "C10"}


# --------------------------------------------------------------------------- plans de montage
@dataclass(frozen=True)
class Step:
    kind: str  # verse | basmala
    ref: VerseRef | None = None


def verses(surah: int, first: int = 1, last: int | None = None) -> list[Step]:
    stop = last if last is not None else ayah_count(surah)
    return [Step("verse", VerseRef(surah, a)) for a in range(first, stop + 1)]


def recipes() -> dict[str, list[Step]]:
    """Montages d'EveryAyah : un nom -> les étapes dites dans l'ordre. Les récitants sont ajoutés
    à l'identifiant. Chaque montage éprouve une situation du suivi (ADR-0011 §2, §4)."""
    basmala = [Step("basmala")]
    plans: dict[str, list[Step]] = {}
    for surah in SEQUENCE_SURAHS:
        if surah == 1:
            plans["full-1"] = [Step("basmala"), *verses(1, 2)]  # 1:1 est la basmala
        else:
            plans[f"full-{surah}"] = verses(surah)
    for surah in (109, 112, 113, 114):
        plans[f"basmala-{surah}"] = [*basmala, *verses(surah)]
    plans["mid-67"] = verses(67, 10)
    plans["jump-surah"] = [*verses(112), *basmala, *verses(114)]
    plans["jump-back"] = [*verses(113, 1, 3), *verses(113, 1, 2)]
    plans["jump-skip"] = [*verses(112, 1, 1), *verses(112, 3, 4)]
    plans["repeat"] = [*verses(112, 1, 2), *verses(112, 2, 2), *verses(112, 3, 4)]
    plans["short-start"] = verses(108)  # 3 versets de 3 à 4 mots
    return plans


def sequence_pieces(
    steps: Sequence[Step],
    provider: DiskClipProvider,
    reciter: str,
    rng: random.Random,
) -> tuple[list[Piece], array[int]]:
    """Montage audio (silences aléatoires entre les pièces) et pièces de vérité correspondantes."""
    samples: array[int] = array("h")
    pieces: list[Piece] = []

    def silence(seconds: float) -> None:
        pieces.append(Piece.gap(seconds))
        samples.extend([0] * round(seconds * SAMPLE_RATE))

    def clip(piece_for: Any, data: array[int]) -> None:
        duration = len(data) / SAMPLE_RATE
        bounds = speech_bounds(data, SAMPLE_RATE)
        pieces.append(piece_for(duration, bounds))
        samples.extend(data)

    silence(LEAD_S)
    for number, step in enumerate(steps):
        if number:
            silence(rng.uniform(*GAP_RANGE_S))
        if step.kind == "basmala":
            # 1:1 est la basmala : le même clip existe pour tous les récitants (bismillah.mp3, non)
            clip(lambda d, b: Piece.zone("basmala", d, b), provider.verse(reciter, VerseRef(1, 1)))
        else:
            assert step.ref is not None
            ref = step.ref
            clip(lambda d, b, r=ref: Piece.verse(r, d, b), provider.verse(reciter, ref))
    silence(TAIL_S)
    return pieces, samples


# --------------------------------------------------------------------------- mixages
def mix_truth(
    mix: Mix, bismillah_s: float, corpus_basmala_surahs: Iterable[int] = ()
) -> tuple[list[TruthVerse], list[TruthZone]]:
    """Vérité d'un mixage `make_mix` : versets récités, zones non coraniques. Un verset 1 dit
    avec sa basmala (`words: all`) commence après elle (`bismillah_s`) ; un verset brouillé est
    du bruit."""
    verses_out: list[TruthVerse] = []
    zones: list[TruthZone] = []
    for item in mix.expected:
        start, end = item.t
        if item.status is Status.INFERRED:
            zones.append(TruthZone(start, end, "noise"))
            continue
        has_basmala = item.ref.ayah == 1 and item.ref.surah not in (1, 9)
        if has_basmala and item.words.is_all:
            zones.append(TruthZone(start, start + bismillah_s, "basmala"))
            start += bismillah_s
        verses_out.append(TruthVerse(item.ref, start, end))
    for other in mix.non_quran:
        zones.append(TruthZone(other.t[0], other.t[1], other.kind.value))
    return sorted(verses_out, key=lambda v: v.start_s), sorted(zones, key=lambda z: z.start_s)


# --------------------------------------------------------------------------- entrées
def inputs_dir(work: Path) -> Path:
    return work / "inputs"


def write_input(work: Path, entry: dict[str, Any]) -> None:
    inputs_dir(work).mkdir(parents=True, exist_ok=True)
    (inputs_dir(work) / f"{entry['id']}.json").write_text(
        json.dumps(entry, ensure_ascii=False, indent=1), encoding="utf-8"
    )


def truth_json(verses_: Sequence[TruthVerse], zones: Sequence[TruthZone]) -> dict[str, Any]:
    return {
        "verses": [[str(v.ref), round(v.start_s, 3), round(v.end_s, 3)] for v in verses_],
        "zones": [[round(z.start_s, 3), round(z.end_s, 3), z.kind] for z in zones],
    }


def build_sequences(work: Path, audio_dir: Path) -> int:
    provider = DiskClipProvider(work / MIXSRC, sample_rate=SAMPLE_RATE)
    count = 0
    for reciter in RECITERS:
        for name, steps in recipes().items():
            entry_id = f"seq-{name}-{reciter.split('_')[0].lower()}"
            rng = random.Random(entry_id)
            pieces, samples = sequence_pieces(steps, provider, reciter, rng)
            wav = work / "audio" / f"{entry_id}.wav"
            write_wav(wav, samples, SAMPLE_RATE)
            verses_, zones, total = layout(pieces)
            write_input(
                work,
                {
                    "id": entry_id,
                    "kind": "sequence",
                    "audio": str(wav),
                    "duration_s": round(total, 3),
                    "reciter": reciter,
                    "truth": truth_json(verses_, zones),
                },
            )
            count += 1
    return count


def ffmpeg_cut(source: Path, start_s: float, duration_s: float, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-loglevel",
            "error",
            "-ss",
            str(start_s),
            "-t",
            str(duration_s),
            "-i",
            str(source),
            "-ac",
            "1",
            "-ar",
            str(SAMPLE_RATE),
            str(target),
        ],
        check=True,
    )


def dev_lots() -> set[str]:
    """Lots du split `dev` du manifeste : seuls autorisés pour régler et mesurer (le split `test`
    reste vierge, docs/TEST-CORPUS.md)."""
    import yaml

    cases = yaml.safe_load(MANIFEST.read_text(encoding="utf-8"))["cases"]
    return {case["id"] for case in cases if case.get("split") == "dev"}


def check_dev_only(lots: Iterable[str]) -> None:
    forbidden = sorted(set(lots) - dev_lots())
    if forbidden:
        raise SystemExit(f"lots hors du split dev, refusés : {', '.join(forbidden)}")


def used_lots() -> list[str]:
    return sorted(
        {lot for lot, _start, _duration in (*REAL_RECITATIONS, *REAL_SPEECH)}
        | {lot for _kind, lot in SPEECH_SOURCES}
        | {lot for _kind, lot in SPECIAL_SOURCES}
    )


def lot_source(audio_dir: Path, lot: str) -> Path:
    for folder in LOT_FOLDERS.values():
        candidate = audio_dir / folder / f"{lot}.mp3"
        if candidate.exists():
            return candidate
    raise FileNotFoundError(lot)


def batch_output(batch_dir: Path, lot: str) -> Path | None:
    for candidate in (
        batch_dir / f"{lot}.recognition.json",
        batch_dir / "lot-2" / f"{lot}.recognition.json",
    ):
        if candidate.exists():
            return candidate
    return None


def batch_intervals(path: Path, start_s: float, duration_s: float) -> dict[str, Any]:
    """Versets (reconnus ou inférés) de la sortie par lots dans la fenêtre : une RÉFÉRENCE, pas
    une vérité terrain."""
    document = json.loads(path.read_text(encoding="utf-8"))
    kept = []
    for interval in document["intervals"]:
        if interval.get("kind") != "verse" or interval.get("status") not in (
            "recognized",
            "inferred",
        ):
            continue
        a, b = interval["t"]
        if a >= start_s and b <= start_s + duration_s:
            kept.append([interval["ref"], round(a - start_s, 3), round(b - start_s, 3)])
    return {"verses": kept, "zones": []}


def build_real(work: Path, audio_dir: Path, batch_dir: Path) -> int:
    count = 0
    for group, lots in (("real-recitation", REAL_RECITATIONS), ("real-speech", REAL_SPEECH)):
        for lot, start, duration in lots:
            output = batch_output(batch_dir, lot)
            if output is None:
                print(f"écarté {lot} : pas de sortie par lots", file=sys.stderr)
                continue
            wav = work / "audio" / f"{lot}.wav"
            if not wav.exists():
                ffmpeg_cut(lot_source(audio_dir, lot), start, duration, wav)
            write_input(
                work,
                {
                    "id": f"{group}-{lot}",
                    "kind": group,
                    "audio": str(wav),
                    "duration_s": duration,
                    "truth": batch_intervals(output, start, duration),
                    "truth_is_reference_only": True,
                },
            )
            count += 1
    return count


def prepare_mix_sources(work: Path, audio_dir: Path, batch_dir: Path) -> list[str]:
    """Dossier de sources pour `generate_mixes` : EveryAyah (jonction), isti'adha/takbir/amin et
    parole non coranique extraits des lots réels là où la sortie par lots les a étiquetés. Les
    étiquettes ne sont PAS vérifiées à l'oreille : c'est écrit dans le rapport."""
    source = work / MIXSRC
    source.mkdir(parents=True, exist_ok=True)
    link = source / "everyayah"
    if not link.exists():
        subprocess.run(
            ["cmd", "/c", "mklink", "/J", str(link), str(audio_dir / "everyayah")],
            check=True,
            capture_output=True,
        )
    notes: list[str] = []
    for kind, lot in SPECIAL_SOURCES:
        target = source / "specials" / f"{kind.value}.wav"
        if target.exists():
            continue
        output = batch_output(batch_dir, lot)
        if output is None:
            continue
        document = json.loads(output.read_text(encoding="utf-8"))
        found = [
            i
            for i in document["intervals"]
            if i.get("kind") == "non_quran" and i.get("label", i.get("type")) == kind.value
        ]
        if not found:
            found = [
                i
                for i in document["intervals"]
                if i.get("kind") == "non_quran" and kind.value in json.dumps(i)
            ]
        if not found:
            notes.append(f"{kind.value}: aucun intervalle dans {lot}")
            continue
        a, b = found[0]["t"]
        ffmpeg_cut(lot_source(audio_dir, lot), max(0.0, a - 0.2), (b - a) + 0.4, target)
        notes.append(f"{kind.value}: {lot} {a:.1f}-{b:.1f} s (étiquette du moteur par lots)")
    for kind_name, lot in SPEECH_SOURCES:
        output = batch_output(batch_dir, lot)
        if output is None:
            continue
        document = json.loads(output.read_text(encoding="utf-8"))
        windows = quiet_windows(document["intervals"], 50.0, 45.0)
        for number, (a, b) in enumerate(windows[:3], start=1):
            target = source / "speech" / f"{kind_name}_{number:02d}.wav"
            if not target.exists():
                ffmpeg_cut(lot_source(audio_dir, lot), a, b - a, target)
            notes.append(
                f"{kind_name}_{number:02d}: {lot} {a:.0f}-{b:.0f} s "
                "(aucune détection du moteur par lots)"
            )
    return notes


def quiet_windows(
    intervals: Sequence[dict[str, Any]], length_s: float, spacing_s: float
) -> list[tuple[float, float]]:
    """Fenêtres de `length_s` sans verset ni formule dans la sortie par lots (parole présumée non
    coranique), séparées d'au moins `spacing_s`."""
    marks = sorted(
        (i["t"][0], i["t"][1]) for i in intervals if i.get("kind") in ("verse", "non_quran")
    )
    horizon = max((i["t"][1] for i in intervals), default=0.0)
    windows: list[tuple[float, float]] = []
    cursor = 120.0  # on saute l'ouverture du fichier
    while cursor + length_s < min(horizon, 3600.0):
        end = cursor + length_s
        if all(b < cursor or a > end for a, b in marks):
            windows.append((cursor, end))
            cursor = end + spacing_s
        else:
            cursor += 10.0
    return windows


class BismillahProvider(DiskClipProvider):
    """Seuls les récitants qui ont un `bismillah.mp3` servent aux mixages (EveryAyah n'en donne
    pas pour tous)."""

    def reciters(self) -> tuple[str, ...]:
        found = []
        for reciter in super().reciters():
            if (self._dir / "everyayah" / reciter / "bismillah.mp3").exists():
                found.append(reciter)
        return tuple(found)


def build_mixes(
    work: Path, audio_dir: Path, batch_dir: Path, corpus_dir: Path
) -> tuple[int, list[str]]:
    from aqr.corpus.tanzil_repository import TanzilCorpusRepository

    notes = prepare_mix_sources(work, audio_dir, batch_dir)
    provider = BismillahProvider(work / MIXSRC, sample_rate=SAMPLE_RATE)
    corpus = TanzilCorpusRepository(corpus_dir)
    report = generate_mixes(
        provider, corpus, seed=7, per_scenario=2, config=MixConfig(sample_rate=SAMPLE_RATE)
    )
    count = 0
    for mix in report.mixes:
        bismillah_s = len(provider.bismillah(mix.reciter)) / SAMPLE_RATE
        verses_, zones = mix_truth(mix, bismillah_s)
        wav = work / "audio" / f"{mix.id}.wav"
        write_wav(wav, mix.samples, SAMPLE_RATE)
        write_input(
            work,
            {
                "id": f"mix-{mix.id}",
                "kind": "mix",
                "scenario": mix.scenario,
                "audio": str(wav),
                "duration_s": round(len(mix.samples) / SAMPLE_RATE, 3),
                "boundaries": mix.boundaries,
                "truth": truth_json(verses_, zones),
            },
        )
        count += 1
    notes += [f"écarté {scenario} : {reason}" for scenario, reason in report.skipped]
    return count, notes


# --------------------------------------------------------------------------- ASR
def run_asr(work: Path, models_dir: Path) -> int:
    from aqr.adapters.muno_streaming import MunoStreamingConfig, MunoStreamingQuranASR
    from aqr.domain.models import TimeSpan
    from aqr.domain.ports import AudioClip

    asr = MunoStreamingQuranASR(
        MunoStreamingConfig(models_dir=models_dir, lock_path=ROOT / "models" / "LOCK.json")
    )
    out = work / "asr"
    out.mkdir(parents=True, exist_ok=True)
    done = 0
    for path in sorted(inputs_dir(work).glob("*.json")):
        entry = json.loads(path.read_text(encoding="utf-8"))
        target = out / f"{entry['id']}.words.json"
        if target.exists():
            continue
        data = read_wav(Path(entry["audio"]), SAMPLE_RATE)
        clip = AudioClip(
            samples=array("f", (x / 32768.0 for x in data)),
            sample_rate=SAMPLE_RATE,
            source=entry["id"],
        )
        started = time.time()
        transcript = asr.transcribe(clip, TimeSpan(0.0, len(data) / SAMPLE_RATE))
        elapsed = time.time() - started
        save_words(
            target, transcript.words, engine=transcript.engine, audio_s=len(data) / SAMPLE_RATE
        )
        print(
            f"asr {entry['id']}: {len(data) / SAMPLE_RATE:.0f} s d'audio, "
            f"{len(transcript.words)} mots, {elapsed:.0f} s de calcul "
            f"(x{elapsed / (len(data) / SAMPLE_RATE):.2f})",
            flush=True,
        )
        done += 1
    return done


# --------------------------------------------------------------------------- rapport
def load_scenarios(
    work: Path, skeleton: Any, model: ArrivalModel
) -> list[tuple[dict[str, Any], Scenario]]:
    scenarios = []
    for path in sorted(inputs_dir(work).glob("*.json")):
        entry = json.loads(path.read_text(encoding="utf-8"))
        words_path = work / "asr" / f"{entry['id']}.words.json"
        if not words_path.exists():
            continue
        raw_words, _engine, audio_s = load_words(words_path)
        words = restore_stream_times(raw_words)  # l'adaptateur Muno comprime son axe de 13/14
        truth = entry["truth"]
        scenarios.append(
            (
                entry,
                scenario_from_words(
                    entry["id"],
                    entry["kind"],
                    words,
                    skeleton,
                    model,
                    verses=[TruthVerse(VerseRef.parse(r), a, b) for r, a, b in truth["verses"]],
                    zones=[TruthZone(a, b, k) for a, b, k in truth["zones"]],
                    duration_s=audio_s,
                ),
            )
        )
    return scenarios


def evaluate_all(
    index: Any, config: LiveConfig, scenarios: Sequence[tuple[dict[str, Any], Scenario]]
) -> list[tuple[dict[str, Any], Scenario, list[Any], ScenarioResult]]:
    out = []
    for entry, scenario in scenarios:
        events = run_stream(index, config, scenario.words, scenario.duration_s)
        out.append((entry, scenario, events, evaluate(scenario, events, index)))
    return out


SWEEP_SPEECH_LIMIT_S = 300.0
"""Le balayage de la configuration ne rejoue que les 5 premières minutes de chaque parole réelle."""


def truncate(scenario: Scenario, limit_s: float) -> Scenario:
    """Le même scénario, limité aux `limit_s` premières secondes du flux."""
    return Scenario(
        id=scenario.id,
        source=scenario.source,
        words=tuple(w for w in scenario.words if w.arrival_s <= limit_s),
        duration_s=min(scenario.duration_s, limit_s),
        verses=tuple(v for v in scenario.verses if v.end_s <= limit_s),
        zones=tuple(z for z in scenario.zones if z.end_s <= limit_s),
    )


def group_name(entry: dict[str, Any]) -> str:
    if entry["kind"] == "sequence":
        parts = entry["id"].split("-")  # seq-<famille>[-<variante>]-<récitant>
        family = f"jump-{parts[2]}" if parts[1] == "jump" else parts[1]
        return f"sequence:{family}"
    if entry["kind"] == "mix":
        return "mix:" + str(entry.get("scenario"))
    return entry["kind"]


def sweep_grid() -> list[tuple[str, LiveConfig]]:
    """Deux balayages : le coeur (a priori, mots minimum, seuil) puis les garde-fous (confiance de
    l'ASR, mots exacts) autour des valeurs de départ."""
    base = LiveConfig()
    configs: list[tuple[str, LiveConfig]] = []
    for prior, min_words, tau in itertools.product(
        (0.8, 0.9, 0.95), (2, 3, 4, 5), (0.95, 0.98, 0.99)
    ):
        configs.append(("core", base.replace(prior=prior, min_words_lock=min_words, tau_lock=tau)))
    for confidence, exact, extra in itertools.product(
        (0.0, 0.6, 0.7, 0.8), (0.0, 0.67, 1.0), (2, 3, 4)
    ):
        configs.append(
            (
                "guards",
                base.replace(
                    min_lock_confidence=confidence,
                    min_exact_share=exact,
                    mid_verse_extra_words=extra,
                ),
            )
        )
    for margin in (100.0, 1e3, 1e4, 1e5):
        configs.append(("rivals", base.replace(words_margin=margin)))
    for min_jump, leader in itertools.product((2, 3, 4), (0.5, 0.8, 0.95)):
        configs.append(
            ("jumps", base.replace(min_words_jump=min_jump, jump_leader_posterior=leader))
        )
    return configs


def run_report(work: Path, corpus_dir: Path, out_path: Path, sweep: bool) -> dict[str, Any]:
    from aqr.live.corpus_flow import load_prefix_index

    index, skeleton = load_prefix_index(corpus_dir)
    model = ArrivalModel()
    scenarios = load_scenarios(work, skeleton, model)
    config = LiveConfig()
    runs = evaluate_all(index, config, scenarios)

    truth_runs = [r for r in runs if r[0]["kind"] in ("sequence", "mix")]
    real_runs = [r for r in runs if r[0]["kind"].startswith("real")]
    report: dict[str, Any] = {
        "config": config.as_dict(),
        "arrival_model": {
            "block_s": model.block_s,
            "settle_s": model.settle_s,
            "compute_s": model.compute_s,
        },
        "inputs": len(runs),
        "truth": summarize([r[3] for r in truth_runs]),
        "by_group": {},
        "real": {},
    }
    groups: dict[str, list[ScenarioResult]] = {}
    for entry, _scenario, _events, result in truth_runs:
        groups.setdefault(group_name(entry), []).append(result)
    report["by_group"] = {name: summarize(results) for name, results in sorted(groups.items())}

    # faux verrous : détail pour inspection
    report["false_lock_detail"] = [
        {"scenario": entry["id"], **lock_evidence(index, scenario, events, fl)}
        for entry, scenario, events, result in truth_runs
        for fl in result.false_locks
    ]
    # latence par nombre de mots du verset, avec et sans contexte (pour les cibles)
    rows = [v for r in truth_runs for v in r[3].verses]
    report["latency_by_word_count"] = {}
    for label, selector in (
        ("with_context", lambda v: v.with_context),
        ("without_context", lambda v: not v.with_context),
    ):
        locked = [v for v in rows if selector(v) and v.t_locked is not None]
        report["latency_by_word_count"][label] = distribution([v.t_locked for v in locked])
    report["unlockable"] = {
        "twin_or_prefix": sum(1 for v in rows if v.unique_prefix_words is None),
        "locked_among_them": sum(
            1 for v in rows if v.unique_prefix_words is None and v.locked_correct
        ),
    }

    for entry, scenario, events, result in real_runs:
        report["real"][entry["id"]] = real_summary(entry, scenario, events, result, index)

    report["per_input"] = [
        {
            "id": entry["id"],
            "group": group_name(entry),
            "duration_s": scenario.duration_s,
            "words": len(scenario.words),
            "verses": len(result.verses),
            "locked_correct": sum(1 for v in result.verses if v.locked_correct),
            "false_locks": len(result.false_locks),
            "revisions": result.revisions,
            "jumps": [result.jumps_expected, result.jumps_detected, result.jumps_spurious],
        }
        for entry, scenario, _events, result in runs
    ]
    report["lock_confidence"] = lock_confidence_report(runs)
    by_prefix: dict[str, list[float]] = {}
    for v in rows:
        if v.t_locked is not None:
            key = "never" if v.unique_prefix_words is None else str(min(v.unique_prefix_words, 6))
            by_prefix.setdefault(key, []).append(v.t_locked)
    report["t_locked_by_unique_prefix_words"] = {
        key: distribution(values) for key, values in sorted(by_prefix.items())
    }

    if sweep:
        grid = []
        speech = [
            (e, truncate(s, SWEEP_SPEECH_LIMIT_S))
            for e, s, _ev, _r in real_runs
            if e["kind"] == "real-speech"
        ]
        for number, (family, cfg) in enumerate(sweep_grid(), start=1):
            print(f"balayage {number} ({family})", file=sys.stderr, flush=True)
            graded = evaluate_all(index, cfg, [(e, s) for e, s, _ev, _r in truth_runs])
            summary = summarize([r[3] for r in graded])
            real_graded = evaluate_all(index, cfg, speech)
            unconfirmed = sum(len(r[3].false_locks) for r in real_graded)
            grid.append(
                {
                    "family": family,
                    "prior": cfg.prior,
                    "min_words_lock": cfg.min_words_lock,
                    "tau_lock": cfg.tau_lock,
                    "min_lock_confidence": cfg.min_lock_confidence,
                    "min_exact_share": cfg.min_exact_share,
                    "mid_verse_extra_words": cfg.mid_verse_extra_words,
                    "locked_correct": summary["locked_correct"],
                    "verses": summary["verses"],
                    "false_locks": summary["false_locks"],
                    "revisions": summary["revisions"],
                    "t_locked_median_s": summary["t_locked_s"]["median"],
                    "t_locked_p90_s": summary["t_locked_s"]["p90"],
                    "speech_locks": unconfirmed,
                }
            )
        report["sweep"] = grid
    out_path.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    return report


def lock_confidence_report(
    runs: Sequence[tuple[dict[str, Any], Scenario, list[Any], ScenarioResult]],
) -> dict[str, Any]:
    """Confiance moyenne de l'ASR et mots exacts, au verrou : verrous justes contre non confirmés,
    séparément pour la vérité calculée et pour les extraits réels (référence seulement)."""
    from aqr.live.events import Locked

    buckets: dict[str, dict[str, list[float]]] = {}
    for entry, _scenario, events, result in runs:
        truth = "truth" if entry["kind"] in ("sequence", "mix") else "reference"
        false_keys = {(str(f.locked), round(f.t, 6)) for f in result.false_locks}
        for event in events:
            if not isinstance(event, Locked):
                continue
            verdict = (
                "unconfirmed" if (str(event.ref), round(event.t, 6)) in false_keys else "confirmed"
            )
            bucket = buckets.setdefault(f"{truth}:{verdict}", {"confidence": [], "exact": []})
            bucket["confidence"].append(event.mean_confidence)
            bucket["exact"].append(float(event.exact_words))
    return {
        name: {
            "locks": len(values["confidence"]),
            "mean_confidence": distribution(values["confidence"]),
            "exact_words": distribution(values["exact"]),
        }
        for name, values in sorted(buckets.items())
    }


def lock_evidence(
    index: Any, scenario: Scenario, events: Sequence[Any], false_lock: Any
) -> dict[str, Any]:
    """Ce que l'ASR a entendu quand un verrou n'est pas confirmé : mots entendus, mots qui sont dans
    le verset, plus longue suite de mots identique au verset (>= 4 : probablement une vraie
    citation du verset). Des nombres seulement, jamais de texte coranique."""
    from aqr.live.events import Locked

    mine = next(
        (
            e
            for e in events
            if isinstance(e, Locked)
            and e.ref == false_lock.locked
            and abs(e.t - false_lock.t) < 1e-6
        ),
        None,
    )
    heard = exact = run = 0
    if mine is not None:
        verse = [
            index.token(p) for p in range(index.start_of(mine.ref), index.end_of(mine.ref) + 1)
        ]
        window = [
            w.text
            for w in scenario.words
            if mine.start_s - 0.1 <= w.start_s and w.arrival_s <= mine.t
        ]
        heard = len(window)
        exact = sum(1 for w in window if w in set(verse))
        for a in range(len(window)):
            for b in range(len(verse)):
                length = 0
                while (
                    a + length < len(window)
                    and b + length < len(verse)
                    and window[a + length] == verse[b + length]
                ):
                    length += 1
                run = max(run, length)
    return {
        "ref": str(false_lock.locked),
        "t": round(false_lock.t, 1),
        "reference_says": None if false_lock.truth is None else str(false_lock.truth),
        "kind": false_lock.kind,
        "status": false_lock.status,
        "words_heard": heard,
        "words_in_verse": exact,
        "longest_exact_run": run,
        "verse_words": index.length(false_lock.locked),
        "mean_confidence": None if mine is None else round(mine.mean_confidence, 3),
        "exact_words": None if mine is None else mine.exact_words,
    }


def real_summary(
    entry: dict[str, Any],
    scenario: Scenario,
    events: Sequence[Any],
    result: ScenarioResult,
    index: Any,
) -> dict[str, Any]:
    from aqr.live.events import Candidates, Jump, Locked, Lost

    locks = [e for e in events if isinstance(e, Locked)]
    reference = len(scenario.verses)
    confirmed = sum(1 for v in result.verses if v.locked_correct)
    unconfirmed = [lock_evidence(index, scenario, events, f) for f in result.false_locks]
    return {
        "duration_s": scenario.duration_s,
        "words": len(scenario.words),
        "reference_verses": reference,
        "locks": len(locks),
        "locks_confirmed_by_reference": confirmed,
        "locks_not_in_reference": unconfirmed,
        "reference_verses_locked": confirmed,
        "candidates_events": sum(1 for e in events if isinstance(e, Candidates)),
        "jumps": sum(1 for e in events if isinstance(e, Jump)),
        "lost": sum(1 for e in events if isinstance(e, Lost)),
        "t_locked_s": distribution([v.t_locked for v in result.verses if v.t_locked is not None]),
        "t_first_candidates_s": distribution(
            [v.t_first_candidates for v in result.verses if v.t_first_candidates is not None]
        ),
    }


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawTextHelpFormatter
    )
    parser.add_argument(
        "--stage", default="report", help="build,asr,report (séparés par des virgules)"
    )
    parser.add_argument("--work-dir", type=Path, required=True)
    parser.add_argument("--audio-dir", type=Path, default=None, help="défaut : $AQR_AUDIO_DIR")
    parser.add_argument("--models-dir", type=Path, default=None, help="défaut : $AQR_MODELS_DIR")
    parser.add_argument(
        "--batch-dir", type=Path, required=False, help="sorties aqr recognize des lots"
    )
    parser.add_argument("--corpus", type=Path, default=ROOT / "data" / "corpus")
    parser.add_argument(
        "--out", type=Path, default=None, help="rapport JSON (défaut : work/report.json)"
    )
    parser.add_argument("--no-sweep", action="store_true")
    args = parser.parse_args(argv)

    stages = {s.strip() for s in args.stage.split(",")}
    work: Path = args.work_dir
    work.mkdir(parents=True, exist_ok=True)
    audio_dir = args.audio_dir or (
        Path(os.environ["AQR_AUDIO_DIR"]) if "AQR_AUDIO_DIR" in os.environ else None
    )
    models_dir = args.models_dir or (
        Path(os.environ["AQR_MODELS_DIR"]) if "AQR_MODELS_DIR" in os.environ else None
    )
    if "build" in stages:
        if audio_dir is None or args.batch_dir is None:
            sys.exit("build : --audio-dir (ou AQR_AUDIO_DIR) et --batch-dir sont requis")
        check_dev_only(used_lots())
        mixes, notes = build_mixes(work, audio_dir, args.batch_dir, args.corpus)  # prépare mixsrc
        sequences = build_sequences(work, audio_dir)
        real = build_real(work, audio_dir, args.batch_dir)
        print(f"build : {sequences} montages, {mixes} mixages, {real} extraits réels")
        for note in notes:
            print("  ", note)
        (work / "build-notes.txt").write_text("\n".join(notes), encoding="utf-8")
    if "asr" in stages:
        if models_dir is None:
            sys.exit("asr : --models-dir (ou AQR_MODELS_DIR) requis")
        print(f"asr : {run_asr(work, models_dir)} fichiers traités")
    if "report" in stages:
        out = args.out or (work / "report.json")
        report = run_report(work, args.corpus, out, sweep=not args.no_sweep)
        print(json.dumps(report["truth"], ensure_ascii=False, indent=1))
        print(f"rapport : {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
