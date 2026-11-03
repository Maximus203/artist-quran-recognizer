# Playbook — revue responsive

## Must pass

- Ouvrir la page à 320, 375, 768, 1024 et 1440 px : le document ne défile pas horizontalement ; la carte d'import, le lecteur et l'atelier restent accessibles.
- Sur une courte prise micro, vérifier l'état d'enregistrement et sa durée, puis arrêter : la préécoute affiche sa commande, deux temps distincts, une barre de progression, « Recommencer » et « Analyser l'audio » sans chevauchement.
- Réécouter, déplacer la position, recommencer, puis vérifier que la nouvelle prise remplace la première avant analyse.
- Ouvrir une session existante : pistes, verset, panneau de revue et export restent exploitables aux mêmes largeurs.
- Tester l'état de permission refusée ou indisponible : l'erreur est lisible et le bouton de reprise reste accessible.

## Must fail

- Aucun nom de verset ne peut apparaître seulement parce que la capture est en préécoute ; la reconnaissance passe par le moteur réel.
- Aucune prise micro annulée ou recommencée n'est importée dans une session.
- Une durée, un bouton ou un panneau ne doit pas forcer la largeur du document au-delà du viewport.
