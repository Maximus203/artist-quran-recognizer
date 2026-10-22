"""Libellés arabes des formules de la prière hors Mushaf (isti'adha, takbir, amin).

Ce ne sont PAS des versets : aucun texte du Coran, aucune référence, aucune traduction. Ils sont
affichés tels quels, comme un libellé (`label_ar` dans `aqr.recognition/1`), jamais présentés comme
le texte du Mushaf (I1, I4). La basmala, elle, est le verset 1:1 : son texte vient du corpus.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Final

from aqr.domain.models import NonQuranKind

FORMULA_LABELS_AR: Final[Mapping[NonQuranKind, str]] = {
    NonQuranKind.ISTIADHA: "أعوذ بالله من الشيطان الرجيم",
    NonQuranKind.TAKBIR: "الله أكبر",
    NonQuranKind.AMIN: "آمين",
}
