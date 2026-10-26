PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  json TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT 0
);
INSERT INTO "state" ("id","json","updated_at") VALUES(1,'{"start":"2026-10-19","mistral":{"key":"","model":"mistral-small-latest","url":"https://api.mistral.ai"},"lastShoeId":null,"lastWeekView":null,"updatedAt":1793010460968,"done":{},"runs":[],"shoes":[],"extra":[],"moves":{"2-0-2":{"w":2,"d":0},"2-0-1":{"w":2,"d":1}},"seq":1,"chat":[]}',1793010460968);
