# ADR-0015 — Récitation guidée : la sourate est annoncée, le moteur ne cherche que dans celle-ci

- Statut : **accepté** — décision du mainteneur du 2026-10-28.
- Précise : ADR-0011 (détection en direct sans plage déclarée), dont elle ne retire rien : l'écoute classique
  reste telle quelle ; la récitation guidée est une **seconde option**, choisie avant de démarrer.

## Contexte

ADR-0011 cherchait chaque passage dans tout le Coran, sans rien savoir. Sur la voix réelle, le suivi nommait
parfois les bons versets mais en sautait d'autres entre deux versets justes. Le mainteneur a demandé, en plus de
l'écoute classique, un mode où la personne **choisit la sourate qu'elle va réciter** : le moteur n'a alors plus
rien à deviner hors de cette sourate et enchaîne les versets suivants. Cela revient sur « pas de plage
déclarée » (2026-10-23) pour ce mode seulement, par choix explicite de l'utilisateur.

## Décision

- **Protocole** : `START.options.surah` (entier de 1 à 114, absent = écoute classique), `aqr.live/1` inchangé
  pour tout client qui ne l'envoie pas.
- **Moteur** : une sourate annoncée construit (une fois, partagé) un `PrefixIndex` limité à cette sourate
  (`restricted_to_surah`) ; le suivi d'hypothèses, ses a priori (suite attendue, saut local) et le verrou sont
  inchangés, mais ne peuvent plus nommer un verset d'ailleurs. La personne peut commencer à n'importe quel
  verset de la sourate.
- **Réglages** (`LiveConfig.guided()`) : moins de preuves pour nommer un verset de CETTE sourate — 2 mots au lieu
  de 3, densité 0,5 au lieu de 0,9, posterior de verrou 0,95 au lieu de 0,98, a priori de suite 0,97, « pas du
  Coran » 0,03. Valeurs de départ, à recaler par mesure (`scripts/measure_live_guided.py`).
- **Interface** : l'écran « En direct » propose « Récitation guidée » (sélecteur de sourate, requis pour
  démarrer) et « Écoute classique » ; le choix est mémorisé dans le navigateur et figé pendant l'écoute.
- I3 tenu : le mode guidé ne peut jamais nommer un verset hors de la sourate annoncée ; une sourate annoncée à
  tort ne produit aucun verset nommé (mesuré).

## Mesure (vrai moteur, hors temps réel, `scripts/measure_live_guided.py`)

| Audio | Mode | Versets nommés | Sautés | Hors sourate |
|---|---|---|---|---|
| Al-Ikhlas (112), 13 s | classique | 112:1, 112:3, 112:4 | 1 | 0 |
| Al-Ikhlas (112), 13 s | **guidée** | 112:1 à 112:4 | **0** | 0 |
| Hud (11:61 à 11:71), 10 min | classique | 11:61, 64, 66, 67, 69 (5) | 4 | 0 |
| Hud (11:61 à 11:71), 10 min | **guidée** | 11:61 à 11:71 (11, identiques à la référence hors ligne) | **0** | 0 |
| Al-Ikhlas annoncée comme 2 ou 113 (erreur de choix) | guidée | aucun | — | 0 |

Limites : trois audios seulement ; un audio (Ash-Shams, 41 s) n'est entendu par le modèle en continu ni en
classique ni en guidé (pas de mot émis) : ce défaut du modèle de flux n'est pas traité ici. Le mode classique
n'est pas amélioré par cet ADR.
