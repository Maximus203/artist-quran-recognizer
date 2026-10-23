"""Courbe de dégradation : conditions d'enregistrement, notation d'un fichier, règle de décision.

Partie PURE de la campagne `scripts/measure_degradation.py` (ni modèle, ni audio, ni ffmpeg) :

- les conditions (`build_conditions`) : familles de dégradations, niveaux, paramètres exacts et
  graines, qui servent aussi de table de la méthode dans le rapport ;
- la notation d'un fichier dont le contenu est CONNU par construction (`score_file`) : versets
  attendus retrouvés, faux versets, versets seulement inférés ou incertains, abstentions ;
- la règle de décision (`DECISION_RULE`, `family_verdict`, `decide`), écrite AVANT la mesure : elle
  dit à quelle chute de rappel un fine-tuning avec dégradations est justifié.

Le texte coranique n'apparaît nulle part ici : la vérité est une liste de références de versets
avec leur temps, jamais un texte (I1).
"""

from __future__ import annotations

import json
from collections.abc import Collection, Iterable, Mapping, Sequence
from dataclasses import asdict, dataclass, field, fields
from pathlib import Path
from typing import Any, Final

from aqr.domain.models import Status, VerseRef
from aqr.domain.quran_structure import BASMALA_WORD_COUNT, ayah_count, verse_one_includes_basmala
from aqr.eval.recognition import (
    AbstentionInterval,
    Recognition,
    RecognitionError,
    VerseInterval,
    parse_recognition,
)
from aqr.eval.transcription import WordSource

CLEAN_ID: Final = "propre"
LOCATION_TOLERANCE_S: Final = 1.0
"""Un verset reconnu est « bien placé » si le milieu de son intervalle tombe dans le temps réel du
verset, élargi de cette tolérance (les clips EveryAyah portent leur silence de tête et de queue)."""
BASE_SEED: Final = 20261023
"""Graine des bruits et des réponses impulsionnelles de la condition."""
SEED_STRIDE: Final = 101
"""Graine d'un fichier = graine de la condition + SEED_STRIDE × indice du fichier : des bruits
indépendants d'un fichier à l'autre, identiques à chaque rejeu."""

Param = float | int | str


# --- conditions -------------------------------------------------------------------------------


@dataclass(frozen=True)
class Condition:
    """Une condition d'enregistrement dégradée. `kind` choisit l'implémentation
    (`aqr.data.degrade_extra`), `params` en fixe tous les réglages, graine comprise."""

    id: str
    family: str
    level: str
    label: str
    kind: str
    params: Mapping[str, Param] = field(default_factory=dict)
    severity: int = 0
    tempo: float = 1.0
    anchor: bool = False
    """Niveau « réaliste » de la famille, celui sur lequel la règle de décision juge."""
    required: bool = False
    """Famille imposée par le cahier : seule une famille obligatoire en échec justifie, seule, un
    fine-tuning ; les autres éclairent le choix des cibles."""
    cascade: bool = False
    """Mesurée aussi avec la cascade par défaut (et pas seulement le moteur principal seul)."""
    exploratory: bool = False
    """Ajoutée APRÈS le résultat principal, au-delà du cahier : éclaire, ne décide jamais."""


def _noise(kind: str, family: str, name: str) -> list[Condition]:
    return [
        Condition(
            id=f"{family}_{snr}db",
            family=family,
            level=f"SNR {snr} dB",
            label=f"{name}, SNR {snr} dB",
            kind=kind,
            params={"snr_db": snr, "seed": BASE_SEED},
            severity=rank,
            anchor=snr == 10,
            required=family == "bruit_blanc",
            cascade=family == "bruit_blanc" and snr == 10,
        )
        for rank, snr in enumerate((20, 10, 5), start=1)
    ]


# Réponses impulsionnelles : (niveau, RT60 en s, rapport direct/réverbéré en dB).
ROOMS: Final = (
    ("faible", "petite salle", 0.4, 6),
    ("moyenne", "grande salle", 0.9, 0),
    ("forte", "mosquée", 2.0, -4),
)
TELEPHONE_CODECS: Final = (
    ("g711", "G.711 µ-law (ligne fixe)", "pcm_mulaw", ""),
    ("amr122", "AMR-NB 12,2 kbit/s (mobile)", "libopencore_amrnb", "12.2k"),
    ("amr475", "AMR-NB 4,75 kbit/s (mobile, débit minimal)", "libopencore_amrnb", "4.75k"),
)


def build_conditions() -> tuple[Condition, ...]:
    conditions: list[Condition] = [
        Condition(
            id=CLEAN_ID,
            family="propre",
            level="propre",
            label="propre (référence)",
            kind="clean",
            cascade=True,
        )
    ]
    conditions += _noise("noise_white", "bruit_blanc", "bruit blanc")
    conditions += _noise("noise_pink", "bruit_rose", "bruit rose")
    for rank, (level, name, rt60, drr) in enumerate(ROOMS, start=1):
        detail = f"{name}, RT60 {rt60:g} s, direct/réverbéré {drr:+d} dB".replace(".", ",")
        conditions.append(
            Condition(
                id=f"reverberation_{level}",
                family="reverberation",
                level=level,
                label=f"réverbération {level} ({detail})",
                kind="reverb_room",
                params={"rt60_s": rt60, "drr_db": drr, "seed": BASE_SEED},
                severity=rank,
                anchor=level == "moyenne",
                required=True,
            )
        )
    for rank, (level, name, codec, bitrate) in enumerate(TELEPHONE_CODECS, start=1):
        conditions.append(
            Condition(
                id=f"telephone_{level}",
                family="telephone",
                level=level,
                label=f"téléphone 8 kHz, 300-3400 Hz, {name}",
                kind="telephone",
                params={"codec": codec, "bitrate": bitrate},
                severity=rank,
                anchor=level == "amr122",
            )
        )
    for rank, kbps in enumerate((128, 48, 24), start=1):
        conditions.append(
            Condition(
                id=f"mp3_{kbps}k",
                family="mp3",
                level=f"{kbps} kbit/s",
                label=f"MP3 {kbps} kbit/s",
                kind="mp3",
                params={"kbps": kbps},
                severity=rank,
                anchor=kbps == 48,
                required=True,
            )
        )
    for rank, tempo in enumerate((0.8, 0.6, 0.5), start=1):
        conditions.append(
            Condition(
                id=f"lent_x{tempo:g}",
                family="lent",
                level=f"×{tempo:g}".replace(".", ","),
                label=f"vitesse ×{tempo:g} sans changement de hauteur".replace(".", ","),
                kind="tempo",
                params={"tempo": tempo},
                severity=rank,
                tempo=tempo,
                anchor=tempo == 0.6,
                required=True,
                cascade=tempo == 0.6,
            )
        )
    conditions.append(
        Condition(
            id="combinaison",
            family="combinaison",
            level="réverbération moyenne + bruit 10 dB",
            label="réverbération moyenne puis bruit blanc SNR 10 dB",
            kind="combo",
            params={"rt60_s": 0.9, "drr_db": 0, "snr_db": 10, "seed": BASE_SEED},
            severity=1,
            anchor=True,
        )
    )
    return tuple(conditions)


def build_exploratory_conditions() -> tuple[Condition, ...]:
    """Niveaux plus sévères que ceux du cahier, et la bande passante : où ça casse, et pourquoi.

    Décidées APRÈS avoir vu le résultat principal (aucune famille n'échouait) : elles ne sont
    jamais une ancre, n'entrent pas dans la règle de décision et sont signalées comme telles."""
    out: list[Condition] = []
    for kind, family, name in (
        ("noise_white", "bruit_blanc", "bruit blanc"),
        ("noise_pink", "bruit_rose", "bruit rose"),
    ):
        for rank, snr in ((4, 0), (5, -5)):
            tag = f"m{-snr}" if snr < 0 else str(snr)
            out.append(
                Condition(
                    id=f"{family}_{tag}db",
                    family=family,
                    level=f"SNR {snr} dB",
                    label=f"{name}, SNR {snr} dB",
                    kind=kind,
                    params={"snr_db": snr, "seed": BASE_SEED},
                    severity=rank,
                    exploratory=True,
                )
            )
    out.append(
        Condition(
            id="reverberation_extreme",
            family="reverberation",
            level="extrême",
            label="réverbération extrême (grande nef, RT60 3,5 s, direct/réverbéré -10 dB)",
            kind="reverb_room",
            params={"rt60_s": 3.5, "drr_db": -10, "seed": BASE_SEED},
            severity=4,
            exploratory=True,
        )
    )
    for rank, kbps in ((4, 16), (5, 8)):
        out.append(
            Condition(
                id=f"mp3_{kbps}k",
                family="mp3",
                level=f"{kbps} kbit/s",
                label=f"MP3 {kbps} kbit/s",
                kind="mp3",
                params={"kbps": kbps},
                severity=rank,
                exploratory=True,
            )
        )
    for rank, tempo in ((4, 0.4), (5, 0.3)):
        out.append(
            Condition(
                id=f"lent_x{tempo:g}",
                family="lent",
                level=f"×{tempo:g}".replace(".", ","),
                label=f"vitesse ×{tempo:g} sans changement de hauteur".replace(".", ","),
                kind="tempo",
                params={"tempo": tempo},
                severity=rank,
                tempo=tempo,
                exploratory=True,
            )
        )
    for rank, hz in enumerate((7000, 5500, 4000), start=1):
        cutoff, rate = f"{hz / 1000:g} kHz", f"{2 * hz / 1000:g} kHz"
        out.append(
            Condition(
                id=f"passe_bas_{hz}",
                family="passe_bas",
                level=cutoff.replace(".", ","),
                label=f"propre, passe-bas à {cutoff} (rééchantillonnage à {rate})".replace(
                    ".", ","
                ),
                kind="lowpass",
                params={"hz": hz},
                severity=rank,
                exploratory=True,
            )
        )
    return tuple(out)


def _front_end(
    identifier: str, kind: str, label: str, *, tempo: float = 1.0, **params: Param
) -> Condition:
    return Condition(
        id=identifier,
        family="levier",
        level=label,
        label=label,
        kind=kind,
        params={**params, "tempo": tempo} if kind == "tempo" else params,
        tempo=tempo,
        exploratory=True,
    )


FRONT_ENDS: Final[tuple[Condition, ...]] = (
    _front_end("accelerer_x2", "tempo", "accélération ×2", tempo=2.0),
    _front_end("accelerer_x3", "tempo", "accélération ×3", tempo=3.0),
    _front_end("debruitage", "denoise", "débruitage afftdn", nr=20, nf=-30),
)
"""Traitements applicables EN AMONT de l'ASR, essayés après une dégradation (étapes d'un levier).
Ils ne sont pas mesurés seuls. Une accélération est un `tempo` > 1 : `params["tempo"]` le dit."""


def resolve_step(identifier: str) -> Condition:
    """Une étape d'un levier : une condition de la campagne ou un traitement amont."""
    table = {c.id: c for c in (*build_conditions(), *build_exploratory_conditions(), *FRONT_ENDS)}
    return table[identifier]  # KeyError explicite


def _lever(identifier: str, steps: Sequence[str], label: str) -> Condition:
    net = 1.0
    for step in steps:
        net *= resolve_step(step).tempo
    return Condition(
        id=f"levier_{identifier}",
        family="levier",
        level=label,
        label=label,
        kind="chain",
        params={"steps": ">".join(steps)},
        tempo=net,
        exploratory=True,
    )


def build_lever_conditions() -> tuple[Condition, ...]:
    """Leviers peu coûteux testés sur les conditions qui cassent le moteur (exploratoire)."""
    return (
        _lever(
            "x0.4_puis_x2", ("lent_x0.4", "accelerer_x2"), "×0,4 puis accélération ×2 (net ×0,8)"
        ),
        _lever(
            "x0.3_puis_x2", ("lent_x0.3", "accelerer_x2"), "×0,3 puis accélération ×2 (net ×0,6)"
        ),
        _lever(
            "x0.3_puis_x3", ("lent_x0.3", "accelerer_x3"), "×0,3 puis accélération ×3 (net ×0,9)"
        ),
        _lever(
            "bruit_blanc_m5db_puis_debruitage",
            ("bruit_blanc_m5db", "debruitage"),
            "bruit blanc -5 dB puis débruitage",
        ),
        _lever(
            "bruit_rose_m5db_puis_debruitage",
            ("bruit_rose_m5db", "debruitage"),
            "bruit rose -5 dB puis débruitage",
        ),
        _lever(
            "bruit_blanc_m5db_puis_passe_bas_5500",
            ("bruit_blanc_m5db", "passe_bas_5500"),
            "bruit blanc -5 dB puis passe-bas 5,5 kHz",
        ),
        _lever(
            "bruit_rose_m5db_puis_passe_bas_5500",
            ("bruit_rose_m5db", "passe_bas_5500"),
            "bruit rose -5 dB puis passe-bas 5,5 kHz",
        ),
        _lever(
            "reverberation_extreme_puis_passe_bas_5500",
            ("reverberation_extreme", "passe_bas_5500"),
            "réverbération extrême puis passe-bas 5,5 kHz",
        ),
    )


def all_conditions() -> tuple[Condition, ...]:
    return (*build_conditions(), *build_exploratory_conditions(), *build_lever_conditions())


def conditions_by_id(ids: Iterable[str]) -> list[Condition]:
    table = {c.id: c for c in all_conditions()}
    return [table[i] for i in ids]  # KeyError explicite pour un identifiant inconnu


def required_families() -> frozenset[str]:
    return frozenset(c.family for c in build_conditions() if c.required)


# --- fichiers de la campagne ------------------------------------------------------------------


SELECTION: Final[tuple[tuple[str, int], ...]] = (
    ("Alafasy_128kbps", 67),
    ("Alafasy_128kbps", 97),
    ("Alafasy_128kbps", 114),
    ("Husary_128kbps", 1),
    ("Husary_128kbps", 109),
    ("Husary_128kbps", 110),
    ("Abdul_Basit_Murattal_192kbps", 97),
    ("Abdul_Basit_Murattal_192kbps", 109),
    ("Abdul_Basit_Murattal_192kbps", 113),
)
"""(récitant EveryAyah, sourate) : trois récitants × trois sourates reconstituées, dans le
sous-ensemble déjà téléchargé (`DEFAULT_SUBSET`). Al-Mulk (30 versets, ~7 min) éprouve la longue
récitation et les suites ; Al-Fatiha le cas où la basmala EST le verset ; les petites sourates
(3 à 6 versets) donnent des fichiers courts où un verset perdu pèse lourd."""


def file_id(reciter: str, surah: int) -> str:
    """`Alafasy_128kbps`, 67 -> `Alafasy-067`."""
    parts = [p for p in reciter.split("_") if not p.endswith("kbps") and p != "Murattal"]
    return f"{'_'.join(parts)}-{surah:03d}"


def truth_from_durations(surah: int, durations_s: Sequence[float]) -> list[TruthVerse]:
    """Vérité d'une sourate reconstituée par concaténation de ses clips, sans trou ajouté."""
    if len(durations_s) != ayah_count(surah):
        raise ValueError(f"sourate {surah} : {ayah_count(surah)} versets, {len(durations_s)} clips")
    out: list[TruthVerse] = []
    cursor = 0.0
    for ayah, duration in enumerate(durations_s, start=1):
        out.append(TruthVerse(VerseRef(surah, ayah), cursor, cursor + duration))
        cursor += duration
    return out


def reference_words_for_file(truth: Sequence[TruthVerse], corpus: WordSource) -> tuple[str, ...]:
    """Mots Uthmani (corpus, I1) de ce que le fichier DIT. Le clip EveryAyah du verset 1 ne
    contient pas la basmala que le texte Tanzil y colle (sauf Al-Fatiha, où elle est le verset) :
    ses 4 premiers mots sont écartés, sinon le WER compterait 4 suppressions qui n'en sont pas."""
    words: list[str] = []
    for item in truth:
        verse = corpus.words(item.ref)
        skip = (
            BASMALA_WORD_COUNT
            if item.ref.ayah == 1
            and item.ref.surah != 1
            and verse_one_includes_basmala(item.ref.surah)
            else 0
        )
        words.extend(verse[skip:])
    return tuple(words)


# --- vérité et notation -----------------------------------------------------------------------


@dataclass(frozen=True)
class TruthVerse:
    """Où un verset se trouve réellement dans le fichier (temps de l'audio de la condition)."""

    ref: VerseRef
    start_s: float
    end_s: float


def scale_truth(truth: Sequence[TruthVerse], tempo: float) -> list[TruthVerse]:
    """Vérité d'un audio étiré à la vitesse `tempo` (0,6 = 1/0,6 fois plus long)."""
    if tempo <= 0:
        raise ValueError(f"vitesse invalide : {tempo}")
    return [TruthVerse(t.ref, t.start_s / tempo, t.end_s / tempo) for t in truth]


@dataclass(frozen=True)
class FileScore:
    """Comptes d'un fichier, ou somme de plusieurs (`totals`). Les versets sont des versets
    DISTINCTS : un verset redit ou coupé en plusieurs intervalles compte une fois."""

    expected: int
    recognized: int
    """Versets attendus nommés `recognized` (rappel)."""
    located: int
    """… dont l'intervalle tombe dans le temps réel du verset."""
    inferred: int
    """Versets attendus seulement `inferred` (jamais reconnus, I5)."""
    uncertain: int
    """Versets attendus seulement dans un intervalle `uncertain` (ni texte ni traduction)."""
    missed: int
    """Versets attendus sans aucun intervalle verset."""
    false_recognized: int
    """Versets `recognized` qui n'étaient pas attendus : nommer un faux verset est le pire (I3)."""
    false_inferred: int
    misplaced: int
    """Versets attendus et reconnus, mais seulement à un autre endroit du fichier."""
    abstentions: int
    abstention_s: float

    @property
    def recall(self) -> float | None:
        return self.recognized / self.expected if self.expected else None

    def to_dict(self) -> dict[str, float | int | None]:
        return {**asdict(self), "recall": self.recall}


def _midpoint_inside(interval: VerseInterval, truth: TruthVerse, tolerance_s: float) -> bool:
    if interval.t is None:
        return False
    middle = (interval.t[0] + interval.t[1]) / 2
    return truth.start_s - tolerance_s <= middle <= truth.end_s + tolerance_s


def score_file(
    truth: Sequence[TruthVerse],
    recognition: Recognition,
    *,
    tolerance_s: float = LOCATION_TOLERANCE_S,
) -> FileScore:
    if not truth:
        raise ValueError("aucune vérité : un fichier de la campagne contient toujours des versets")
    expected = {t.ref: t for t in truth}
    verses = [i for i in recognition.intervals if isinstance(i, VerseInterval)]
    by_status: dict[Status, list[VerseInterval]] = {s: [] for s in Status}
    for interval in verses:
        by_status[interval.status].append(interval)

    recognized_refs = {i.ref for i in by_status[Status.RECOGNIZED]}
    inferred_refs = {i.ref for i in by_status[Status.INFERRED]}
    uncertain_refs = {ref for i in by_status[Status.UNCERTAIN] for ref in (i.ref, *i.candidates)}

    hits = set(expected) & recognized_refs
    located = {
        ref
        for ref in hits
        if any(
            i.ref == ref and _midpoint_inside(i, expected[ref], tolerance_s)
            for i in by_status[Status.RECOGNIZED]
        )
    }
    only_inferred = (set(expected) & inferred_refs) - recognized_refs
    only_uncertain = (set(expected) & uncertain_refs) - recognized_refs - inferred_refs
    abstentions = [i for i in recognition.intervals if isinstance(i, AbstentionInterval)]
    return FileScore(
        expected=len(expected),
        recognized=len(hits),
        located=len(located),
        inferred=len(only_inferred),
        uncertain=len(only_uncertain),
        missed=len(expected) - len(hits) - len(only_inferred) - len(only_uncertain),
        false_recognized=len(recognized_refs - set(expected)),
        false_inferred=len(inferred_refs - set(expected) - recognized_refs),
        misplaced=len(hits) - len(located),
        abstentions=len(abstentions),
        abstention_s=sum(a.t[1] - a.t[0] for a in abstentions),
    )


def totals(scores: Iterable[FileScore]) -> FileScore:
    items = list(scores)
    return FileScore(
        expected=sum(s.expected for s in items),
        recognized=sum(s.recognized for s in items),
        located=sum(s.located for s in items),
        inferred=sum(s.inferred for s in items),
        uncertain=sum(s.uncertain for s in items),
        missed=sum(s.missed for s in items),
        false_recognized=sum(s.false_recognized for s in items),
        false_inferred=sum(s.false_inferred for s in items),
        misplaced=sum(s.misplaced for s in items),
        abstentions=sum(s.abstentions for s in items),
        abstention_s=sum(s.abstention_s for s in items),
    )


def wilson_interval(successes: int, trials: int, z: float = 1.96) -> tuple[float, float]:
    """Intervalle de Wilson (95 % par défaut) d'une proportion. Les versets d'un même fichier ne
    sont pas indépendants : l'intervalle est un ordre de grandeur, pas une garantie."""
    if trials <= 0:
        return 0.0, 1.0
    p = successes / trials
    denominator = 1 + z * z / trials
    centre = (p + z * z / (2 * trials)) / denominator
    half = z * ((p * (1 - p) / trials + z * z / (4 * trials * trials)) ** 0.5) / denominator
    return max(0.0, centre - half), min(1.0, centre + half)


# --- règle de décision, écrite avant la mesure --------------------------------------------------


@dataclass(frozen=True)
class DecisionRule:
    """À quelle chute de rappel un fine-tuning avec dégradations est justifié.

    1. Plancher : le rappel du propre doit être ≥ `clean_min_recall`, sinon la mesure est non
       concluante (le défaut n'est alors pas la dégradation).
    2. Pour chaque famille, on compare le niveau « réaliste » (ancre) au propre, fichier par
       fichier. Chute agrégée = points de rappel perdus sur la somme des versets attendus.
    3. « échoue » : chute > `fail_drop_points` ET au moins `file_share` des fichiers perdent plus
       de `file_drop_points` (une chute portée par un seul fichier est un accident, pas une
       famille). « robuste » : chute ≤ `robust_drop_points`. Entre les deux : « dégradée ».
    4. Fine-tuning justifié si au moins une famille OBLIGATOIRE échoue ; les familles qui
       échouent sont alors les cibles. Une famille complémentaire en échec se signale, ne décide
       pas seule.
    5. Indépendamment du rappel : plus de `false_alert_per_100` faux versets pour 100 attendus à
       l'ancre est une alerte de précision (I3).
    """

    clean_min_recall: float = 0.95
    fail_drop_points: float = 15.0
    robust_drop_points: float = 5.0
    file_drop_points: float = 10.0
    file_share: float = 0.5
    false_alert_per_100: float = 1.0


DECISION_RULE: Final = DecisionRule()
EPSILON: Final = 1e-9


@dataclass(frozen=True)
class FamilyVerdict:
    family: str
    status: str  # robuste | dégradée | échoue
    clean_recall: float
    anchor_recall: float
    drop_points: float
    files_hurt: int
    files_total: int
    false_per_100: float
    false_alert: bool


def family_verdict(
    family: str,
    clean: Mapping[str, FileScore],
    anchor: Mapping[str, FileScore],
    rule: DecisionRule = DECISION_RULE,
) -> FamilyVerdict:
    if set(clean) != set(anchor):
        raise ValueError("le propre et la condition comparée doivent porter sur les mêmes fichiers")
    clean_total, anchor_total = totals(clean.values()), totals(anchor.values())
    if not clean_total.expected:
        raise ValueError("aucun verset attendu")
    clean_recall = clean_total.recognized / clean_total.expected
    anchor_recall = anchor_total.recognized / anchor_total.expected
    drop = (clean_recall - anchor_recall) * 100
    hurt = sum(
        1
        for name, score in clean.items()
        if ((score.recall or 0.0) - (anchor[name].recall or 0.0)) * 100
        > rule.file_drop_points + EPSILON
    )
    fails = drop > rule.fail_drop_points + EPSILON and hurt >= rule.file_share * len(clean)
    if fails:
        status = "échoue"
    elif drop <= rule.robust_drop_points + EPSILON:
        status = "robuste"
    else:
        status = "dégradée"
    false_per_100 = anchor_total.false_recognized * 100 / anchor_total.expected
    return FamilyVerdict(
        family=family,
        status=status,
        clean_recall=clean_recall,
        anchor_recall=anchor_recall,
        drop_points=drop,
        files_hurt=hurt,
        files_total=len(clean),
        false_per_100=false_per_100,
        false_alert=false_per_100 > rule.false_alert_per_100 + EPSILON,
    )


@dataclass(frozen=True)
class Decision:
    verdict: str  # justifié | non justifié par les familles obligatoires | non concluant
    failing: tuple[str, ...]
    """Familles obligatoires en échec : les cibles d'un fine-tuning avec dégradations."""
    secondary_failing: tuple[str, ...]
    clean_recall: float
    reason: str


def decide(
    clean: Mapping[str, FileScore],
    verdicts: Mapping[str, FamilyVerdict],
    required: Collection[str] | None = None,
    rule: DecisionRule = DECISION_RULE,
) -> Decision:
    needed = frozenset(required) if required is not None else required_families()
    clean_total = totals(clean.values())
    clean_recall = clean_total.recognized / clean_total.expected if clean_total.expected else 0.0
    if clean_recall + EPSILON < rule.clean_min_recall:
        return Decision(
            "non concluant",
            (),
            (),
            clean_recall,
            f"rappel du propre {clean_recall:.1%} < {rule.clean_min_recall:.0%} : le défaut n'est "
            "pas la dégradation",
        )
    failing = tuple(f for f, v in verdicts.items() if v.status == "échoue" and f in needed)
    secondary = tuple(f for f, v in verdicts.items() if v.status == "échoue" and f not in needed)
    if failing:
        return Decision(
            "justifié", failing, secondary, clean_recall, "famille(s) obligatoire(s) en échec"
        )
    return Decision(
        "non justifié par les familles obligatoires",
        (),
        secondary,
        clean_recall,
        "aucune famille obligatoire n'échoue",
    )


# --- enregistrements d'une mesure et résumés ------------------------------------------------------

SCORE_SCHEMA: Final = "aqr.degradation-score/1"
SCORE_SUFFIX: Final = ".score.json"


@dataclass(frozen=True)
class ScoreRecord:
    """Résultat d'un fichier sous une condition, pour un mode (moteur seul ou cascade)."""

    condition: str
    mode: str
    file: str
    audio_sha256: str
    audio_s: float
    wall_s: float
    score: FileScore
    word_errors: int = 0
    word_total: int = 0
    letter_errors: int = 0
    letter_total: int = 0
    """Erreurs de l'ASR contre le texte du corpus (0/0 : non calculé)."""
    engine: str = ""
    windows: int = 0
    note: str = ""
    """Non vide si le lecteur a refusé la sortie du moteur telle quelle (`parse_for_scoring`)."""

    def to_json(self) -> str:
        document = {
            "schema": SCORE_SCHEMA,
            **{f.name: getattr(self, f.name) for f in fields(self) if f.name != "score"},
            "score": self.score.to_dict(),
        }
        return json.dumps(document, ensure_ascii=False, indent=1) + "\n"

    @classmethod
    def from_json(cls, text: str) -> ScoreRecord:
        data: dict[str, Any] = json.loads(text)
        if data.get("schema") != SCORE_SCHEMA:
            raise ValueError(f"schéma {data.get('schema')!r} non géré (attendu {SCORE_SCHEMA})")
        names = {f.name for f in fields(FileScore)}
        score = FileScore(**{k: v for k, v in data["score"].items() if k in names})
        own = {f.name for f in fields(cls)} - {"score"}
        return cls(score=score, **{k: v for k, v in data.items() if k in own})


def parse_for_scoring(document: Mapping[str, Any]) -> tuple[Recognition, str]:
    """Lit la sortie du moteur pour la noter. Si le lecteur la refuse à cause des champs additifs
    `word_times` (temps au mot, ADR-0010), on les ignore et on le NOTE : le rappel des versets reste
    mesurable, et le défaut du moteur n'est ni caché ni confondu avec une perte de verset. Toute
    autre invalidité reste une erreur."""
    try:
        return parse_recognition(document), ""
    except RecognitionError as exc:
        if "word_times" not in str(exc):
            raise
        stripped = {
            **document,
            "intervals": [
                {k: v for k, v in item.items() if k not in ("word_times", "word_times_source")}
                for item in document.get("intervals", [])
            ],
        }
        return parse_recognition(stripped), f"sortie refusée par le lecteur : {exc}"


def load_scores(root: Path, mode: str) -> dict[str, dict[str, ScoreRecord]]:
    """`<root>/<condition>/<mode>/<fichier>.score.json` -> {condition: {fichier: enregistrement}}"""
    out: dict[str, dict[str, ScoreRecord]] = {}
    for path in sorted(root.glob(f"*/{mode}/*{SCORE_SUFFIX}")):
        record = ScoreRecord.from_json(path.read_text(encoding="utf-8"))
        out.setdefault(record.condition, {})[record.file] = record
    return out


@dataclass(frozen=True)
class ConditionSummary:
    files: int
    score: FileScore
    recall_ci: tuple[float, float]
    per_file_recall: Mapping[str, float]
    wer: float | None
    cer: float | None
    audio_s: float
    wall_s: float

    @property
    def rtf(self) -> float | None:
        return self.wall_s / self.audio_s if self.audio_s else None


def summarize(records: Iterable[ScoreRecord]) -> ConditionSummary:
    items = list(records)
    total = totals(r.score for r in items)
    words = sum(r.word_total for r in items)
    letters = sum(r.letter_total for r in items)
    return ConditionSummary(
        files=len(items),
        score=total,
        recall_ci=wilson_interval(total.recognized, total.expected),
        per_file_recall={r.file: r.score.recall or 0.0 for r in items},
        wer=sum(r.word_errors for r in items) / words if words else None,
        cer=sum(r.letter_errors for r in items) / letters if letters else None,
        audio_s=sum(r.audio_s for r in items),
        wall_s=sum(r.wall_s for r in items),
    )


def ascii_bar(value: float | None, width: int = 20) -> str:
    """Barre de proportion pour les courbes du rapport (`None` : blanc)."""
    if value is None:
        return " " * width
    filled = round(max(0.0, min(1.0, value)) * width)
    return "█" * filled + "░" * (width - filled)
