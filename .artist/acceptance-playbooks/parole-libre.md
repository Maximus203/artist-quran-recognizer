# Parole libre : transcription et traduction automatiques hors Coran (ADR-0027)

Fichier `aqr.free-speech/1`, produit par `aqr free-speech RÉSULTAT AUDIO`, lu par l'atelier.

## Must-pass

- Seuls les passages `arabic_speech` et les abstentions `no_candidate` sont transcrits ; `below_threshold`, `empty_transcript`,
  versets incertains, formules, français, silence : jamais.
- Un passage retenu (`withheld`) ne porte aucun texte, seulement sa raison ; un fichier qui en porte un est ignoré en entier par
  le lecteur web.
- Le banc (`scripts/bench_free_speech.py`) présente des versets RECONNUS comme de la parole libre : **zéro** ne ressort traduit.
- Écran de lecture : un passage traduit montre l'étiquette « Parole hors Coran · automatique », la notice, Valider / Rejeter ;
  jamais dans la police du Mushaf, jamais de référence de verset.
- Export vidéo : « Ne pas inclure » par défaut ; « validées » n'inclut que les passages validés ; un passage rejeté n'entre jamais.

## Must-fail

- Aucun texte de parole libre dans `aqr.recognition/1` ; aucune parole libre dans une copie expurgée.
- Une traduction qui dépasse les bornes de longueur, vide, ou une transcription d'une autre langue : retenue.

## Scénarios d'écran (à 375 px et sur bureau)

- Ouvrir une session avec fichier : un passage `no_candidate` traduit s'affiche étiqueté ; Valider change l'état en « Validée ».
- Export vidéo : la liste « Paroles hors Coran » n'apparaît que si le fichier contient un passage traduit.
