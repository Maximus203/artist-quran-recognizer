"""LiveConfig : tous les réglages du suivi en direct (ADR-0011). Aucune valeur en dur ailleurs.

Les valeurs par défaut sont des **points de départ de simulation** (décision du mainteneur du
2026-10-23 : `prior` 0,9 et `min_words_lock` 3), pas des seuils calibrés : l'étape 1 les fait varier
et mesure, la calibration se fera sur le split `dev` avec une vérité terrain humaine.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, replace
from typing import Any


def _check_open_unit(name: str, value: float) -> None:
    if not 0.0 < value < 1.0:
        raise ValueError(f"{name} doit être dans ]0, 1[ (reçu {value})")


def _check_unit(name: str, value: float) -> None:
    if not 0.0 <= value <= 1.0:
        raise ValueError(f"{name} doit être dans [0, 1] (reçu {value})")


@dataclass(frozen=True)
class LiveConfig:
    # -- A priori des hypothèses de position (ADR-0011 §2) ---------------------------------
    prior: float = 0.9
    """Masse de la SUITE attendue (verset suivant d'un verset verrouillé)."""
    local_share: float = 0.5
    """Part du reste (`1 - prior`) qui va aux autres débuts de verset de la même sourate
    (répétition, retour en arrière, saut local) ; le reste va au reste du Coran."""
    mid_verse_share: float = 0.2
    """Part de la masse « ailleurs » réservée aux départs en milieu de verset."""
    non_quran_prior: float = 0.1
    """A priori que les mots qui arrivent ne soient pas du Coran (hypothèse de fond)."""

    # -- Modèle d'erreur d'ASR, par mot ------------------------------------------------------
    word_threshold: float = 0.7
    """Similarité de lettres minimale pour que deux mots soient le même (comme le matcher)."""
    word_error: float = 0.15
    """Probabilité qu'un mot attendu soit mal entendu (remplacé par un mot sans rapport)."""
    word_deletion: float = 0.05
    """Probabilité par mot qu'un mot attendu soit avalé (jamais émis par l'ASR)."""
    word_insertion: float = 0.03
    """Probabilité qu'un mot émis par l'ASR n'existe pas dans le texte."""
    max_skip: int = 2
    """Mots attendus consécutifs qu'une hypothèse peut sauter pour retrouver le mot entendu."""

    # -- Naissance et élagage des hypothèses ---------------------------------------------------
    inject_window: int = 3
    """Une hypothèse peut naître sur chacun des N premiers mots d'un passage (le début peut être
    mal entendu ou précédé d'un mot parasite)."""
    max_hypotheses: int = 4000
    prune_ratio: float = 1e-9
    """Une hypothèse plus de 1 / prune_ratio fois moins probable que la meilleure est abandonnée."""
    restart_misses: int = 2
    """Mots consécutifs que la meilleure hypothèse n'explique pas avant de rouvrir un passage."""
    basmala_min_matched: int = 3
    """Mots de la basmala (sur 4) à reconnaître en tête de passage pour l'annoncer."""

    # -- Affichage : candidats ---------------------------------------------------------------------
    candidate_floor: float = 1e-3
    """Posterior minimal d'un verset pour compter comme candidat plausible."""
    max_items: int = 5
    """Candidats détaillés dans un message (le nombre total est donné à part)."""

    # -- Règle de verrou (ADR-0011 §3) ------------------------------------------------------------
    tau_lock: float = 0.98
    """Posterior à atteindre pour verrouiller un verset."""
    min_words_lock: int = 3
    """Mots entendus minimum pour verrouiller, QUEL QUE SOIT le posterior (I3). Un verset plus
    court doit être entendu en entier."""
    words_margin: float = 100.0
    """Rapport de vraisemblance des mots seuls à partir duquel un rival ne départage plus : au
    delà, la référence est déduite du contexte (`INFERRED`), pas des mots (`RECOGNIZED`)."""
    mid_verse_extra_words: int = 2
    """Mots de plus exigés pour verrouiller un passage qui démarre en milieu de verset (ADR-0011
    mesure B : un début en milieu de verset coûte au moins un mot de plus ; une phrase courte et
    unique, comme l'isti'adha qui finit un verset, ne doit pas nommer ce verset)."""
    unlock_floor: float = 0.5
    """Un verrou dont le posterior retombe sous ce seuil est retiré (`Revision`)."""
    context_max_candidates: int = 40
    """Un passage clos resté ambigu transmet sa liste comme contexte jusqu'à ce nombre de candidats
    (refrains : la suite de chacun est attendue) ; au-delà, le contexte est perdu."""

    # -- Saut et perte --------------------------------------------------------------------------
    jump_floor: float = 0.05
    """Posterior de la suite attendue sous lequel le début « casse l'attente » (saut)."""
    min_words_jump: int = 2
    lost_posterior: float = 0.9
    """Posterior de l'hypothèse « pas du Coran » à partir duquel le flux est déclaré perdu."""
    min_words_lost: int = 3
    silence_lost_s: float = 8.0
    """Silence (temps du flux) au bout duquel un passage non verrouillé est abandonné."""

    def __post_init__(self) -> None:
        for name in (
            "prior",
            "word_error",
            "word_deletion",
            "word_insertion",
            "non_quran_prior",
            "word_threshold",
            "jump_floor",
            "lost_posterior",
        ):
            _check_open_unit(name, getattr(self, name))
        for name in ("local_share", "mid_verse_share", "unlock_floor", "candidate_floor"):
            _check_unit(name, getattr(self, name))
        if not 0.5 < self.tau_lock < 1.0:
            raise ValueError(f"tau_lock doit être dans ]0,5 ; 1[ (reçu {self.tau_lock})")
        for name in (
            "min_words_lock",
            "min_words_jump",
            "min_words_lost",
            "inject_window",
            "max_items",
            "restart_misses",
            "max_hypotheses",
            "basmala_min_matched",
            "context_max_candidates",
        ):
            if getattr(self, name) < 1:
                raise ValueError(f"{name} doit être >= 1")
        if self.max_skip < 0 or self.mid_verse_extra_words < 0:
            raise ValueError("max_skip et mid_verse_extra_words doivent être >= 0")
        if self.words_margin < 1 or self.silence_lost_s <= 0 or self.prune_ratio <= 0:
            raise ValueError("words_margin >= 1, silence_lost_s > 0 et prune_ratio > 0 requis")

    def replace(self, **changes: Any) -> LiveConfig:
        return replace(self, **changes)

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)
