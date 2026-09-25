# ADR-0001 — Pas d'entraînement de zéro, pas de LLM génératif

- Statut : accepté — 2026-09-24
- Décideur : Cherif Diouf

## Contexte
Le besoin : localiser dans le temps les versets récités dans un audio quelconque, puis
restituer le texte exact du Mushaf et une traduction officielle.

## Options
1. Entraîner un modèle de zéro. Coût énorme, données insuffisantes, aucun gain vs l'existant.
2. Fine-tuner un LLM arabe (Jais, ALLaM…). Mauvais outil : un LLM *génère*, donc il peut
   altérer un mot ; il ne traite pas l'audio ; il ne localise pas dans le temps.
3. **Assembler des briques : ASR spécialisé Coran → correspondance sur corpus fermé →
   décodage de séquence → consultation de base.**

## Décision
Option 3. Le texte et la traduction sont **consultés, jamais générés** (invariants I1/I2).
Le fine-tuning n'est envisagé **que pour l'ASR**, et seulement sur des conditions où le
benchmark montre un échec (Warsh, bruit de mosquée, voix d'apprenants).

## Conséquences
- L'exactitude du texte rendu est garantie par construction.
- La qualité se joue sur la **localisation** (précision/rappel/frontières) → c'est ce que
  les tests mesurent.
- Chaque brique est remplaçable : on peut changer d'ASR sans toucher au reste.
