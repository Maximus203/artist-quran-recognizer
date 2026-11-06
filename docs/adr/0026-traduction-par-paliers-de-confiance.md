# ADR-0026 — La traduction d'un passage partiel se coupe par paliers de confiance

- Statut : **accepté** — retour des testeurs du 2026-11-06 : sur l'écran de lecture de l'atelier, un passage partiel affichait
  encore la traduction du verset entier. Prolonge l'ADR-0012 ; respecte I1, I2 (la traduction n'est que découpée) et I3.

## Contexte

Mesure du 2026-11-06 sur 811 intervalles partiels de 85 sessions de revue (`scripts/measure_translation_segments.py --sessions`) :
41 % de fragments exacts, 35 % approchés, **23 % retombaient sur le verset entier** (12 % : verset à une seule tranche ; 11 % :
fragment trop large). Les frontières du fichier de données ne gardaient que les coupures de confiance ≥ 0,95 ; les propositions
voisines fusionnaient dès qu'une seule était douteuse (ex. 28:77 : 4 phrases en une tranche).

## Décision

1. **Le fichier de données garde deux familles de frontières**, avec leur confiance (déjà stockée) : fermes (≥ 0,95, inchangées) et
   souples (de 0,6 à 0,95, sans seconde chaîne ni accord des sens). Une souple n'est ajoutée que si elle ne déplace aucune ferme et
   garde l'ordre des mots arabes (`merge_soft_cuts`). Méthode `ibm1-bidirectional-clause-dp/3`.
2. **Seuils mesurés** sur la pseudo-vérité (sourates impaires, modèles appris sur les paires) : à ±1 mot, 99,9 % pour ≥ 0,95,
   ~94 % pour 0,8-0,95, ~75 % pour 0,6-0,8, ~57 % sous 0,6. Paliers du moteur : `(0,95 ; 0,8 ; 0,6)`, rien en dessous.
3. **Sélection** (`select_best_fragment`) : un fragment exact au palier le plus sûr l'emporte ; sinon, le palier dont le fragment
   s'écarte le moins de la plage affichée. Un palier souple ne fait que subdiviser le palier sûr : jamais pire qu'avant.
   Le fragment obtenu à un palier souple est `approximate` (l'écran dit « Découpage approximatif »).
4. Les `segments` envoyés à l'écran et à l'export sont les plus fins : le surlignage et la coupe des sous-titres en profitent.

## Résultat mesuré (mêmes 811 intervalles)

Verset entier : 23 % → 12,5 %. Fragment exact : 41 % → 51,8 %. Approché : 35 % → 35,7 %. Versets découpés : 69,5 % → 76,3 % ;
mots arabes dans un verset découpé : 83,8 % → 90,7 %. Reconstitution (I2) : 6 236 / 6 236.

## Limites assumées

- Les ~36 % de fragments approchés restent : une frontière de proposition tombe rarement exactement sur la plage dite. Descendre
  sous la proposition (mots de liaison) exigerait une autre mesure ; un aligneur neuronal hors ligne reste l'étape suivante si besoin.
- 12,5 % de passages gardent le verset entier : verset sans ponctuation exploitable, ou frontières sous 0,6.
- Pseudo-vérité = fins de verset connues ; elle ne dit pas la précision sur une proposition interne. Seuils à revoir à la relecture.
