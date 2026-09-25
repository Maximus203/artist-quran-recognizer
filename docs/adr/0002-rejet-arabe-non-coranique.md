# ADR-0002 — Rejet de l'arabe non coranique par double transcription

- Statut : proposé — à valider par le benchmark C09/C10/C11
- Décideur : Cherif Diouf

## Contexte
Un ASR fine-tuné sur le Coran projette tout arabe (hadith, dou'a, khutba) vers le texte
coranique le plus proche : source principale de faux positifs (invariant I3). L'usage cible
inclut des assises et des cours où l'arabe non coranique est fréquent.

## Décision proposée
B5 `QuranicityGate` combine :
1. la divergence entre l'ASR Coran et un ASR généraliste (Whisper large-v3) sur le même segment ;
2. la couverture d'alignement : au moins N mots consécutifs alignés sur un verset avec une
   similarité ≥ seuil ;
3. (optionnel) des indices acoustiques de tartil.

N, le seuil et les poids sont des paramètres calibrés sur le corpus de test, jamais codés en dur.

## Critère d'acceptation
0 faux positif sur les catégories C09 et C10, et rappel ≥ 90 % sur C11 (citations coraniques
à l'intérieur de hadiths).

## Coût
Deux inférences ASR par segment arabe. Acceptable hors temps réel ; à optimiser en V2
(par exemple en ne lançant l'ASR généraliste que si le score de B6 est ambigu).
