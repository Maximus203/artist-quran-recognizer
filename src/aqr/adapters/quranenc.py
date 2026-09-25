"""TranslationRepository (port) sur l'API QuranEnc — cache local par sourate.

Une sourate entière est téléchargée et mise en cache en un seul appel API (le
point d'accès `/translation/sura/<id>/<n>` renvoie tous ses versets d'un coup) :
`get()` sur n'importe quel verset de cette sourate réutilise ensuite le cache,
jamais un nouvel appel réseau. Checksum épinglé par fichier de cache, vérifié à
chaque lecture (F8 : pas de rendu silencieux sur un cache corrompu).
"""

from __future__ import annotations

import json
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from aqr.corpus.checksums import CorpusChecksumError, sha256_of
from aqr.domain.models import VerseRef
from aqr.domain.ports import Translation

QURANENC_SURA_BASE = "https://quranenc.com/api/v1/translation/sura"

# QuranEnc ne renvoie ni attribution ni version dans la réponse par verset : ce
# petit registre les porte, un seul endroit, jamais recopié par appel (I2).
TRANSLATION_METADATA: dict[str, dict[str, str]] = {
    "french_hameedullah": {
        "version": "quranenc.com",
        "attribution": "QuranEnc.com — Muhammad Hamidullah (révision du Complexe du Roi Fahd)",
    },
    "french_rashid": {
        "version": "quranenc.com",
        "attribution": "QuranEnc.com — Rachid Maach",
    },
    "french_montada": {
        "version": "quranenc.com",
        "attribution": "QuranEnc.com — Centre Nûr (Noor International)",
    },
}


def sura_url(translation_id: str, surah: int) -> str:
    return f"{QURANENC_SURA_BASE}/{translation_id}/{surah}"


def parse_sura_response(raw: bytes) -> dict[int, str]:
    """Réponse API d'une sourate -> {numéro de verset: texte de traduction}."""
    payload = json.loads(raw.decode("utf-8"))
    result = payload.get("result")
    if not isinstance(result, list):
        raise CorpusChecksumError(f"réponse QuranEnc inattendue : {payload}")
    return {int(item["aya"]): item["translation"] for item in result}


def fetch_url(url: str) -> bytes:  # pragma: no cover - I/O réseau
    request = urllib.request.Request(
        url, headers={"User-Agent": "artist-quran-recognizer/0.1 (+QuranEncTranslationRepository)"}
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


@dataclass(frozen=True)
class _SuraCache:
    verses: dict[int, str]


class QuranEncTranslationRepository:
    def __init__(self, cache_dir: Path, fetcher: Callable[[str], bytes] = fetch_url) -> None:
        self._cache_dir = cache_dir
        self._fetcher = fetcher
        self._loaded: dict[tuple[str, int], _SuraCache] = {}

    def get(self, ref: VerseRef, translation_id: str) -> Translation:
        if translation_id not in TRANSLATION_METADATA:
            raise ValueError(
                f"translation_id inconnu : {translation_id!r} "
                f"(connus : {sorted(TRANSLATION_METADATA)})"
            )
        sura = self._load_sura(translation_id, ref.surah)
        try:
            text = sura.verses[ref.ayah]
        except KeyError as exc:
            raise CorpusChecksumError(
                f"verset {ref} absent du cache de traduction {translation_id}"
            ) from exc
        meta = TRANSLATION_METADATA[translation_id]
        return Translation(
            ref=ref,
            text=text,
            translation_id=translation_id,
            version=meta["version"],
            attribution=meta["attribution"],
        )

    def _load_sura(self, translation_id: str, surah: int) -> _SuraCache:
        key = (translation_id, surah)
        if key in self._loaded:
            return self._loaded[key]

        sura_dir = self._cache_dir / translation_id
        cache_path = sura_dir / f"{surah}.json"
        checksum_path = sura_dir / f"{surah}.sha256"

        if cache_path.exists() and checksum_path.exists():
            raw = cache_path.read_bytes()
            expected = checksum_path.read_text(encoding="utf-8").strip()
            actual = sha256_of(raw)
            if actual != expected:
                raise CorpusChecksumError(
                    f"checksum invalide pour {cache_path} : attendu {expected}, obtenu {actual} "
                    "(cache corrompu — le supprimer pour forcer un nouveau téléchargement)"
                )
        else:
            sura_dir.mkdir(parents=True, exist_ok=True)
            raw = self._fetcher(sura_url(translation_id, surah))
            cache_path.write_bytes(raw)
            checksum_path.write_text(sha256_of(raw), encoding="utf-8")

        cache = _SuraCache(verses=parse_sura_response(raw))
        self._loaded[key] = cache
        return cache
