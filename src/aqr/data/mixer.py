"""Mixages synthétiques reproductibles, avec vérité terrain exacte (docs/TEST-CORPUS.md).

On assemble des clips connus (versets EveryAyah, basmala, isti'adha, takbir, amin, parole non
coranique) selon des scénarios qui reproduisent les découpages réels : sauts de sourate, verset
brouillé (→ INFERRED), répétitions (i'ada), arrêt au waqf puis reprise, plusieurs versets courts
d'un souffle, verset 1 avec et sans basmala, prière, assise, khutba. La vérité terrain est
**calculée depuis les durées** (échantillons entiers, grille de 1 ms : aucune dérive) ; seule la
coupure interne d'un verset (partiel) est estimée au prorata des lettres puis collée au silence le
plus proche — le mix est alors marqué `boundaries: approximate`.

Convention de vérité pour le verset 1 (sourates ≠ 1, 9), dont le texte Tanzil porte la basmala en
tête : avec basmala = `words: all` ; sans basmala (fichier EveryAyah seul) = `words: 5-N`.
"""

from __future__ import annotations

import hashlib
import random
import shutil
import wave
from array import array
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol, runtime_checkable

from aqr.corpus.normalize import normalize_arabic
from aqr.data.config import DataConfig
from aqr.data.everyayah import bismillah_clip_path, verse_clip_path
from aqr.data.ingest import Converter, ffmpeg_converter, sha256_file
from aqr.data.manifest import AudioCase, ExpectedItem, Manifest, NonQuranItem, WordRange
from aqr.domain.models import NonQuranKind, Status, VerseRef
from aqr.domain.ports import CorpusRepository
from aqr.domain.quran_structure import (
    BASMALA_WORD_COUNT,
    SURAH_WITHOUT_BASMALA,
    ayah_count,
)
from aqr.matching.segment_bench import SegmentCase

# nom du scénario -> catégories du corpus de test (docs/TEST-CORPUS.md)
SCENARIOS: Mapping[str, tuple[str, ...]] = {
    "murattal_continu": ("C01",),
    "saut_de_sourate": ("C03",),
    "verset_brouille": ("C04",),
    "repetition": ("C05",),
    "arret_waqf": ("C06",),
    "versets_courts_souffle": ("C01",),
    "verset1_avec_basmala": ("C01",),
    "verset1_sans_basmala": ("C01",),
    "priere": ("C08",),
    "assise_fr": ("C09",),
    "khutba_citation": ("C10", "C11"),
}
_LANGUES: Mapping[str, tuple[str, ...]] = {
    "assise_fr": ("fr", "ar"),
    "khutba_citation": ("ar",),
}


@dataclass(frozen=True)
class MixConfig:
    sample_rate: int = 16000
    pause_s: float = 0.35
    """Silence entre deux segments non contigus (non étiqueté : une pause n'est pas une zone)."""
    snap_window_s: float = 0.12
    """Fenêtre de recherche du silence le plus proche pour une coupure interne de verset."""
    frame_s: float = 0.01
    noise_amplitude: int = 6000
    """Amplitude du bruit qui remplace un verset brouillé."""
    min_run: int = 3
    max_run: int = 6
    breath_max_letters: int = 45
    """Un verset « court » (récitable d'un souffle avec le suivant) : au plus N lettres."""
    approximate_tolerance_ms: int = 500
    """Tolérance de frontière d'un cas aux coupures estimées (sinon `DataConfig.tolerance_ms`)."""
    long_verse_words: int = 6
    """Un verset assez long pour être coupé (waqf) ou repris à mi-chemin."""

    @property
    def grid(self) -> int:
        """Échantillons par milliseconde : longueurs multiples de ceci (temps exacts)."""
        return self.sample_rate // 1000


class ClipProvider(Protocol):
    def reciters(self) -> tuple[str, ...]: ...
    def surahs(self, reciter: str) -> tuple[int, ...]: ...
    def verse(self, reciter: str, ref: VerseRef) -> array[int]: ...
    def bismillah(self, reciter: str) -> array[int]: ...
    def special(self, kind: NonQuranKind) -> array[int] | None: ...
    def speech(self, kind: NonQuranKind, rng: random.Random) -> array[int] | None: ...


def clip_digest(clip: array[int]) -> str:
    """SHA-256 des échantillons d'un clip : l'identité d'un enregistrement, quel que soit son
    fichier (deux fichiers qui décodent pareil sont le même enregistrement)."""
    return hashlib.sha256(clip.tobytes()).hexdigest()


@dataclass(frozen=True)
class ClipUse:
    """Un clip non récité (parole, isti'adha, takbir, amin) collé dans un mixage."""

    kind: NonQuranKind
    digest: str


@dataclass(frozen=True)
class SourceFile:
    """Fichier d'origine d'un clip : nom relatif au dossier audio et SHA-256 de ses octets."""

    name: str
    sha256: str


@runtime_checkable
class OriginProvider(Protocol):
    """Fournisseur capable de dire de quel fichier vient un clip (`clip_digest`)."""

    def origin(self, digest: str) -> SourceFile | None: ...


@dataclass(frozen=True)
class Mix:
    id: str
    scenario: str
    seed: int
    reciter: str
    categorie: tuple[str, ...]
    langues: tuple[str, ...]
    samples: array[int]
    expected: tuple[ExpectedItem, ...]
    non_quran: tuple[NonQuranItem, ...]
    boundaries: str = "exact"
    clips: tuple[ClipUse, ...] = ()
    """Clips non récités utilisés (sans doublon, dans l'ordre) : la provenance du mixage."""


@dataclass
class MixReport:
    mixes: list[Mix] = field(default_factory=list)
    skipped: list[tuple[str, str]] = field(default_factory=list)
    """(scénario, raison) : sources absentes (clips isti'adha/takbir/amin, parole non coranique)."""


# --- audio -----------------------------------------------------------------------------------


def read_wav(path: Path, sample_rate: int) -> array[int]:
    with wave.open(str(path), "rb") as handle:
        if (handle.getframerate(), handle.getnchannels(), handle.getsampwidth()) != (
            sample_rate,
            1,
            2,
        ):
            raise ValueError(f"{path} : WAV mono 16 bits {sample_rate} Hz attendu")
        samples: array[int] = array("h")
        samples.frombytes(handle.readframes(handle.getnframes()))
    return samples


def write_wav(path: Path, samples: array[int], sample_rate: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(samples.tobytes())


class DiskClipProvider:
    """Clips lus dans `$AQR_AUDIO_DIR` : `everyayah/` (récitations), `specials/` et `speech/`.

    - `specials/<nature>.<ext>` : `istiadha`, `takbir`, `amin` (non disponibles sur EveryAyah :
      à fournir, jamais téléchargés ici) ;
    - `speech/<nature>_*.<ext>` : parole non coranique (`french_*`, `arabic_speech_*`).
    Les MP3 sont convertis en WAV 16 kHz mono (cache dans `_derived/clips/`).
    """

    _EXTENSIONS = (".wav", ".mp3", ".m4a", ".ogg", ".flac")

    def __init__(
        self, audio_dir: Path, *, sample_rate: int = 16000, convert: Converter = ffmpeg_converter
    ) -> None:
        self._dir = audio_dir
        self._rate = sample_rate
        self._convert = convert
        self._origins: dict[str, Path] = {}

    def _wav(self, source: Path) -> array[int]:
        if source.suffix.lower() == ".wav":
            return read_wav(source, self._rate)
        cached = (
            self._dir / "_derived" / "clips" / source.relative_to(self._dir).with_suffix(".wav")
        )
        if not cached.exists():
            cached.parent.mkdir(parents=True, exist_ok=True)
            self._convert(source, cached, self._rate)
        return read_wav(cached, self._rate)

    def reciters(self) -> tuple[str, ...]:
        root = self._dir / "everyayah"
        return tuple(sorted(p.name for p in root.iterdir() if p.is_dir())) if root.is_dir() else ()

    def surahs(self, reciter: str) -> tuple[int, ...]:
        folder = self._dir / "everyayah" / reciter
        complete = []
        for surah in range(1, 115):
            if all(
                verse_clip_path(self._dir / "everyayah", reciter, VerseRef(surah, a)).exists()
                for a in range(1, ayah_count(surah) + 1)
            ):
                complete.append(surah)
        return tuple(complete) if folder.is_dir() else ()

    def verse(self, reciter: str, ref: VerseRef) -> array[int]:
        return self._wav(verse_clip_path(self._dir / "everyayah", reciter, ref))

    def bismillah(self, reciter: str) -> array[int]:
        return self._wav(bismillah_clip_path(self._dir / "everyayah", reciter))

    def _find(self, folder: Path, stem_glob: str) -> list[Path]:
        if not folder.is_dir():
            return []
        return sorted(p for p in folder.glob(stem_glob) if p.suffix.lower() in self._EXTENSIONS)

    def _remember(self, source: Path) -> array[int]:
        samples = self._wav(source)
        self._origins[clip_digest(samples)] = source
        return samples

    def special(self, kind: NonQuranKind) -> array[int] | None:
        found = self._find(self._dir / "specials", f"{kind.value}.*")
        return self._remember(found[0]) if found else None

    def speech(self, kind: NonQuranKind, rng: random.Random) -> array[int] | None:
        found = self._find(self._dir / "speech", f"{kind.value}_*.*")
        return self._remember(rng.choice(found)) if found else None

    def origin(self, digest: str) -> SourceFile | None:
        """Fichier d'où vient un clip déjà lu par `special`/`speech` (None si inconnu)."""
        source = self._origins.get(digest)
        if source is None:
            return None
        return SourceFile(source.relative_to(self._dir).as_posix(), sha256_file(source))


# --- construction d'un mix -------------------------------------------------------------------


def _letters(word: str) -> int:
    return max(1, len(normalize_arabic(word)))


class _Builder:
    def __init__(
        self,
        config: MixConfig,
        corpus: CorpusRepository,
        provider: ClipProvider,
        reciter: str,
        rng: random.Random,
    ) -> None:
        self.config, self.corpus, self.provider = config, corpus, provider
        self.reciter, self.rng = reciter, rng
        self.samples: array[int] = array("h")
        self.expected: list[ExpectedItem] = []
        self.non_quran: list[NonQuranItem] = []
        self.clips: list[ClipUse] = []
        self.approximate = False

    # temps ---------------------------------------------------------------------------------
    def _seconds(self, n_samples: int) -> float:
        return round(n_samples / self.config.sample_rate, 3)

    def _grid(self, clip: array[int]) -> array[int]:
        remainder = len(clip) % self.config.grid
        if remainder:
            clip = array("h", clip)
            clip.extend([0] * (self.config.grid - remainder))
        return clip

    def pause(self, seconds: float | None = None) -> None:
        count = round(
            (self.config.pause_s if seconds is None else seconds) * self.config.sample_rate
        )
        count -= count % self.config.grid
        self.samples.extend([0] * count)

    def _append(self, clip: array[int], *, contiguous: bool) -> tuple[float, float]:
        if self.samples and not contiguous:
            self.pause()
        clip = self._grid(clip)
        start = len(self.samples)
        self.samples.extend(clip)
        return self._seconds(start), self._seconds(len(self.samples))

    # coupe interne d'un verset ---------------------------------------------------------------
    def _quietest(self, clip: array[int], target: int) -> int:
        frame = max(1, round(self.config.frame_s * self.config.sample_rate))
        window = round(self.config.snap_window_s * self.config.sample_rate)
        best, best_energy = target, None
        for pos in range(
            max(0, target - window), min(len(clip) - frame, target + window) + 1, frame
        ):
            energy = sum(abs(x) for x in clip[pos : pos + frame])
            if (
                best_energy is None
                or energy < best_energy
                or (energy == best_energy and abs(pos - target) < abs(best - target))
            ):
                best, best_energy = pos, energy
        return best

    def _slice(self, clip: array[int], weights: Sequence[int], lo: int, hi: int) -> array[int]:
        """Mots lo..hi (0-based inclus) d'un clip dont les mots pèsent `weights`."""
        total = sum(weights)
        start = round(len(clip) * sum(weights[:lo]) / total)
        end = round(len(clip) * sum(weights[: hi + 1]) / total)
        if lo > 0:
            start = self._quietest(clip, start)
        if hi + 1 < len(weights):
            end = self._quietest(clip, end)
        return array("h", clip[start:end])

    # éléments ----------------------------------------------------------------------------------
    @staticmethod
    def _has_basmala_prefix(ref: VerseRef) -> bool:
        return ref.ayah == 1 and ref.surah not in (1, SURAH_WITHOUT_BASMALA)

    def verse(
        self,
        ref: VerseRef,
        *,
        words: tuple[int, int] | None = None,
        with_basmala: bool = False,
        blur: bool = False,
        contiguous: bool = False,
    ) -> ExpectedItem:
        all_words = self.corpus.words(ref)
        n = len(all_words)
        prefix = BASMALA_WORD_COUNT if self._has_basmala_prefix(ref) else 0
        clip = self.provider.verse(self.reciter, ref)  # couvre les mots prefix+1 .. n
        first, last = words if words else ((1 if with_basmala or not prefix else prefix + 1), n)
        if with_basmala:
            if not prefix or first != 1:
                raise ValueError(f"basmala sans objet pour {ref} mots {first}-{last}")
            clip = array("h", [*self.provider.bismillah(self.reciter), *clip])
            covered = 1
        else:
            covered = prefix + 1
            first = max(first, covered)
        if not covered <= first <= last <= n:
            raise ValueError(f"plage de mots {first}-{last} hors de {ref}")

        if not with_basmala and (first, last) != (covered, n):
            weights = [_letters(w) for w in all_words[prefix:]]
            clip = self._slice(clip, weights, first - 1 - prefix, last - 1 - prefix)
            self.approximate = True
        if blur:
            noise = self.config.noise_amplitude
            clip = array("h", (self.rng.randint(-noise, noise) for _ in range(len(clip))))
        start, end = self._append(clip, contiguous=contiguous)
        full = (first, last) == (1, n)
        item = ExpectedItem(
            (start, end),
            ref,
            WordRange.all() if full else WordRange(first, last),
            Status.INFERRED if blur else Status.RECOGNIZED,
        )
        self.expected.append(item)
        return item

    def zone(self, kind: NonQuranKind, clip: array[int]) -> None:
        start, end = self._append(clip, contiguous=False)
        self.non_quran.append(NonQuranItem((start, end), kind))
        self.clips.append(ClipUse(kind, clip_digest(clip)))


def _short_runs(
    config: MixConfig, corpus: CorpusRepository, surahs: Sequence[int]
) -> list[list[VerseRef]]:
    """Suites de 2 à 3 versets consécutifs tous courts (récitables d'un souffle)."""

    def short(ref: VerseRef) -> bool:
        return sum(_letters(w) for w in corpus.words(ref)) <= config.breath_max_letters

    runs: list[list[VerseRef]] = []
    for surah in surahs:
        for ayah in range(1, ayah_count(surah)):
            for size in (3, 2):
                refs = [
                    VerseRef(surah, a) for a in range(ayah, ayah + size) if a <= ayah_count(surah)
                ]
                if len(refs) == size and all(short(r) for r in refs):
                    runs.append(refs)
                    break
    return runs


def _pick_run(
    rng: random.Random, config: MixConfig, surahs: Sequence[int], length: int | None = None
) -> list[VerseRef]:
    size = length or rng.randint(config.min_run, config.max_run)
    candidates = [s for s in surahs if ayah_count(s) >= size] or list(surahs)
    surah = rng.choice(candidates)
    size = min(size, ayah_count(surah))
    start = rng.randint(1, ayah_count(surah) - size + 1)
    return [VerseRef(surah, a) for a in range(start, start + size)]


def _long_verse(
    rng: random.Random, config: MixConfig, corpus: CorpusRepository, surahs: Sequence[int]
) -> VerseRef:
    # Verset 1 exclu : sa basmala concaténée complique la coupe sans rien apporter ici.
    pool = [
        VerseRef(s, a)
        for s in surahs
        for a in range(2, ayah_count(s) + 1)
        if len(corpus.words(VerseRef(s, a))) >= config.long_verse_words
    ]
    if not pool:
        raise ValueError("aucun verset assez long dans les sourates disponibles")
    return rng.choice(pool)


def _recite(b: _Builder, refs: Sequence[VerseRef], *, with_basmala_p: float = 0.5) -> None:
    for ref in refs:
        basmala = b._has_basmala_prefix(ref) and b.rng.random() < with_basmala_p
        b.verse(ref, with_basmala=basmala)


def _scenario_murattal_continu(b: _Builder, surahs: Sequence[int]) -> None:
    _recite(b, _pick_run(b.rng, b.config, surahs))


def _scenario_saut_de_sourate(b: _Builder, surahs: Sequence[int]) -> None:
    first = _pick_run(b.rng, b.config, surahs, b.rng.randint(2, 3))
    others = [s for s in surahs if s != first[0].surah]
    _recite(b, first)
    _recite(b, _pick_run(b.rng, b.config, others, b.rng.randint(2, 3)))


def _scenario_verset_brouille(b: _Builder, surahs: Sequence[int]) -> None:
    run = _pick_run(b.rng, b.config, surahs, max(b.config.min_run, 4))
    blurred = b.rng.randint(1, len(run) - 2)
    for index, ref in enumerate(run):
        b.verse(ref, blur=index == blurred)


def _scenario_repetition(b: _Builder, surahs: Sequence[int]) -> None:
    ref = _long_verse(b.rng, b.config, b.corpus, surahs)
    n = len(b.corpus.words(ref))
    b.verse(ref)
    b.verse(ref, words=(n // 2 + 1, n))  # reprise (i'ada) de la seconde moitié
    if ref.ayah < ayah_count(ref.surah):
        b.verse(VerseRef(ref.surah, ref.ayah + 1))


def _scenario_arret_waqf(b: _Builder, surahs: Sequence[int]) -> None:
    ref = _long_verse(b.rng, b.config, b.corpus, surahs)
    n = len(b.corpus.words(ref))
    cut = max(1, n // 2)
    b.verse(ref, words=(1, cut))  # arrêt au waqf…
    b.verse(ref, words=(cut + 1, n))  # …puis reprise


def _scenario_versets_courts_souffle(b: _Builder, surahs: Sequence[int]) -> None:
    runs = _short_runs(b.config, b.corpus, surahs)
    run = b.rng.choice(runs)
    for index, ref in enumerate(run):
        b.verse(ref, contiguous=index > 0)


def _scenario_verset1(b: _Builder, surahs: Sequence[int], *, with_basmala: bool) -> None:
    surah = b.rng.choice([s for s in surahs if s not in (1, SURAH_WITHOUT_BASMALA)])
    b.verse(VerseRef(surah, 1), with_basmala=with_basmala)
    if ayah_count(surah) >= 2:
        b.verse(VerseRef(surah, 2))


def _scenario_priere(b: _Builder, surahs: Sequence[int]) -> None:
    special = b.provider.special
    for kind in (NonQuranKind.TAKBIR, NonQuranKind.ISTIADHA):
        clip = special(kind)
        assert clip is not None
        b.zone(kind, clip)
    for ayah in range(1, 8):
        b.verse(VerseRef(1, ayah))
    amin = special(NonQuranKind.AMIN)
    assert amin is not None
    b.zone(NonQuranKind.AMIN, amin)
    others = [s for s in surahs if s != 1]
    _recite(b, _pick_run(b.rng, b.config, others, b.rng.randint(2, 3)), with_basmala_p=1.0)
    takbir = special(NonQuranKind.TAKBIR)
    assert takbir is not None
    b.zone(NonQuranKind.TAKBIR, takbir)


def _speech(b: _Builder, kind: NonQuranKind) -> None:
    clip = b.provider.speech(kind, b.rng)
    assert clip is not None
    b.zone(kind, clip)


def _scenario_assise_fr(b: _Builder, surahs: Sequence[int]) -> None:
    _speech(b, NonQuranKind.FRENCH)
    _recite(b, _pick_run(b.rng, b.config, surahs, b.rng.randint(2, 3)))
    _speech(b, NonQuranKind.ARABIC_SPEECH)  # hadith cité
    _speech(b, NonQuranKind.FRENCH)


def _scenario_khutba_citation(b: _Builder, surahs: Sequence[int]) -> None:
    _speech(b, NonQuranKind.ARABIC_SPEECH)
    _recite(b, _pick_run(b.rng, b.config, surahs, b.rng.randint(1, 2)))
    _speech(b, NonQuranKind.ARABIC_SPEECH)
    _recite(b, _pick_run(b.rng, b.config, surahs, 1))


_BUILDERS: Mapping[str, Callable[[_Builder, Sequence[int]], None]] = {
    "murattal_continu": _scenario_murattal_continu,
    "saut_de_sourate": _scenario_saut_de_sourate,
    "verset_brouille": _scenario_verset_brouille,
    "repetition": _scenario_repetition,
    "arret_waqf": _scenario_arret_waqf,
    "versets_courts_souffle": _scenario_versets_courts_souffle,
    "verset1_avec_basmala": lambda b, s: _scenario_verset1(b, s, with_basmala=True),
    "verset1_sans_basmala": lambda b, s: _scenario_verset1(b, s, with_basmala=False),
    "priere": _scenario_priere,
    "assise_fr": _scenario_assise_fr,
    "khutba_citation": _scenario_khutba_citation,
}


def _unavailable(
    scenario: str, provider: ClipProvider, corpus: CorpusRepository, config: MixConfig
) -> str | None:
    """Raison pour laquelle un scénario ne peut pas être fabriqué, ou None."""
    rng = random.Random(0)
    reciters = provider.reciters()
    if not reciters:
        return "aucun récitant EveryAyah disponible (lancer scripts/fetch_everyayah.py)"
    surahs = provider.surahs(reciters[0])
    if not surahs:
        return "aucune sourate complète disponible"
    if scenario == "priere":
        missing = [
            k.value
            for k in (NonQuranKind.TAKBIR, NonQuranKind.ISTIADHA, NonQuranKind.AMIN)
            if provider.special(k) is None
        ]
        if missing:
            return f"clips absents dans specials/ : {', '.join(missing)}"
        if 1 not in surahs or len(surahs) < 2:
            return "la prière exige la sourate 1 et une autre sourate complète"
    if scenario in ("assise_fr", "khutba_citation"):
        needed = (
            (NonQuranKind.FRENCH, NonQuranKind.ARABIC_SPEECH)
            if scenario == "assise_fr"
            else (NonQuranKind.ARABIC_SPEECH,)
        )
        missing = [k.value for k in needed if provider.speech(k, rng) is None]
        if missing:
            return f"clips absents dans speech/ : {', '.join(f'{m}_*' for m in missing)}"
    if scenario == "saut_de_sourate" and len(surahs) < 2:
        return "le saut exige au moins deux sourates complètes"
    if scenario == "verset_brouille" and not any(ayah_count(s) >= 4 for s in surahs):
        return "aucune sourate d'au moins 4 versets"
    if scenario in ("verset1_avec_basmala", "verset1_sans_basmala") and not [
        s for s in surahs if s not in (1, SURAH_WITHOUT_BASMALA)
    ]:
        return "aucune sourate (hors 1 et 9) disponible"
    if scenario == "versets_courts_souffle" and not _short_runs(config, corpus, surahs):
        return "aucune suite de versets courts dans les sourates disponibles"
    if scenario in ("repetition", "arret_waqf"):
        try:
            _long_verse(rng, config, corpus, surahs)
        except ValueError as exc:
            return str(exc)
    return None


_MAX_ATTEMPTS = 20


def _build(
    scenario: str,
    index: int,
    seed: int,
    rng: random.Random,
    provider: ClipProvider,
    corpus: CorpusRepository,
    cfg: MixConfig,
) -> Mix:
    reciter = rng.choice(provider.reciters())
    builder = _Builder(cfg, corpus, provider, reciter, rng)
    _BUILDERS[scenario](builder, provider.surahs(reciter))
    return Mix(
        id=f"mix-{scenario}-s{seed}-{index:02d}".replace("_", "-"),
        scenario=scenario,
        seed=seed,
        reciter=reciter,
        categorie=SCENARIOS[scenario],
        langues=_LANGUES.get(scenario, ("ar",)),
        samples=builder.samples,
        expected=tuple(builder.expected),
        non_quran=tuple(builder.non_quran),
        boundaries="approximate" if builder.approximate else "exact",
        clips=tuple(dict.fromkeys(builder.clips)),
    )


def generate_mixes(
    provider: ClipProvider,
    corpus: CorpusRepository,
    *,
    seed: int,
    per_scenario: int = 3,
    scenarios: Sequence[str] | None = None,
    config: MixConfig | None = None,
) -> MixReport:
    cfg = config or MixConfig()
    report = MixReport()
    for scenario in scenarios or sorted(SCENARIOS):
        if scenario not in SCENARIOS:
            raise ValueError(f"scénario inconnu : {scenario!r} (connus : {sorted(SCENARIOS)})")
        reason = _unavailable(scenario, provider, corpus, cfg)
        if reason is not None:
            report.skipped.append((scenario, reason))
            continue
        seen: set[bytes] = set()
        for index in range(per_scenario):
            mix = None
            for attempt in range(_MAX_ATTEMPTS):  # évite deux mixages strictement identiques
                tag = f"{seed}:{scenario}:{index}" + (f":{attempt}" if attempt else "")
                candidate = _build(scenario, index, seed, random.Random(tag), provider, corpus, cfg)
                if candidate.samples.tobytes() not in seen:
                    mix = candidate
                    break
            if mix is None:
                report.skipped.append(
                    (scenario, f"variété insuffisante : mixage n°{index} identique à un précédent")
                )
                break
            seen.add(mix.samples.tobytes())
            report.mixes.append(mix)
    return report


# --- écriture et banc --------------------------------------------------------------------------


def materialize(
    mix: Mix,
    audio_dir: Path,
    manifest_path: Path,
    config: DataConfig,
    mix_config: MixConfig | None = None,
) -> AudioCase:
    """Écrit le WAV (`mix/` + `_derived/`) et enregistre le cas annoté dans le manifeste."""
    cfg = mix_config or MixConfig(sample_rate=config.sample_rate)
    target = audio_dir / "mix" / f"{mix.id}.wav"
    write_wav(target, mix.samples, cfg.sample_rate)
    derived = audio_dir / "_derived" / f"{mix.id}.wav"
    derived.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(target, derived)
    case = AudioCase(
        id=mix.id,
        file=f"mix/{mix.id}.wav",
        sha256=sha256_file(target),
        categorie=mix.categorie,
        recitant=f"{config.mix_recitant_prefix}{mix.reciter}".lower(),
        riwaya="hafs",
        langues=mix.langues,
        license="synthétique : récitations EveryAyah et clips fournis, usage interne de test",
        duree_s=round(len(mix.samples) / cfg.sample_rate, 3),
        statut=config.statut_annote,
        tolerance_ms=(
            cfg.approximate_tolerance_ms if mix.boundaries == "approximate" else config.tolerance_ms
        ),
        origine="mix",
        boundaries=mix.boundaries,
        expected=mix.expected,
        non_quran=mix.non_quran,
        extra={"scenario": mix.scenario, "seed": mix.seed},
    )
    manifest = Manifest.load(manifest_path)
    manifest.upsert(case)
    manifest.save(manifest_path)
    return case


def mix_segment_cases(
    mixes: Sequence[Mix],
    corpus: CorpusRepository,
    simple_clean_words: Mapping[VerseRef, tuple[str, ...]],
) -> list[SegmentCase]:
    """Segments récités des mixages sous la forme attendue par le banc de la phase 2b
    (`aqr.matching.segment_bench`) : requêtes imla'i, versets réellement récités.

    Un segment = une suite d'éléments contigus (plusieurs versets d'un souffle) ou un
    élément seul. Les versets brouillés (INFERRED) et ceux dont le découpage en mots diffère
    entre Uthmani et simple-clean (index non alignables) sont écartés.
    """
    cases: list[SegmentCase] = []
    for mix in mixes:
        groups: list[list[ExpectedItem]] = []
        for item in sorted(mix.expected, key=lambda i: i.t):
            if item.status is not Status.RECOGNIZED:
                continue
            if groups and groups[-1][-1].t[1] == item.t[0]:
                groups[-1].append(item)
            else:
                groups.append([item])
        for group in groups:
            tokens: list[str] = []
            usable = True
            for item in group:
                simple = simple_clean_words.get(item.ref, ())
                if len(simple) != len(corpus.words(item.ref)):
                    usable = False
                    break
                lo = 0 if item.words.is_all else (item.words.first or 1) - 1
                hi = len(simple) if item.words.is_all else (item.words.last or len(simple))
                tokens.extend(t for t in (normalize_arabic(w) for w in simple[lo:hi]) if t)
            if not usable or not tokens:
                continue
            cases.append(
                SegmentCase(_segment_kind(group), tuple(tokens), frozenset(i.ref for i in group))
            )
    return cases


def _segment_kind(group: Sequence[ExpectedItem]) -> str:
    if len(group) > 1:
        return "multi_versets"
    item = group[0]
    verse_one = item.ref.ayah == 1 and item.ref.surah not in (1, SURAH_WITHOUT_BASMALA)
    if verse_one and item.words.is_all:
        return "verset1_avec_basmala"
    if verse_one and item.words.first == BASMALA_WORD_COUNT + 1:
        return "verset1_sans_basmala"
    return "verset_entier" if item.words.is_all else "partiel"
