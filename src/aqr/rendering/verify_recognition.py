"""Contrôle d'un résultat `aqr.recognition/1` reçu de l'extérieur (import d'un fichier, d'un autre
moteur) avant qu'il soit affiché ou exporté.

Le moteur écrit lui-même le texte arabe qu'il rend, toujours lu dans le corpus (I1), et la
traduction QuranEnc telle que livrée, avec son identifiant, sa version et son attribution (I2). Un
fichier qui arrive du dehors n'a pas cette garantie : il peut contenir un « verset » inventé ou une
traduction retouchée, que l'atelier montrerait puis graverait dans une vidéo comme du Coran. Ce
module relit donc chaque intervalle dans le corpus et dans la source officielle, et ne fait
confiance à aucun texte reçu.

Deux sortes de problèmes, jamais confondues :
- un constat (`findings`) : le fichier contredit le corpus ou QuranEnc (texte différent, verset
  inexistant, libellé inventé…). Le résultat est faux, il est refusé ;
- une traduction invérifiable (`unverifiable`) : la source officielle n'a pas pu être lue (hors
  ligne, cache corrompu, aucune source). Rien n'est prouvé faux, mais rien n'est prouvé juste non
  plus : le résultat n'est pas accepté tant qu'on ne peut pas le vérifier (I3).

Un texte ou une traduction absents ne sont pas une falsification (copie expurgée) : seul ce qui est
présent est contrôlé. Les messages ne recopient jamais le contenu reçu.
"""

from __future__ import annotations

from collections.abc import Collection, Mapping
from dataclasses import dataclass
from typing import Any

from aqr.corpus.checksums import CorpusChecksumError
from aqr.domain.models import NonQuranKind, VerseRef
from aqr.domain.ports import CorpusRepository, Translation, TranslationRepository
from aqr.rendering.formula_labels import FORMULA_LABELS_AR
from aqr.rendering.home_renderer import BASMALA_REF, HomeRenderer


@dataclass(frozen=True)
class Finding:
    """Un écart : intervalle (rang dans `intervals`, None = tout le document), verset, champ."""

    index: int | None
    ref: str | None
    field: str
    message: str


@dataclass(frozen=True)
class Verification:
    checked: int
    findings: tuple[Finding, ...]
    unverifiable: tuple[Finding, ...]

    @property
    def ok(self) -> bool:
        return not self.findings and not self.unverifiable

    @property
    def status(self) -> str:
        if self.findings:
            return "invalid"
        return "unverifiable" if self.unverifiable else "ok"


class _NoTranslations:
    """Source vide pour construire le rendu quand aucune traduction n'est lisible."""

    def get(self, ref: VerseRef, translation_id: str) -> Translation:  # pragma: no cover
        raise OSError("aucune source de traduction")


class _Check:
    def __init__(
        self,
        corpus: CorpusRepository,
        translations: TranslationRepository | None,
        known_ids: Collection[str] | None,
    ) -> None:
        self.corpus = corpus
        self.translations = translations
        self.known_ids = known_ids
        self.renderer = HomeRenderer(corpus, translations or _NoTranslations())
        self.findings: list[Finding] = []
        self.unverifiable: list[Finding] = []
        self.offline = False
        self.checked = 0

    def found(self, index: int | None, ref: str | None, field: str, message: str) -> None:
        self.findings.append(Finding(index, ref, field, message))

    def unproven(self, index: int, ref: str, message: str) -> None:
        self.unverifiable.append(Finding(index, ref, "translation", message))

    # --- intervalles ---------------------------------------------------------------------------

    def interval(self, index: int, item: object) -> None:
        if not isinstance(item, Mapping):
            self.found(index, None, "interval", "Intervalle illisible : un objet est attendu.")
            return
        kind = item.get("kind")
        if kind == "verse":
            self.checked += 1
            self.verse(index, item)
        elif kind == "non_quran":
            self.checked += 1
            self.non_quran(index, item)

    def verse(self, index: int, item: Mapping[str, Any]) -> None:
        raw_ref = item.get("ref")
        has_content = _present(item.get("text")) or isinstance(item.get("translation"), Mapping)
        if raw_ref is None:
            if has_content:
                self.found(index, None, "ref", "Un texte est donné sans référence de verset.")
            return
        ref = self.parse_ref(raw_ref)
        if ref is None:
            self.found(index, str(raw_ref)[:12], "ref", "Ce verset n'existe pas dans le Coran.")
            return
        self.candidates(index, str(ref), item.get("candidates"))
        span = self.span(index, ref, item.get("words"))
        if span is None:
            return
        text = item.get("text")
        if _present(text):
            expected = self.renderer.passage_text(ref, *span)
            if text != expected:
                self.found(
                    index,
                    str(ref),
                    "text",
                    "Le texte arabe ne correspond pas au Mushaf : il n'est pas celui du corpus "
                    "pour ce verset.",
                )
        self.translation(index, ref, item.get("translation"))

    def non_quran(self, index: int, item: Mapping[str, Any]) -> None:
        text, translation = item.get("text"), item.get("translation")
        if item.get("basmala") is True:
            ref = BASMALA_REF
            if _present(text) and text != self.corpus.text(ref):
                self.found(
                    index,
                    str(ref),
                    "text",
                    "Le texte de la basmala ne correspond pas au Mushaf (verset 1:1).",
                )
            self.translation(index, ref, translation)
            return
        if _present(text) or translation is not None:
            self.found(
                index,
                None,
                "text",
                "Une zone non coranique ne porte ni texte du Mushaf ni traduction.",
            )
        label_ar = item.get("label_ar")
        if label_ar is None:
            return
        expected = _formula_label(item.get("label"))
        if expected is None or label_ar != expected:
            self.found(
                index,
                None,
                "label_ar",
                "Le libellé arabe n'est pas celui de la formule déclarée.",
            )

    # --- pièces --------------------------------------------------------------------------------

    @staticmethod
    def parse_ref(value: object) -> VerseRef | None:
        if not isinstance(value, str):
            return None
        try:
            return VerseRef.parse(value)
        except (ValueError, TypeError):
            return None

    def candidates(self, index: int, ref: str, value: object) -> None:
        if value is None:
            return
        listed = value if isinstance(value, list) else [None]
        if any(self.parse_ref(c) is None for c in listed):
            self.found(index, ref, "candidates", "Un verset candidat n'existe pas dans le Coran.")

    def span(self, index: int, ref: VerseRef, words: object) -> tuple[int, int] | None:
        total = len(self.corpus.words(ref))
        if words is None:
            return 1, total
        bounds = _word_bounds(words)
        if bounds is None or not 1 <= bounds[0] <= bounds[1] <= total:
            self.found(
                index,
                str(ref),
                "words",
                f"La plage de mots n'existe pas dans ce verset (il compte {total} mots).",
            )
            return None
        return bounds

    def translation(self, index: int, ref: VerseRef, value: object) -> None:
        if value is None:
            return
        shown = str(ref)
        if not isinstance(value, Mapping):
            self.found(index, shown, "translation", "La traduction est illisible.")
            return
        identifier = value.get("translation_id")
        if not isinstance(identifier, str) or (
            self.known_ids is not None and identifier not in self.known_ids
        ):
            self.found(
                index,
                shown,
                "translation.translation_id",
                "Cette traduction n'est pas une traduction QuranEnc connue.",
            )
            return
        if self.translations is None or self.offline:
            self.unproven(index, shown, "Traduction non vérifiée : aucune source QuranEnc lisible.")
            return
        try:
            official = self.translations.get(ref, identifier)
        except OSError:
            # Le premier échec réseau coupe les suivants : pas un délai par passage.
            self.offline = True
            self.unproven(index, shown, "Traduction non vérifiée : QuranEnc est injoignable.")
            return
        except (CorpusChecksumError, ValueError, KeyError, RuntimeError):
            self.unproven(index, shown, "Traduction non vérifiée : la copie locale est illisible.")
            return
        self.compare(index, shown, value, official)

    def compare(
        self, index: int, shown: str, value: Mapping[str, Any], official: Translation
    ) -> None:
        if value.get("text") != official.text:
            self.found(
                index,
                shown,
                "translation.text",
                "La traduction n'est pas celle de QuranEnc : le texte a été modifié.",
            )
        if value.get("version") != official.version:
            self.found(
                index, shown, "translation.version", "La version de la traduction a été modifiée."
            )
        if value.get("attribution") != official.attribution:
            self.found(
                index,
                shown,
                "translation.attribution",
                "L'attribution de la traduction a été modifiée.",
            )
        segments = value.get("segments")
        if segments is not None and not _slices(segments, official.text):
            self.found(
                index,
                shown,
                "translation.segments",
                "Le découpage de la traduction contient un texte qui n'est pas dans QuranEnc.",
            )
        fragment = value.get("fragment")
        if fragment is not None and not _slices([fragment], official.text):
            self.found(
                index,
                shown,
                "translation.fragment",
                "Le fragment de traduction n'est pas un extrait de QuranEnc.",
            )


def _present(value: object) -> bool:
    return value is not None and value != ""


def _formula_label(label: object) -> str | None:
    if not isinstance(label, str):
        return None
    try:
        return FORMULA_LABELS_AR.get(NonQuranKind(label))
    except ValueError:
        return None


def _word_bounds(words: object) -> tuple[int, int] | None:
    """`[premier, dernier]` de deux entiers (les booléens n'en sont pas), ou None."""
    if not isinstance(words, list | tuple) or len(words) != 2:
        return None
    first, last = words
    if all(isinstance(w, int) and not isinstance(w, bool) for w in (first, last)):
        return first, last
    return None


def _slices(parts: object, official: str) -> bool:
    """Chaque morceau (segment ou fragment) est un extrait contigu du texte officiel."""
    if not isinstance(parts, list):
        return False
    return all(
        isinstance(p, Mapping) and isinstance(p.get("text"), str) and p["text"] in official
        for p in parts
    )


def verify_recognition(
    document: object,
    corpus: CorpusRepository,
    translations: TranslationRepository | None,
    *,
    known_translation_ids: Collection[str] | None = None,
) -> Verification:
    """Relit chaque intervalle de `document` dans le corpus et dans QuranEnc.

    `translations=None` : aucune source (toute traduction présente est « invérifiable »).
    `known_translation_ids` : identifiants QuranEnc acceptés (None = ceux que la source accepte).
    """
    check = _Check(corpus, translations, known_translation_ids)
    intervals = document.get("intervals") if isinstance(document, Mapping) else None
    if not isinstance(intervals, list):
        check.found(None, None, "intervals", "Le résultat ne contient pas de liste d'intervalles.")
    else:
        for index, item in enumerate(intervals):
            check.interval(index, item)
    return Verification(check.checked, tuple(check.findings), tuple(check.unverifiable))
