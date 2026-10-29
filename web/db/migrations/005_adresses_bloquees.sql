-- 005 : adresses bloquées par les pièges (honeypots), avec expiration.
--
-- La clé est une empreinte HMAC de l'adresse, jamais l'adresse elle-même : la table ne permet pas de
-- relire qui a été bloqué, seulement de reconnaître une adresse qui se présente. `strikes` compte les
-- passages (le blocage s'allonge à chaque récidive) ; `blocked_until` est en millisecondes depuis 1970.
CREATE TABLE blocked_addresses (
  ip_hash       TEXT    PRIMARY KEY,
  reason        TEXT    NOT NULL,
  strikes       INTEGER NOT NULL,
  first_at      INTEGER NOT NULL,
  last_at       INTEGER NOT NULL,
  blocked_until INTEGER NOT NULL
);
CREATE INDEX blocked_addresses_until ON blocked_addresses(blocked_until);
