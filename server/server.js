#!/usr/bin/env node
"use strict";
/* TrainingTrail — serveur de stockage dynamique (Node pur, aucune dépendance).
   - sert le site (dossier ../site) en HTTP
   - expose une API de stockage central :
       GET  /api/ping   -> { ok: true }
       GET  /api/state  -> { ok, updatedAt, state }
       PUT  /api/state  -> enregistre l'état reçu (JSON) dans data/state.json
   Les données vivent dans data/state.json : elles survivent au cache, aux
   navigateurs et sont partagées par tous les appareils qui se connectent.
   Lancement :  node server/server.js   (PORT par défaut : 8000, sinon $PORT) */

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT ? +process.env.PORT : 8000;
const ROOT = path.join(__dirname, "..", "site");
const DATA_DIR = path.join(__dirname, "data");
const STATE_FILE = path.join(DATA_DIR, "state.json");
const MAX_BODY = 64 * 1024 * 1024;

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8",
  ".pdf": "application/pdf", ".gpx": "application/gpx+xml"
};

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
  catch (e) { return null; }
}
function writeState(obj) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = STATE_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, STATE_FILE); // écriture atomique
}

function send(res, code, body, mime) {
  res.writeHead(code, {
    "Content-Type": mime || "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", c => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error("corps trop volumineux")); req.destroy(); }
      else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function serveStatic(res, urlPath) {
  let p = decodeURIComponent(urlPath);
  if (p === "/" || p === "") p = "/index.html";
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT)) return send(res, 403, '{"ok":false,"error":"interdit"}');
  fs.readFile(file, (err, buf) => {
    if (err) {
      // pour GitHub Pages style, retomber sur index.html sauf fichiers réels manquants
      return send(res, 404, "Fichier introuvable : " + p, "text/plain; charset=utf-8");
    }
    const ext = path.extname(file).toLowerCase();
    send(res, 200, buf, MIME[ext] || "application/octet-stream");
  });
}

const server = http.createServer(async (req, res) => {
  let urlPath = "/";
  try { urlPath = new URL(req.url, "http://localhost").pathname; }
  catch (e) { return send(res, 400, '{"ok":false,"error":"URL invalide"}'); }

  if (urlPath === "/api/ping")
    return send(res, 200, JSON.stringify({ ok: true, app: "trainingtrail-server", version: 1 }));

  if (urlPath === "/api/state") {
    if (req.method === "OPTIONS") return send(res, 204, "");
    if (req.method === "GET") {
      const st = readState();
      return send(res, 200, JSON.stringify({ ok: true, updatedAt: (st && st.updatedAt) || 0, state: st }));
    }
    if (req.method === "PUT") {
      try {
        const obj = JSON.parse(await readBody(req));
        if (typeof obj !== "object" || obj === null || Array.isArray(obj)) throw new Error("état invalide");
        writeState(obj);
        console.log("[" + new Date().toLocaleTimeString() + "] État enregistré (" + JSON.stringify(obj).length + " octets)");
        return send(res, 200, JSON.stringify({ ok: true, updatedAt: obj.updatedAt || 0 }));
      } catch (e) {
        return send(res, 400, JSON.stringify({ ok: false, error: e.message }));
      }
    }
    return send(res, 405, '{"ok":false,"error":"méthode non autorisée"}');
  }

  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, '{"ok":false,"error":"méthode non autorisée"}');
  return serveStatic(res, urlPath);
});

server.listen(PORT, () => {
  console.log("TrainingTrail — serveur dynamique sur http://localhost:" + PORT);
  console.log("  Site      : " + ROOT);
  console.log("  Données   : " + STATE_FILE);
  console.log("  Téléphone : http://<ip-de-l-ordinateur>:" + PORT + " (même réseau Wi-Fi)");
});
