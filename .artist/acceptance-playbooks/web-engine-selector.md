# Choix du moteur depuis l'atelier web

## Must-pass

- L'atelier propose FastConformer et Whisper pour le prochain enregistrement micro ou audio importé.
- Le moteur choisi est transmis au lancement, conservé dans la session et visible dans l'atelier.
- Une analyse réelle avec Whisper produit un JSON dont `engine.asr` indique Whisper et garde les abstentions lorsque les versets ne sont pas établis.
- Un résultat existant conserve son moteur et son audio ; changer le choix pour la prochaine analyse ne modifie pas les anciennes sessions.
- Le sélecteur reste utilisable en fenêtre étroite, sans libellé ou bouton coupé.

## Must-fail

- Un moteur inconnu est refusé avant tout lancement, sans repli sur FastConformer.
- Muno Streaming ne peut pas être lancé tant que ses poids protégés ne sont pas disponibles et validés.
- L'absence de correspondance fiable ne crée aucun verset nommé.

## Vérification du 13 octobre 2026

- Build et contrôle TypeScript réussis ; 71 tests web ciblés réussis.
- Essai local de 18 secondes sélectionné avec Whisper : JSON réel, cinq intervalles, quatre abstentions, un passage `non_quran`, aucun verset nommé.
- Contrôle navigateur : choix Whisper et option Muno désactivée visibles ; session et lecteur affichent le moteur réellement utilisé.
