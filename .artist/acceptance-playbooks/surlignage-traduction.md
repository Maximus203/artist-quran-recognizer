# Traduction du passage et surlignage en direct (interface `web/`)

Surface : carte « Passage actif » de l'atelier. Données : champs additifs `word_times`, `word_times_source`,
`translation.segments`, `translation.fragment`, `translation.scope` (contrat de sortie : `docs/RECOGNIZE-OUTPUT.md`).
Fixtures : `web/lib/__fixtures__/hud-11-61.ts` (intervalles 3 → 4 de la session « Hud 11:61–90 »).
Mobile d'abord (375 px), puis 1440 px.

## Must-pass

- `scope: "fragment"` : la carte n'affiche que `translation.fragment.text`, avec « … » discrets selon
  `ellipsis_before` / `ellipsis_after` et le sous-titre « Traduction du passage (mots a–b) » ; la mention
  « Découpage approximatif » apparaît si `approximate`.
- `scope: "verse"` ou champs absents (ancien résultat) : traduction entière et étiquette « Traduction du verset
  entier » (comportement d'avant).
- Reprise dans un même verset (11:61, 35,7–48,1 s `[10,17]` puis 55,1–78,0 s `[15,23]` `repetition: true`) : le temps
  revient en arrière → la carte change d'intervalle et la traduction repart à « De la terre… », pas au début du
  verset.
- Lecture : le mot arabe en cours porte `aria-current="true"` (fond + trait) et le segment de traduction qui le
  contient aussi ; un seek, une boucle ou une reprise recale le surlignage sans retard visible.
- Entre deux mots, le dernier mot dit reste marqué ; en pause, le dernier mot reste marqué ; entre deux passages
  (aucun verset à cet instant) rien n'est marqué.
- À l'arrêt, un clic sur un mot arabe place le lecteur au début de ce mot et la carte reste sur le même passage.
- Interrupteur « Surligner en direct » : coupé → plus aucun `aria-current` ; la valeur est enregistrée côté serveur
  (`GET /api/me/preferences` → `liveHighlight`), défaut `true`, retrouvée après rechargement.
- Texte intact : le texte arabe affiché est exactement `text` (corpus), la traduction exactement celle reçue
  (les « … » sont hors du texte et `aria-hidden`).
- `word_times_source: "interpolated"` : la note « Surlignage estimé » est affichée.
- 375 px : aucun scroll horizontal, zones tactiles inchangées.

## Must-fail

- Sans `word_times` valides (absents, nombre de couples ≠ nombre de mots, bornes non finies ou inversées, débuts qui
  reculent) : aucun mot surligné, jamais un mot deviné ; le passage entier est teinté en lecture seulement.
- Texte arabe dont le nombre de mots ne correspond pas à `words` : aucun mot surligné.
- Segments qui ne recomposent pas le fragment (ou le verset) : aucun segment surligné, le texte reçu est montré en un
  seul morceau.
- Un champ de découpage mal formé ne rend pas la session illisible : il retombe sur « absent ».
- Un clic sur un mot pendant la lecture ou pendant une sélection de texte ne déplace pas le lecteur.
- Aucune annonce de lecteur d'écran à chaque mot (changer `aria-current` n'est pas annoncé).
- `prefers-reduced-motion` : aucune animation de défilement ni transition de teinte.

## Vérification du 22 octobre 2026

- Session « Hud 11:61–90 » (copie de test) enrichie de temps de mots et de segments illustratifs, navigateur
  intégré : lecture réelle de 45,5 s à 64 s (changement d'intervalle 3 → 4, silence sans surlignage, reprise à
  « De la terre »), seek en arrière, clic sur un mot, interrupteur enregistré, 375 px sans débordement.
- Dépend des PR du moteur (`feat/moteur-debut-incertain-temps-au-mot`, `feat/traduction-par-passage`) pour la sortie
  réelle ; non encore fusionnées au moment de cette vérification.
