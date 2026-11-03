"""Budget de calcul et mode dégradé du direct (ADR-0011 §7).

Le temps de calcul disponible par bloc décide de ce qui s'exécute. La mesure est le **retard** : le
temps écoulé entre la réception d'un bloc et la fin de son traitement. Trois paliers :

| Palier | Condition | Exécuté |
|---|---|---|
| 1 `ESSENTIAL` | toujours | ASR incrémental + suivi d'hypothèses |
| 2 `ACOUSTIC` | retard < `lag_acoustic_s` | vérification acoustique du verset clos (ADR-0008) |
| 3 `RELISTEN` | retard < `lag_relisten_s` | réécoute par les moteurs secondaires (ADR-0009) |

Règle de sécurité (I3) : quand un palier **branché** est sauté, ou quand même le palier 1 prend du
retard (surcharge), la règle de verrou se durcit (plus de mots, posterior plus haut) ; elle ne
s'assouplit jamais en dessous de la configuration de base. Un retard qui s'installe est toujours
dit (`BudgetChange`), jamais accumulé en silence.

Domaine pur : aucune horloge ici, le retard est donné par l'appelant.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from enum import IntEnum
from typing import Protocol

from aqr.domain.models import Status, VerseRef
from aqr.live.config import LiveConfig


class Tier(IntEnum):
    ESSENTIAL = 1
    ACOUSTIC = 2
    RELISTEN = 3

    @property
    def label(self) -> str:
        return self.name.lower()


@dataclass(frozen=True)
class BudgetConfig:
    lag_acoustic_s: float = 2.0
    """Retard au-delà duquel la vérification acoustique est sautée."""
    lag_relisten_s: float = 0.5
    """Retard au-delà duquel la réécoute est sautée (elle coûte plus : seuil plus bas)."""
    lag_overload_s: float = 5.0
    """Retard au-delà duquel même le palier 1 ne suit plus : surcharge."""
    recover_blocks: int = 3
    """Blocs consécutifs sous un seuil avant de remonter d'un palier (pas de va-et-vient)."""
    report_step_s: float = 5.0
    """Un retard qui continue de croître est redit à chaque fois qu'il gagne ce pas."""
    skipped_extra_words: int = 1
    skipped_tau_lock: float = 0.99
    """Règle de verrou quand un palier branché est sauté."""
    overload_extra_words: int = 2
    overload_tau_lock: float = 0.995
    """Règle de verrou en surcharge."""
    ring_s: float = 120.0
    """Audio gardé EN MÉMOIRE pour les vérifications (jamais écrit, perdu avec le flux)."""

    def __post_init__(self) -> None:
        if not 0 < self.lag_relisten_s < self.lag_acoustic_s < self.lag_overload_s:
            raise ValueError("0 < lag_relisten_s < lag_acoustic_s < lag_overload_s requis")
        if self.recover_blocks < 1:
            raise ValueError("recover_blocks doit être >= 1")
        if self.report_step_s <= 0 or self.ring_s <= 0:
            raise ValueError("report_step_s et ring_s doivent être > 0")
        for name in ("skipped_tau_lock", "overload_tau_lock"):
            if not 0.5 < getattr(self, name) < 1.0:
                raise ValueError(f"{name} doit être dans ]0,5 ; 1[")
        if self.skipped_extra_words < 0 or self.overload_extra_words < 0:
            raise ValueError("les mots supplémentaires doivent être >= 0")
        if (
            self.overload_extra_words < self.skipped_extra_words
            or self.overload_tau_lock < self.skipped_tau_lock
        ):
            raise ValueError("la surcharge ne peut pas être plus lâche qu'un palier sauté")


@dataclass(frozen=True)
class LockRule:
    min_words_lock: int
    tau_lock: float


@dataclass(frozen=True)
class BudgetChange:
    """Le palier ou l'état de surcharge a changé (ou un retard croissant est redit)."""

    tier: Tier
    previous_tier: Tier
    overloaded: bool
    lag_s: float
    skipped: tuple[str, ...]
    """Paliers branchés qui ne tournent pas (de bas en haut)."""
    reason: str  # tier | overload | recovered | lag_growing


class VerseCheck(Protocol):
    """Contrôle d'un verset verrouillé à sa clôture (vérification acoustique, réécoute).

    L'adaptateur concret vient avec la vérification acoustique en direct ; le budget n'en dépend
    que par ce contrat."""

    name: str
    tier: Tier
    """Palier minimal auquel ce contrôle s'exécute."""

    def check(
        self,
        ref: VerseRef,
        status: Status,
        samples: Sequence[float],
        start_s: float,
        end_s: float,
    ) -> CheckVerdict: ...


@dataclass(frozen=True)
class CheckVerdict:
    accepted: bool
    reason: str = ""


class LiveBudget:
    """Un budget par flux. `observe(retard)` après chaque bloc."""

    def __init__(self, config: BudgetConfig | None = None, *, available: Tier = Tier.ESSENTIAL):
        self._config = config or BudgetConfig()
        self._available = available
        self._tier = available
        self._overloaded = False
        self._calm = 0
        self._reported_lag = 0.0

    @property
    def tier(self) -> Tier:
        return self._tier

    @property
    def overloaded(self) -> bool:
        return self._overloaded

    @property
    def available(self) -> Tier:
        return self._available

    def skipped(self) -> tuple[str, ...]:
        return tuple(Tier(t).label for t in range(self._tier + 1, self._available + 1))

    def _raw(self, lag_s: float) -> tuple[Tier, bool]:
        cfg = self._config
        if lag_s < cfg.lag_relisten_s:
            raw = Tier.RELISTEN
        elif lag_s < cfg.lag_acoustic_s:
            raw = Tier.ACOUSTIC
        else:
            raw = Tier.ESSENTIAL
        return min(raw, self._available), lag_s >= cfg.lag_overload_s

    def observe(self, lag_s: float) -> BudgetChange | None:
        if math.isnan(lag_s) or lag_s < 0:
            raise ValueError(f"retard invalide : {lag_s}")
        raw, overload = self._raw(lag_s)
        previous_tier, was_overloaded = self._tier, self._overloaded
        reason = ""
        if raw < self._tier or (overload and not self._overloaded):
            # on dégrade tout de suite
            self._calm = 0
            self._tier = min(self._tier, raw)
            if overload and not self._overloaded:
                self._overloaded = True
                reason = "overload"
            else:
                reason = "tier"
        elif raw > self._tier or (self._overloaded and not overload):
            # on remonte seulement après `recover_blocks` blocs calmes de suite
            self._calm += 1
            if self._calm >= self._config.recover_blocks:
                self._calm = 0
                self._tier = raw
                self._overloaded = overload
                reason = "recovered"
        else:
            self._calm = 0
        degraded = bool(self.skipped()) or self._overloaded
        if not reason:
            step = self._config.report_step_s
            if degraded and lag_s - self._reported_lag >= step:
                reason = "lag_growing"
            else:
                return None
        if not degraded and not (was_overloaded or previous_tier != self._tier):
            return None
        self._reported_lag = lag_s if degraded else 0.0
        return BudgetChange(
            tier=self._tier,
            previous_tier=previous_tier,
            overloaded=self._overloaded,
            lag_s=lag_s,
            skipped=self.skipped(),
            reason=reason,
        )

    def lock_rule(self, base: LiveConfig) -> LockRule:
        """Règle de verrou du moment : celle de la configuration, durcie si un palier branché est
        sauté ou en surcharge. Jamais plus lâche que `base`."""
        cfg = self._config
        words, tau = base.min_words_lock, base.tau_lock
        if self._overloaded:
            words += cfg.overload_extra_words
            tau = max(tau, cfg.overload_tau_lock)
        elif self.skipped():
            words += cfg.skipped_extra_words
            tau = max(tau, cfg.skipped_tau_lock)
        return LockRule(words, tau)
