-- 002 : photo de profil.
--
-- Les octets de la photo (JPEG 256×256 réencodé côté serveur) vivent sur le disque, hors Git :
-- <AQR_REVIEW_DIR>/avatars/<id utilisateur>.jpg. La base ne garde que l'empreinte (SHA-256 tronqué
-- du fichier réencodé) : elle dit s'il y a une photo (NULL = avatar par défaut) et sert de version
-- pour le cache du navigateur — une nouvelle photo change l'empreinte, donc l'adresse de l'image.
ALTER TABLE users ADD COLUMN avatar_hash TEXT;
ALTER TABLE users ADD COLUMN avatar_updated_at TEXT;
