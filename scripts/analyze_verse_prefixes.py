#!/usr/bin/env python3
"""Combien de mots faut-il entendre du début d'un verset pour le distinguer des autres ? (ADR-0011)

Analyse du corpus Hafs (Tanzil, jamais redistribué) avec la même normalisation que le matcher
(`normalize_arabic` + dictionnaire Uthmani -> imla'i, basmala du verset 1 retirée du flux). Aucune
écriture de texte coranique : seulement des chiffres et des références `sourate:verset`.

Hypothèse de départ (idéale, à lire comme une BORNE BASSE) : l'ASR entend exactement les mots du
verset. Avec des erreurs d'ASR il faut plus de mots, jamais moins.

Mesures
  A. Préfixe de début de verset : plus petit k tel qu'aucun AUTRE verset ne commence par les
     mêmes k mots (et, séparément, les mêmes k premières lettres).
  B. Idem « n'importe où » : aucun autre endroit du Coran (n'importe quel mot de départ, dans un
     verset) ne commence par ces k mots — cas d'un passage qui démarre en milieu de verset.
  C. Avec l'a priori « suite attendue » : le verset N+1 du précédent est en concurrence avec
       - ses rivaux de la même sourate (répétition, retour en arrière) ;
       - tous les versets, par une règle de Bayes à deux niveaux (a priori de continuation `prior` ;
         le reste de la masse part pour moitié vers les autres versets de la sourate, pour moitié
         vers le reste du Coran), jusqu'à un posterior >= `tau`.
     `prior` et `tau` sont des paramètres de SIMULATION, pas des seuils calibrés.
  D. Après une basmala entendue : seuls les premiers versets des sourates (et 1:2) restent.

Usage :
    python scripts/analyze_verse_prefixes.py --corpus data/corpus [--json sortie.json]
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from collections import Counter, defaultdict
from collections.abc import Hashable, Iterable, Sequence
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if (ROOT / "src").is_dir() and str(ROOT / "src") not in sys.path:
    sys.path.insert(0, str(ROOT / "src"))

# Les fonctions pures de préfixe vivent avec le suivi en direct (ADR-0011) : une seule définition.
from aqr.live.prefix_index import (  # noqa: E402
    Discrimination,
    common_prefix_length,
    discriminating_lengths,
)

__all__ = ["Discrimination", "common_prefix_length", "discriminating_lengths"]

DEFAULT_PRIORS = (0.8, 0.9, 0.95)
DEFAULT_TAUS = (0.95, 0.99)
DEFAULT_SAME_SURAH_SHARE = 0.5  # part de la masse de saut qui reste dans la sourate
MAX_BAYES_WORDS = 12  # au-delà, on cesse de compter (le posterior sature bien avant)
SHARED_START_WORDS = (2, 3, 4, 5)


# --------------------------------------------------------------------------- logique pure
def summarize(values: Sequence[int]) -> dict[str, float | int | None]:
    """Médiane, p90 (rang le plus proche), maximum et moyenne ; None si vide."""
    if not values:
        return {"count": 0, "median": None, "p90": None, "max": None, "mean": None}
    ordered = sorted(values)
    n = len(ordered)
    median = ordered[n // 2] if n % 2 else (ordered[n // 2 - 1] + ordered[n // 2]) / 2
    p90 = ordered[min(n - 1, math.ceil(0.9 * n) - 1)]
    return {
        "count": n,
        "median": median,
        "p90": p90,
        "max": ordered[-1],
        "mean": round(sum(ordered) / n, 2),
    }


def cumulative_share(
    values: Sequence[int], total: int, thresholds: Iterable[int]
) -> dict[int, float]:
    """Part de `total` résolue en au plus k mots, pour chaque k de `thresholds`."""
    return {k: round(sum(1 for v in values if v <= k) / total, 4) for k in thresholds}


def shared_start_groups(
    sequences: dict[Hashable, Sequence[object]], words: int
) -> list[list[Hashable]]:
    """Groupes (taille >= 2) de versets d'au moins `words` mots ayant les mêmes `words` premiers."""
    buckets: dict[tuple[object, ...], list[Hashable]] = defaultdict(list)
    for key, sequence in sequences.items():
        if len(sequence) >= words:
            buckets[tuple(sequence[:words])].append(key)
    groups = [sorted(keys) for keys in buckets.values() if len(keys) >= 2]  # type: ignore[type-var]
    return sorted(groups, key=len, reverse=True)


def twin_groups(sequences: dict[Hashable, Sequence[object]]) -> list[list[Hashable]]:
    """Groupes (taille >= 2) de versets au texte normalisé strictement identique."""
    buckets: dict[tuple[object, ...], list[Hashable]] = defaultdict(list)
    for key, sequence in sequences.items():
        buckets[tuple(sequence)].append(key)
    groups = [sorted(keys) for keys in buckets.values() if len(keys) >= 2]  # type: ignore[type-var]
    return sorted(groups, key=len, reverse=True)


def posterior_continuation(
    prior: float,
    same: tuple[int, int],
    other: tuple[int, int],
    same_share: float = DEFAULT_SAME_SURAH_SHARE,
) -> float:
    """P(suite | k mots entendus), a priori à deux niveaux.

    `same` = (versets de la sourate qui portent ces mots, suite comprise ; versets de la sourate) ;
    `other` = (versets hors sourate qui les portent ; versets hors sourate). La masse de saut
    `1 - prior` va pour `same_share` aux AUTRES versets de la sourate (répétition, retour en
    arrière) et pour le reste, à parts égales, aux versets hors sourate.
    """
    if not 0 < prior < 1 or not 0 <= same_share <= 1:
        raise ValueError("prior doit être dans ]0, 1[ et same_share dans [0, 1]")
    (m_same, n_same), (m_other, n_other) = same, other
    if not 1 <= m_same <= n_same or not 0 <= m_other <= n_other:
        raise ValueError("comptes incohérents")
    if n_same == 1:
        same_share = 0.0  # aucun autre verset dans la sourate : la masse va hors sourate
    rival_same = (m_same - 1) / (n_same - 1) if n_same > 1 else 0.0
    rival_other = m_other / n_other if n_other else 0.0
    rivals_mass = (1 - prior) * (same_share * rival_same + (1 - same_share) * rival_other)
    return prior / (prior + rivals_mass)


def bayes_words_needed(
    prior: float,
    tau: float,
    matching_by_k: Sequence[tuple[tuple[int, int], tuple[int, int]]],
    same_share: float = DEFAULT_SAME_SURAH_SHARE,
) -> int | None:
    """Plus petit k (depuis 1) dont le posterior de la suite atteint `tau`, sinon None.
    `matching_by_k[k-1]` = (`same`, `other`) de `posterior_continuation` à k mots."""
    for k, (same, other) in enumerate(matching_by_k, start=1):
        if posterior_continuation(prior, same, other, same_share) >= tau:
            return k
    return None


def prefix_match_counts(sequences: Iterable[Sequence[object]], max_words: int) -> list[Counter]:
    """counts[k-1][préfixe de k mots] = nombre de séquences qui le portent (k de 1 à max_words)."""
    counts: list[Counter] = [Counter() for _ in range(max_words)]
    for sequence in sequences:
        for k in range(1, min(max_words, len(sequence)) + 1):
            counts[k - 1][tuple(sequence[:k])] += 1
    return counts


def word_end_time(start: float, end: float, word: int, words: int) -> float:
    """Fin estimée du mot `word` (1 à `words`) d'un verset qui occupe [start, end] : débit
    uniforme, approximation grossière (les allongements du tajwid la faussent)."""
    if not 1 <= word <= words:
        raise ValueError("word doit être dans [1, words]")
    return start + (end - start) * word / words


def elapsed_until(
    needed: int | None,
    start: float,
    end: float,
    words: int,
    word_times: Sequence[Sequence[float]] | None = None,
) -> float | None:
    """Secondes écoulées depuis le début du verset quand son `needed`-ième mot est dit : fin mesurée
    du mot si `word_times` couvre tous les mots (ADR-0010), sinon estimation à débit uniforme."""
    if needed is None or needed > words:
        return None
    if word_times is not None and len(word_times) == words:
        return round(float(word_times[needed - 1][1]) - start, 3)
    return round(word_end_time(start, end, needed, words) - start, 3)


def replay_document(
    document: dict,
    flow: dict[object, tuple[str, ...]],
    start_lengths: dict[object, Discrimination],
    rival_lengths: dict[object, Discrimination],
) -> list[dict[str, object]]:
    """Rejoue une sortie `aqr.recognition/1` comme un flux : pour chaque verset reconnu en entier
    (dans les mots du flux), le temps écoulé depuis son début quand il devient unique
    (`t_start`, sans a priori) et quand il l'est face aux seuls rivaux de sa sourate
    (`t_context`, si le verset précédent de la sourate vient d'être reconnu juste avant).
    Un temps vaut None quand aucun préfixe n'est unique."""
    by_pair = {(r.surah, r.ayah): r for r in flow}  # type: ignore[attr-defined]
    rows: list[dict[str, object]] = []
    previous: tuple[int, int] | None = None
    for interval in document.get("intervals", []):
        if interval.get("kind") != "verse" or interval.get("status") != "recognized":
            previous = None
            continue
        surah, ayah = (int(x) for x in interval["ref"].split(":"))
        ref = by_pair.get((surah, ayah))
        t = interval.get("t")
        first, last = interval["words"]
        words = last - first + 1
        usable = ref is not None and t is not None and words == len(flow[ref])
        consecutive = previous == (surah, ayah - 1)
        previous = (surah, ayah)
        if not usable or ref is None or t is None:
            continue
        start, end = float(t[0]), float(t[1])
        measured = interval.get("word_times")

        rows.append(
            {
                "ref": f"{surah}:{ayah}",
                "duration": round(end - start, 3),
                "t_start": elapsed_until(start_lengths[ref].needed, start, end, words, measured),
                "t_context": (
                    elapsed_until(rival_lengths[ref].needed, start, end, words, measured)
                    if consecutive
                    else None
                ),
                "with_context": consecutive,
                "measured_word_times": measured is not None and len(measured) == words,
            }
        )
    return rows


def summarize_replay(rows: Sequence[dict[str, object]]) -> dict[str, object]:
    """Médiane et p90 des temps (s) et de leur part de la durée du verset, par type d'a priori."""

    def stats(key: str, subset: Sequence[dict[str, object]]) -> dict[str, object]:
        times = [float(r[key]) for r in subset if r[key] is not None]  # type: ignore[arg-type]
        shares = [
            float(r[key]) / float(r["duration"])
            for r in subset
            if r[key] is not None and r["duration"]
        ]  # type: ignore[arg-type]
        return {
            "verses": len(subset),
            "unresolved": len(subset) - len(times),
            "seconds": summarize_floats(times),
            "share_of_verse": summarize_floats(shares),
        }

    with_context = [r for r in rows if r["with_context"]]
    return {
        "no_prior": stats("t_start", rows),
        "expected_next": stats("t_context", with_context),
        "verse_duration_s": summarize_floats([float(r["duration"]) for r in rows]),  # type: ignore[arg-type]
    }


def summarize_floats(values: Sequence[float]) -> dict[str, float | None]:
    if not values:
        return {"median": None, "p90": None, "max": None}
    ordered = sorted(values)
    n = len(ordered)
    median = ordered[n // 2] if n % 2 else (ordered[n // 2 - 1] + ordered[n // 2]) / 2
    return {
        "median": round(median, 2),
        "p90": round(ordered[min(n - 1, math.ceil(0.9 * n) - 1)], 2),
        "max": round(ordered[-1], 2),
    }


# ------------------------------------------------------------------------------ corpus
def load_flow_words(corpus_dir: Path) -> dict[object, tuple[str, ...]]:
    """Mots normalisés de chaque verset, comme le matcher (basmala du verset 1 retirée)."""
    from aqr.corpus.imlai_corrections import build_word_corrections, load_simple_clean_words
    from aqr.corpus.tanzil_repository import TanzilCorpusRepository
    from aqr.live.corpus_flow import flow_words, make_skeleton

    corpus = TanzilCorpusRepository(corpus_dir)
    corrections = build_word_corrections(corpus, load_simple_clean_words(corpus_dir))
    flow, _basmala = flow_words(corpus, make_skeleton(corrections))
    return dict(flow)


def _ref_label(ref: object) -> str:
    return f"{ref.surah}:{ref.ayah}"  # type: ignore[attr-defined]


def start_and_rival_lengths(
    flow: dict[object, tuple[str, ...]],
) -> tuple[dict[object, Discrimination], dict[object, Discrimination]]:
    """(préfixe unique face à tous les versets, face aux seuls versets de la même sourate)."""
    refs = sorted(flow, key=lambda r: (r.surah, r.ayah))  # type: ignore[attr-defined]
    everywhere = discriminating_lengths((r, flow[r]) for r in refs)
    per_surah: dict[int, list[object]] = defaultdict(list)
    for r in refs:
        per_surah[r.surah].append(r)  # type: ignore[attr-defined]
    same_surah: dict[object, Discrimination] = {}
    for members in per_surah.values():
        same_surah.update(discriminating_lengths((r, flow[r]) for r in members))  # type: ignore[arg-type]
    return everywhere, same_surah  # type: ignore[return-value]


def analyse(
    flow: dict[object, tuple[str, ...]], priors: Sequence[float], taus: Sequence[float]
) -> dict[str, object]:
    total = len(flow)
    refs = sorted(flow, key=lambda r: (r.surah, r.ayah))  # type: ignore[attr-defined]
    report: dict[str, object] = {
        "verses": total,
        "words_in_flow": sum(len(w) for w in flow.values()),
    }

    # A. début de verset, en mots puis en lettres
    by_words, rival = start_and_rival_lengths(flow)
    by_letters = discriminating_lengths((r, "".join(flow[r])) for r in refs)
    resolved_words = [d.needed for d in by_words.values() if d.needed is not None]
    resolved_letters = [d.needed for d in by_letters.values() if d.needed is not None]
    report["A_start_of_verse"] = {
        "words": summarize(resolved_words),
        "letters": summarize(resolved_letters),
        "resolved_within_words": cumulative_share(resolved_words, total, (1, 2, 3, 4, 5, 6, 8, 10)),
        "no_unique_prefix": {
            "twin": sum(1 for d in by_words.values() if d.blocker == "twin"),
            "prefix_of_longer": sum(
                1 for d in by_words.values() if d.blocker == "prefix_of_longer"
            ),
        },
        "no_unique_prefix_letters": sum(1 for d in by_letters.values() if d.needed is None),
    }
    twins = twin_groups({r: flow[r] for r in refs})
    report["twin_groups"] = {
        "groups": len(twins),
        "verses": sum(len(g) for g in twins),
        "largest_sizes": [len(g) for g in twins[:8]],
        "largest_examples": [[_ref_label(r) for r in g[:4]] for g in twins[:4]],
    }
    report["prefix_of_longer_verses"] = sorted(
        _ref_label(r) for r, d in by_words.items() if d.blocker == "prefix_of_longer"
    )[:12]
    shared: dict[str, object] = {}
    for words in SHARED_START_WORDS:
        groups = shared_start_groups({r: flow[r] for r in refs}, words)
        shared[f">={words}_words"] = {
            "groups": len(groups),
            "verses": sum(len(g) for g in groups),
            "largest_sizes": [len(g) for g in groups[:10]],
            "largest_examples": [[_ref_label(r) for r in g[:3]] for g in groups[:3]],
        }
    report["shared_start"] = shared

    # B. n'importe où : toutes les suffixes de mots de tous les versets
    suffixes = [((r, i), flow[r][i:]) for r in refs for i in range(len(flow[r]))]
    anywhere = discriminating_lengths(suffixes)
    anywhere_at_start = {r: anywhere[(r, 0)] for r in refs if flow[r]}
    resolved_anywhere = [d.needed for d in anywhere_at_start.values() if d.needed is not None]
    report["B_anywhere"] = {
        "words": summarize(resolved_anywhere),
        "resolved_within_words": cumulative_share(
            resolved_anywhere, total, (1, 2, 3, 4, 5, 6, 8, 10)
        ),
        "no_unique_prefix": sum(1 for d in anywhere_at_start.values() if d.needed is None),
    }

    # C. a priori « suite attendue » (verset N+1 du précédent, donc ayah >= 2)
    followers = [r for r in refs if r.ayah >= 2]  # type: ignore[attr-defined]
    per_surah: dict[int, list[object]] = defaultdict(list)
    for r in refs:
        per_surah[r.surah].append(r)  # type: ignore[attr-defined]
    rival_words = [rival[r].needed for r in followers if rival[r].needed is not None]
    counts = prefix_match_counts(flow.values(), MAX_BAYES_WORDS)
    surah_counts = {
        surah: prefix_match_counts((flow[r] for r in per_surah[surah]), MAX_BAYES_WORDS)
        for surah in per_surah
    }
    bayes: dict[str, object] = {}
    for prior in priors:
        for tau in taus:
            needed: list[int] = []
            never = 0
            for r in followers:
                n_same = len(per_surah[r.surah])  # type: ignore[attr-defined]
                evidence = []
                for k in range(1, min(len(flow[r]), MAX_BAYES_WORDS) + 1):
                    prefix = tuple(flow[r][:k])
                    in_surah = surah_counts[r.surah][k - 1][prefix]  # type: ignore[attr-defined]
                    outside = counts[k - 1][prefix] - in_surah
                    evidence.append(((in_surah, n_same), (outside, total - n_same)))
                k = bayes_words_needed(prior, tau, evidence)
                if k is None:
                    never += 1
                else:
                    needed.append(k)
            bayes[f"prior={prior},tau={tau}"] = {
                "words": summarize(needed),
                "resolved_within_words": cumulative_share(needed, len(followers), (1, 2, 3, 4)),
                "never_reaches_tau": never,
            }
    report["C_expected_next"] = {
        "followers": len(followers),
        "same_surah_rivals_words": summarize(rival_words),
        "same_surah_resolved_within_words": cumulative_share(
            rival_words, len(followers), (1, 2, 3, 4, 5)
        ),
        "same_surah_no_unique_prefix": sum(1 for r in followers if rival[r].needed is None),
        "rescued_by_sourate": sum(
            1 for r in followers if by_words[r].needed is None and rival[r].needed is not None
        ),
        "bayes_two_level_jump": bayes,
    }

    # D. après une basmala entendue : 1:2 et les premiers versets des sourates (hors 1 et 9)
    from aqr.domain.models import VerseRef

    after = [VerseRef(1, 2)] + [
        r
        for r in refs
        if r.ayah == 1 and r.surah not in (1, 9)  # type: ignore[attr-defined]
    ]
    after_d = discriminating_lengths((r, flow[r]) for r in after)  # type: ignore[arg-type]
    resolved_after = [d.needed for d in after_d.values() if d.needed is not None]
    report["D_after_basmala"] = {
        "candidates": len(after),
        "words": summarize(resolved_after),
        "no_unique_prefix": sum(1 for d in after_d.values() if d.needed is None),
        "no_unique_prefix_verses": sorted(
            _ref_label(r) for r, d in after_d.items() if d.needed is None
        ),
    }
    return report


# ------------------------------------------------------------------------------- sortie
def _fmt(summary: dict[str, object]) -> str:
    return (
        f"médiane {summary['median']} · p90 {summary['p90']} · max {summary['max']} · "
        f"moyenne {summary['mean']}"
    )


def render_markdown(report: dict[str, object]) -> str:
    a = report["A_start_of_verse"]
    b = report["B_anywhere"]
    c = report["C_expected_next"]
    d = report["D_after_basmala"]
    assert (
        isinstance(a, dict) and isinstance(b, dict) and isinstance(c, dict) and isinstance(d, dict)
    )
    lines = [
        f"Versets : {report['verses']} · mots du flux : {report['words_in_flow']}",
        "",
        "A. Début de verset, tous les autres versets en concurrence",
        f"  mots     : {_fmt(a['words'])}",
        f"  lettres  : {_fmt(a['letters'])}",
        f"  résolus en <= k mots : {a['resolved_within_words']}",
        f"  sans préfixe unique : {a['no_unique_prefix']} "
        f"(lettres : {a['no_unique_prefix_letters']})",
        f"  sosies exacts : {report['twin_groups']}",
        f"  début d'un verset plus long (extraits) : {report['prefix_of_longer_verses']}",
        "  début commun >= k mots :",
    ]
    shared = report["shared_start"]
    assert isinstance(shared, dict)
    for name, group in shared.items():
        lines.append(f"    {name} : {group}")
    lines += [
        "",
        "B. N'importe où dans le Coran (passage qui démarre en milieu de verset)",
        f"  mots : {_fmt(b['words'])}",
        f"  résolus en <= k mots : {b['resolved_within_words']} · "
        f"sans préfixe unique : {b['no_unique_prefix']}",
        "",
        f"C. Suite attendue ({c['followers']} versets de rang >= 2)",
        f"  rivaux de la même sourate : {_fmt(c['same_surah_rivals_words'])}",
        f"  résolus en <= k mots : {c['same_surah_resolved_within_words']} · "
        f"sans préfixe unique : {c['same_surah_no_unique_prefix']}",
    ]
    for name, row in c["bayes_two_level_jump"].items():  # type: ignore[union-attr]
        lines.append(
            f"  Bayes {name} : {_fmt(row['words'])} · <= k mots : {row['resolved_within_words']} "
            f"· jamais : {row['never_reaches_tau']}"
        )
    lines += [
        "",
        f"D. Après une basmala : {d['candidates']} candidats",
        f"  mots : {_fmt(d['words'])} · sans préfixe unique : {d['no_unique_prefix']} "
        f"{d['no_unique_prefix_verses']}",
    ]
    return "\n".join(lines)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawTextHelpFormatter
    )
    parser.add_argument("--corpus", type=Path, default=ROOT / "data" / "corpus")
    parser.add_argument("--json", type=Path, help="écrit aussi le rapport chiffré en JSON")
    parser.add_argument(
        "--prior", type=float, action="append", help="a priori de continuation (répétable)"
    )
    parser.add_argument("--tau", type=float, action="append", help="posterior visé (répétable)")
    parser.add_argument(
        "--replay", type=Path, nargs="+", help="sorties aqr.recognition/1 à rejouer comme un flux"
    )
    args = parser.parse_args(argv)

    flow = load_flow_words(args.corpus)
    report = analyse(flow, tuple(args.prior or DEFAULT_PRIORS), tuple(args.tau or DEFAULT_TAUS))
    print(render_markdown(report))
    if args.replay:
        everywhere, same_surah = start_and_rival_lengths(flow)
        rows: list[dict[str, object]] = []
        for path in args.replay:
            document = json.loads(path.read_text(encoding="utf-8"))
            rows.extend(replay_document(document, flow, everywhere, same_surah))
        report["replay"] = {"files": len(args.replay), **summarize_replay(rows)}
        print("\nRejeu en flux (débit uniforme supposé, mots exacts, sans latence d'ASR) :")
        print(json.dumps(report["replay"], ensure_ascii=False))
    if args.json:
        args.json.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
