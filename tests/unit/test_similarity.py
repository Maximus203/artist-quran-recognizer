from aqr.matching.similarity import word_similarity


def test_identiques():
    assert word_similarity("الله", "الله", 0.7) == 1.0


def test_mots_courts_exigent_l_identite():
    assert word_similarity("من", "مع", 0.7) == 0.0


def test_une_lettre_sur_un_mot_long_reste_proche():
    assert word_similarity("استغفروا", "استغفرو", 0.7) > 0.8


def test_trop_different():
    assert word_similarity("كتاب", "بيت", 0.7) == 0.0


def _reference(a: str, b: str, threshold: float) -> float:
    """Distance d'édition complète, sans arrêt anticipé : la définition."""
    if a == b:
        return 1.0
    longest = max(len(a), len(b))
    allowed = int((1 - threshold) * longest + 1e-9)
    if not allowed or abs(len(a) - len(b)) > allowed:
        return 0.0
    previous = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        current = [i]
        for j, cb in enumerate(b, 1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (ca != cb)))
        previous = current
    similarity = 1 - previous[-1] / longest
    return similarity if similarity >= threshold else 0.0


def test_l_arret_anticipe_donne_exactement_la_meme_similarite():
    import random

    rng = random.Random(11)
    letters = "ابتثجحخد"
    for _ in range(3000):
        a = "".join(rng.choice(letters) for _ in range(rng.randint(1, 10)))
        b = "".join(rng.choice(letters) for _ in range(rng.randint(1, 10)))
        for threshold in (0.6, 0.7, 0.8):
            assert word_similarity(a, b, threshold) == _reference(a, b, threshold)
