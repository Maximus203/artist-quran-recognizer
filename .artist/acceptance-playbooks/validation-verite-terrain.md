# Vérité terrain semi-automatique dans l'atelier (étape A, ADR-0006)

## Must-pass

- Sur une session terminée, « Proposer les passages du moteur » crée des passages (≤ 110 s) dont la
  déclaration reprend les versets reconnus/supposés et les formules détectées ; aucun n'est validé d'office.
- « Aligner N passage(s) » aligne tous les passages à aligner en un seul lancement du modèle ; chaque verset
  et chaque formule a un temps et se joue (▶) ; la preuve acoustique est affichée.
- Une déclaration ou une limite modifiée fait repasser le passage « à aligner ».
- « Valider après écoute » n'est possible que sur un passage aligné sans erreur.
- « Écrire dans le manifeste » écrit les seuls passages validés : fenêtres annotées, versets `recognized`,
  formules en `non_quran`, `annotation.by: human`, relecteur anonyme ; `aqr.eval` lit le cas.

## Must-fail

- Un nom de personne comme relecteur est refusé, message lisible (pas de caractères illisibles).
- Un fichier test ou en quarantaine n'est jamais annoté ; un audio absent du manifeste est refusé.
- Une déclaration qui ne tient pas dans le passage donne une erreur sur ce passage seulement.
- Aucune proposition ne remplace un passage déjà aligné ou validé.

## Vérification du 19 octobre 2026 (build de production, RTX 5090, lot1-06, prière, dev)

- Session créée par l'API avec la prédiction FastConformer du 7 octobre (même SHA-256) ; essai sur des
  dossiers temporaires (`AQR_REVIEW_DIR`, `AQR_MANIFEST` = copie du manifeste) : le manifeste du dépôt
  n'a pas été modifié (aucun audio écouté par un humain).
- 34 passages proposés, 34 alignés en ≈ 2 min, 0 erreur ; preuve de −0,71 à 0 (médiane −0,31).
- Déclaration « 21:87 » entier dans un passage coupé avant la fin du verset : preuve −0,71 → −2,42,
  affichée en rouge « la déclaration colle mal » (le verset continue après le passage).
- « amin » déclaré après 1:7 : 1:7 = 31,05–44,25 s, âmîn = 44,25–47,21 s (affiché « non coranique »).
  Preuve −0,31 contre −0,27 sans la formule : à trancher à l'oreille.
- Relecteur « Cherif Diouf » refusé avec un message en UTF-8 lisible ; « essai-agent » accepté : 24 versets,
  fenêtre 11,4–215,7 s, zone `amin` écrite. `evaluate_recognition` lit le cas (22/24 retrouvés par le
  moteur, 0 faux verset) — **chiffres d'essai sans valeur** : la « vérité » n'a pas été écoutée.
- Mode développement (`next dev`) : la page recharge en boucle (Fast Refresh) et ne s'hydrate pas dans le
  navigateur intégré ; le build de production fonctionne. Non diagnostiqué.
