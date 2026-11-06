"""Glossaire des formules religieuses fixes : traduction écrite à la main, jamais d'un modèle.

Un passage qui est EXACTEMENT une de ces formules (après normalisation de l'arabe) reçoit sa
traduction ici, sans passer par le traducteur automatique : les modèles se trompent avec aplomb sur
ce vocabulaire (« رواه البخاري » devenait « Je ne sais pas », ADR-0027). Aucune formule du Coran :
le garde-fou retient avant elle tout passage qui lui ressemble. Correspondance sur le passage
entier uniquement, jamais sur une partie : « فقال عز من قائل » est dans la liste, une phrase qui
le contient non.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Final

from aqr.corpus.normalize import normalize_arabic, tokenize

_ENTRIES: Final[tuple[tuple[str, str], ...]] = (
    ("رواه البخاري", "Rapporté par Al-Boukhari."),
    ("رواه مسلم", "Rapporté par Mouslim."),
    ("متفق عليه", "Sur lequel Al-Boukhari et Mouslim s'accordent."),
    ("رواه الترمذي", "Rapporté par At-Tirmidhi."),
    ("رواه أبو داود", "Rapporté par Abou Daoud."),
    ("رواه النسائي", "Rapporté par An-Nassa'i."),
    ("رواه ابن ماجه", "Rapporté par Ibn Majah."),
    ("رواه أحمد", "Rapporté par Ahmad."),
    ("صلى الله عليه وسلم", "Que la paix et la bénédiction d'Allah soient sur lui."),
    ("عليه الصلاة والسلام", "Que la prière et la paix soient sur lui."),
    ("رضي الله عنه", "Qu'Allah soit satisfait de lui."),
    ("رضي الله عنها", "Qu'Allah soit satisfait d'elle."),
    ("رضي الله عنهم", "Qu'Allah soit satisfait d'eux."),
    ("رحمه الله", "Qu'Allah lui fasse miséricorde."),
    ("سبحانه وتعالى", "Gloire à Lui, le Très-Haut."),
    ("عز وجل", "Le Puissant et Majestueux."),
    ("فقال عز من قائل", "Allah, exalté soit-Il, a dit :"),
    ("قال الله تعالى", "Allah, le Très-Haut, a dit :"),
    ("أما بعد", "Ceci étant dit,"),
    ("الحمد لله", "Louange à Allah."),
    ("سبحان الله", "Gloire à Allah."),
    ("إن شاء الله", "Si Allah le veut."),
    ("بارك الله فيك", "Qu'Allah te bénisse."),
    ("جزاك الله خيرا", "Qu'Allah te récompense en bien."),
)


def _key(words: Sequence[str]) -> tuple[str, ...]:
    return tuple(words)


GLOSSARY: Final[dict[tuple[str, ...], str]] = {
    _key(tokenize(normalize_arabic(arabic))): french for arabic, french in _ENTRIES
}


def glossary_translation(words: Sequence[str]) -> str | None:
    """La traduction fixe du passage s'il est exactement une formule du glossaire, sinon None."""
    return GLOSSARY.get(_key(words))
