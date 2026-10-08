# Revue responsive — correction de la carte d'import

## Intention

La carte d'import et de capture doit rester lisible et utilisable dans tous ses états, de 320 px au grand écran. La capture du 8 octobre montre les contrôles de préécoute alignés sur une seule rangée, des durées qui se chevauchent et un bouton d'analyse sur plusieurs lignes.

## Hypothèse et cause

La classe d'état `recorder-preview` du conteneur entre en collision avec la classe du lecteur interne. Le conteneur reçoit alors `display: flex`. La grille de l'introduction donne aussi trop peu de largeur à la carte d'import lorsque deux colonnes restent affichées.

## Critères d'acceptation

- EX-RESP-01 : en préécoute, en-tête, lecteur, actions et note occupent des rangées distinctes ; les deux temps sont lisibles sans chevauchement.
- EX-RESP-02 : sur 320, 375, 768, 1024 et 1440 px, aucun contenu important ni contrôle ne déborde horizontalement ; aucun bouton ne se découpe en trois lignes.
- EX-RESP-03 : les états initial, demande de permission, enregistrement, préparation, préécoute, erreur et analyse en cours gardent une hiérarchie lisible et des commandes accessibles.
- EX-RESP-04 : l'import, l'analyse réelle, la réécoute et les sessions existantes continuent de fonctionner ; la correction est uniquement visuelle.

## Réalisation

1. Séparer les classes d'état du conteneur et du lecteur, et contraindre chaque rangée de la capture.
2. Donner à la carte d'import une part adaptée de la largeur ; empiler l'introduction lorsque deux colonnes serrent les contrôles.
3. Vérifier les états dans le navigateur à plusieurs tailles, puis les contrôles statiques, les tests et la compilation.
