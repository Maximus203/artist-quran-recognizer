# Choix du moteur depuis l'atelier web

## Must-pass

- L'atelier propose FastConformer, Whisper et Muno Streaming pour le prochain enregistrement micro ou audio importé.
- Le moteur choisi est transmis au lancement, conservé dans la session et visible dans l'atelier.
- Une analyse réelle avec Whisper produit un JSON dont `engine.asr` indique Whisper et garde les abstentions lorsque les versets ne sont pas établis.
- Une analyse réelle avec Muno produit un JSON dont `engine.asr` indique la révision Muno épinglée et garde les abstentions lorsque les versets ne sont pas établis.
- Un résultat existant conserve son moteur et son audio ; changer le choix pour la prochaine analyse ne modifie pas les anciennes sessions.
- Le sélecteur reste utilisable en fenêtre étroite, sans libellé ou bouton coupé.

## Must-fail

- Un moteur inconnu est refusé avant tout lancement, sans repli sur FastConformer.
- L'absence de correspondance fiable ne crée aucun verset nommé.

## Vérification du 13 octobre 2026

- Muno accordé sur Hugging Face ; révision et empreintes des 4 fichiers vérifiées depuis `models/LOCK.json`. Poids et audios restent sous `D:\01-Dev\Data`, hors dépôt.
- Contrat ASR Muno réel sur un extrait Alafasy : 5 tests réussis (transcription non vide, temps bornés/ordonnés, décalage conservé, silence vide, segment hors limites refusé).
- Smoke réel sur les quatre versets de 112, concaténés : Muno nomme correctement 112:3 et 112:4 ; il s'abstient pour 112:1 (score 0,45) et 112:2 (verset très court). Aucun faux verset. Les quatre mots de 112:1 sont bien transcrits, mais le seuil de preuve du matcher reste volontairement conservateur.
- Build Next et typecheck réussis. 44 tests ciblés ASR/sessions réussis. La suite web complète n'est pas verte sous Windows : 11 échecs `spawn EFTYPE` dans les tests qui lancent un script Node comme faux Python et 5 chemins Linux absolus dans `smoke-support.test.mjs` ; 106 tests passent. Ces tests d'environnement échouent aussi indépendamment du choix Muno.
- Contrôle navigateur de la version de test `http://127.0.0.1:3098/` : le sélecteur expose FastConformer, Whisper et Muno Streaming ; l'option est activable. Aucun résultat simulé n'est montré.
- Limite de licence : la NPL-1.1 autorise l'usage local gratuit, mais interdit toute utilisation à but lucratif. Toute exploitation commerciale ou service facturé exige un autre modèle/licence.
