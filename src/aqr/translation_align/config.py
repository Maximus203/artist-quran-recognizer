"""Réglages du découpage de la traduction en fragments (outillage hors ligne).

Aucune valeur n'est codée ailleurs : le script de construction et les tests lisent cette
configuration, écrite en tête du fichier de données généré (`method`), de sorte qu'un découpage
se relit avec les réglages qui l'ont produit. La précision prime sur la couverture (analogue
d'I3 pour les traductions) : en cas de doute, une frontière est abandonnée et les deux
propositions voisines fusionnent.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, replace


@dataclass(frozen=True)
class TranslationAlignmentConfig:
    # --- propositions françaises candidates -------------------------------------------------
    cut_chars: str = ",;:.!?…"
    """Ponctuation après laquelle une proposition peut s'arrêter (hors parenthèses)."""
    min_clause_tokens: int = 2
    """Une proposition de moins de mots porteurs de sens est fusionnée avec sa voisine."""
    skip_parenthetical: bool = True
    """Les ajouts du traducteur entre parenthèses n'ont pas de mot arabe : ils ne servent pas
    à l'alignement (mais restent dans le texte restitué)."""
    # --- normalisation ----------------------------------------------------------------------
    fr_stem_len: int = 6
    """Troncature des mots français (accents retirés) : « croyants », « croyante » -> « croyan »."""
    arabic_stemming: bool = True
    """Radical léger côté arabe (conjonction, article, pronom suffixe) ; sinon le mot normalisé."""
    min_token_len: int = 2
    """Mots français plus courts (élisions l', d', n'…) ignorés."""
    # --- modèles lexicaux (IBM-1 dans les deux sens, appris sur le Coran entier) ------------
    em_iterations: int = 10
    prob_floor: float = 1e-6
    """Plancher d'une probabilité lexicale : un couple jamais vu coûte, sans être impossible."""
    null_weight: float = 0.1
    """Part de la loi du mot « nul » (mots de liaison sans équivalent) dans la vraisemblance."""
    forward_weight: float = 1.0
    reverse_weight: float = 1.0
    length_weight: float = 2.0
    """Poids du terme de longueur (une proposition française longue : plus de lettres arabes)."""
    length_variance_floor: float = 1.0
    """Plancher de la variance de longueur (par lettre arabe) : un corpus trop régulier ne rend
    pas le terme de longueur infiniment sûr de lui."""
    temperature: float = 4.0
    """Les mots d'une proposition ne sont pas indépendants : la somme de leurs log-vraisemblances
    est trop sûre d'elle. Elle est divisée par cette température avant la normalisation en
    probabilités (réglée en lisant des frontières, pas à l'oreille)."""
    waqf_bonus: float = 1.0
    """Bonus (log) d'une frontière arabe placée après un signe de pause ; malus après « لا »."""
    prior_weight: float = 0.4
    """Poids du prior de frontière arabe (fins et débuts de proposition appris)."""
    prior_verse_ends: bool = False
    """Apprendre le prior aussi sur les fins et débuts de verset (sinon : signes de pause seuls)."""
    prior_smoothing: float = 5.0
    prior_cap: float = 2.5
    # --- décision --------------------------------------------------------------------------
    position_tolerance: int = 1
    """Une frontière entre deux mots voisins d'un mot de liaison se place à un mot près : la
    confiance est la probabilité que la vraie frontière soit à cette distance (en mots) de celle
    retenue, au plus. 0 : exiger la place exacte."""
    min_boundary_confidence: float = 0.95
    """Confiance minimale d'une frontière (probabilité a posteriori, tolérance comprise)."""
    require_direction_agreement: bool = True
    """La frontière doit être la même avec le modèle avant seul, arrière seul et combiné."""
    second_opinion: bool = True
    """Une seconde chaîne, avec une autre normalisation des mots, recalcule le découpage : une
    frontière n'est gardée que si elle y tombe à la tolérance près (les erreurs d'une seule
    normalisation ne passent pas)."""
    soft_min_boundary_confidence: float = 0.6
    """Palier « souple » : les frontières entre ce seuil et `min_boundary_confidence` sont écrites
    dans le fichier avec leur confiance (la valeur de la confiance les distingue des fermes). Le
    moteur ne s'en sert que pour affiner un fragment trop large ; sous 0,6 la mesure sur la
    pseudo-vérité tombe à ~57 % à ±1 mot : rien n'est écrit. Pas de seconde chaîne ni d'accord
    des deux sens pour ces frontières : leur confiance dit déjà ce qu'elles valent."""
    fine_min_boundary_confidence: float = 0.3
    """Palier « fin » : coupures entre ce seuil et `soft_min_boundary_confidence`, sur des
    propositions candidates plus courtes (un seul mot porteur de sens suffit). Écrites avec leur
    confiance, le moteur ne s'en sert que pour partager une proposition entre les cartes d'une
    vidéo d'export (une carte arabe courte ne doit pas afficher la traduction de plusieurs)."""
    fine_min_clause_tokens: int = 1
    second_fr_stem_len: int = 4
    second_arabic_stemming: bool = False
    method: str = "ibm1-bidirectional-clause-dp/4"

    def soft(self) -> TranslationAlignmentConfig:
        """Réglages de la chaîne qui propose les frontières souples (seuil abaissé, sans accord des
        sens ni seconde chaîne)."""
        return replace(
            self,
            min_boundary_confidence=self.soft_min_boundary_confidence,
            require_direction_agreement=False,
            second_opinion=False,
        )

    def fine(self) -> TranslationAlignmentConfig:
        """Réglages de la chaîne qui propose les coupures fines (propositions plus courtes, seuil
        encore abaissé, sans accord des sens ni seconde chaîne)."""
        return replace(
            self,
            min_boundary_confidence=self.fine_min_boundary_confidence,
            min_clause_tokens=self.fine_min_clause_tokens,
            require_direction_agreement=False,
            second_opinion=False,
        )

    def second(self) -> TranslationAlignmentConfig:
        """Réglages de la seconde chaîne : mêmes seuils, autre normalisation des mots."""
        return replace(
            self,
            fr_stem_len=self.second_fr_stem_len,
            arabic_stemming=self.second_arabic_stemming,
        )

    def to_dict(self) -> dict[str, object]:
        return asdict(self)
