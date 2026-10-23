"""Calque de décisions humaines sur une prédiction immuable (ADR-0014)."""

from aqr.decisions.fingerprint import canonical_interval, interval_fingerprint
from aqr.decisions.model import (
    EXCLUDE_REASONS,
    FACTUAL_KINDS,
    KINDS,
    REPORT_KINDS,
    SCHEMA,
    TRANSLATION_SCOPES,
    Consent,
    Decision,
    DecisionsDocument,
    DecisionsError,
    Evidence,
    Target,
    Value,
    parse_decisions,
    parse_value,
)
from aqr.decisions.reconcile import (
    Reconciliation,
    active_decisions,
    decisions_digest,
    reconcile,
    target_key,
)

__all__ = [
    "EXCLUDE_REASONS",
    "FACTUAL_KINDS",
    "KINDS",
    "REPORT_KINDS",
    "SCHEMA",
    "TRANSLATION_SCOPES",
    "Consent",
    "Decision",
    "DecisionsDocument",
    "DecisionsError",
    "Evidence",
    "Reconciliation",
    "Target",
    "Value",
    "active_decisions",
    "canonical_interval",
    "decisions_digest",
    "interval_fingerprint",
    "parse_decisions",
    "parse_value",
    "reconcile",
    "target_key",
]
