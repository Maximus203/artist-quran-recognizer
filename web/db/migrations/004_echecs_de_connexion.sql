-- 004 : échecs de connexion, gardés en base pour survivre à un redémarrage du serveur.
--
-- Sans cela, redémarrer le serveur remettrait à zéro le verrouillage progressif : il suffirait à un
-- attaquant d'attendre (ou de provoquer) un redémarrage. La clé n'est JAMAIS en clair : c'est
-- l'empreinte SHA-256 de « portée + clé » (adresse IP, pseudonyme), donc la table ne révèle ni
-- une adresse ni un pseudonyme. `last_at` et `locked_until` sont des millisecondes depuis 1970.
CREATE TABLE auth_failures (
  key_hash     TEXT    PRIMARY KEY,
  scope        TEXT    NOT NULL,
  fails        INTEGER NOT NULL,
  last_at      INTEGER NOT NULL,
  locked_until INTEGER NOT NULL
);
CREATE INDEX auth_failures_last ON auth_failures(last_at);
