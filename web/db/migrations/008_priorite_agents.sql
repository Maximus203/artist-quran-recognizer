-- 008 : ordre de préférence des agents du moteur (premier choix / secours).
--
-- Plus la priorité est petite, plus l'agent est préféré. Un agent de secours n'est servi que si aucun agent
-- préféré n'est en ligne et disponible. Les agents existants gardent leur ordre d'ancienneté (10, 20, 30…).
ALTER TABLE engine_agents ADD COLUMN priority INTEGER NOT NULL DEFAULT 0;
UPDATE engine_agents SET priority = id * 10;
