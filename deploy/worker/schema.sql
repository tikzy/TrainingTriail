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

-- Coffre de chiffrement de bout en bout : le worker ne garde QUE le sel
-- (public, il voyage avec les blobs) et le SHA-256 de la clé d'accès dérivée
-- du mot de passe. Ni le mot de passe, ni la clé, ni les données en clair
-- ne sont jamais stockés. Sans clé valide (en-tête X-TT-Key), l'API refuse
-- tout accès aux données dès qu'une ligne existe ici.
CREATE TABLE IF NOT EXISTS auth (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  salt TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT 0
);
