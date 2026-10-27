-- TrainingTrail — schéma D1 (une seule ligne : l'état complet de l'application).
-- Appliquer :  npx wrangler d1 execute trainingtrail --local  --file=schema.sql
--              npx wrangler d1 execute trainingtrail --remote --file=schema.sql
CREATE TABLE IF NOT EXISTS state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  json TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT 0
);

-- Jeton OAuth Polar AccessLink de l'utilisateur unique (jamais envoyé au navigateur).
-- json : { memberId, accessToken, xUserId, connectedAt, lastSync, pendingState }
CREATE TABLE IF NOT EXISTS polar (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  json TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT 0
);
