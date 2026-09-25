# ADR-0003 — Recherche lexicale contrainte, pas de base vectorielle ni de LangChain

- Statut : accepté — 2026-09-25
- Décideur : Cherif Diouf

## Question posée
Faut-il une base de données vectorielle (embeddings) + LangChain pour retrouver les
versets plus vite et sans hallucination ?

## Analyse
| Critère | Base vectorielle + LangChain | Index lexical en mémoire + décodage contraint |
|---|---|---|
| Taille du corpus | 6236 versets, ~78 000 mots : tient en mémoire (quelques Mo) | idem |
| Ce qu'on compare | le **sens** (similarité sémantique) | la **forme** : lettres, mots, ordre |
| Hadith qui paraphrase un verset | proche en sens → **faux positif** (viole I3/I4) | forme différente → rejeté |
| Erreur d'ASR d'une lettre | embedding flou, score imprévisible | n-grammes de caractères : dégradation mesurable |
| Déterminisme / explicabilité | score opaque, dépend du modèle d'embedding | score traçable (quels mots ont été reconnus) |
| Latence | appel au modèle d'embedding + ANN | < 50 ms mesuré, sans GPU |
| Dépendances | LangChain (orchestration de LLM : inutile, il n'y a pas de LLM) | aucune |

## Décision
1. **Pas de base vectorielle, pas de LangChain** dans le pipeline de reconnaissance.
2. Renforcer B6 en **recherche lexicale multi-niveaux** :
   - index **n-grammes de caractères** sur un « squelette » normalisé (rasm) qui absorbe
     les différences d'orthographe Uthmani / imla'i (ex. الكتب / الكتاب, الصلوة / الصلاة) ;
   - index n-grammes de mots en second niveau ;
   - réalignement fin (distance d'édition) pour la plage de mots ;
   - **tests écrits avec la sortie réelle des ASR** (pas avec le texte du corpus lui-même).
3. Ajouter une option de **décodage contraint** en sortie de l'ASR CTC : un lexique/trie
   des séquences coraniques, plus un **chemin « poubelle »** (filler) qui absorbe la
   parole non coranique. L'ASR ne peut alors produire que du Coran exact ou « rien ».
   C'est le vrai levier « zéro hallucination ». Comparé par benchmark à la recherche
   seule.

## Où une base vectorielle aura sa place (hors V1)
Une recherche **thématique** dans les traductions (« versets sur la patience ») pour une
future fonctionnalité produit. C'est un autre cas d'usage, derrière un autre port.

## Conséquences
- Le cœur reste pur, rapide et testable sans GPU.
- La robustesse orthographique devient un critère de test explicite (phase 2 du plan).
