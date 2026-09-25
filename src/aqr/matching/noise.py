"""Génération de variantes bruitées d'une requête, pour mesurer la robustesse du
matcher (phase 2, ADR-0003 : bruit de type ASR — erreur de lettre, mot manquant,
mot en trop). Jamais utilisé en production, seulement par les tests et
`scripts/bench_matcher.py`.
"""

from __future__ import annotations

import random

_ARABIC_LETTERS = "ابتثجحخدذرزسشصضطظعغفقكلمنهويءأإؤئ"
_FILLER_WORDS = ("كتاب", "بيت", "رجل", "علم", "سماء", "قلم")


def substitute_one_letter(word: str, rng: random.Random) -> str:
    if not word:
        return word
    idx = rng.randrange(len(word))
    return word[:idx] + rng.choice(_ARABIC_LETTERS) + word[idx + 1 :]


def delete_one_letter(word: str, rng: random.Random) -> str:
    if len(word) <= 1:
        return word
    idx = rng.randrange(len(word))
    return word[:idx] + word[idx + 1 :]


def inject_letter_noise(
    tokens: tuple[str, ...], rng: random.Random, every_n_words: int = 5
) -> tuple[str, ...]:
    """Une erreur de lettre (substitution ou suppression), en moyenne tous les
    `every_n_words` mots — simule une erreur de reconnaissance vocale."""
    result = []
    for tok in tokens:
        if tok and rng.random() < 1 / every_n_words:
            tok = rng.choice((substitute_one_letter, delete_one_letter))(tok, rng)
        result.append(tok)
    return tuple(result)


def drop_random_word(tokens: tuple[str, ...], rng: random.Random) -> tuple[str, ...]:
    """Simule un mot avalé par l'ASR."""
    if len(tokens) <= 1:
        return tokens
    idx = rng.randrange(len(tokens))
    return tokens[:idx] + tokens[idx + 1 :]


def insert_random_word(tokens: tuple[str, ...], rng: random.Random) -> tuple[str, ...]:
    """Simule un mot halluciné par l'ASR."""
    idx = rng.randrange(len(tokens) + 1)
    return (*tokens[:idx], rng.choice(_FILLER_WORDS), *tokens[idx:])
