#!/usr/bin/env node
"use strict";
/* TrainingTrail — serveur de stockage dynamique (Node pur, aucune dépendance).
   - sert le site (dossier ../site) en HTTP
   - expose une API de stockage central :
       GET  /api/ping   -> { ok, app, version, tracks, auth }
       GET  /api/salt   -> { ok, registered, salt }  (public : le sel n'est pas secret)
       PUT  /api/auth   -> enregistre { salt, keyHash } du coffre (SHA-256 de la
                           clé d'accès — jamais le mot de passe ni la clé)
       GET  /api/state  -> état (blob chiffré {enc,salt,iv,ct} si coffre actif)
       PUT  /api/state  -> enregistre l'état reçu (JSON) dans data/state.json
       GET/PUT/DELETE /api/track?id=... -> traces GPS (opaques, chiffrées côté client)
   Sécurité :
   - chiffrement de bout en bout : le serveur ne voit passer que du chiffré ;
     sans le mot de passe (en-tête X-TT-Key), il refuse tout accès aux données
     dès qu'un coffre est enregistré (comparaison en temps constant du SHA-256)
   - limite de débit par IP (fenêtre glissante) + blocage après échecs répétés
     de clé ; en-têtes de sécurité + CSP ; anti-rollback sur l'état (409)
   Lancement :  node server/server.js   (PORT par défaut : 8000, sinon $PORT) */

const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT ? +process.env.PORT : 8000;
const ROOT = path.join(__dirname, "..", "site");
const DATA_DIR = path.join(__dirname, "data");
const STATE_FILE = path.join(DATA_DIR, "state.json");
const AUTH_FILE = path.join(DATA_DIR, "auth.json");
const TRACKS_DIR = path.join(DATA_DIR, "tracks");
const MAX_BODY = 8 * 1024 * 1024;  // état (chiffré = ~1,33x le clair)
const MAX_TRACK = 5 * 1024 * 1024; // trace GPS maximale
const MAX_URL = 2048;

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8",
  ".pdf": "application/pdf", ".gpx": "application/gpx+xml",
  ".webmanifest": "application/manifest+json"
};

/* ---- en-têtes de sécurité (le site est same-origin : pas de CORS ouvert) ---- */
const SEC_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "geolocation=(self), camera=(), microphone=(), payment=(), usb=()",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: blob:; connect-src 'self' https://api.mistral.ai; " +
    "font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
};

/* ---- coffre : le serveur ne stocke que { salt, keyHash } (SHA-256 de l'apiKey) ---- */
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return null; }
}
function writeJsonAtomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, file); // écriture atomique
}
const loadAuth = () => readJson(AUTH_FILE);
const registered = () => !!(loadAuth() && loadAuth().keyHash);
function sha256b64(s) { return crypto.createHash("sha256").update(String(s), "utf8").digest("base64"); }
function timingSafeEq(a, b) {
  const A = Buffer.from(String(a)), B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}
const KEY_RE = /^[A-Za-z0-9+/]{43}=$/; // b64(32 octets)
/* { ok } : ok = requête autorisée. Pas de coffre enregistré (héritage) = tout passe. */
function checkKey(req) {
  const auth = loadAuth();
  if (!auth || !auth.keyHash) return { ok: true, auth: null };
  const key = req.headers["x-tt-key"];
  if (typeof key !== "string" || !KEY_RE.test(key)) return { ok: false, auth };
  return { ok: timingSafeEq(sha256b64(key), auth.keyHash), auth };
}

/* ---- limite de débit par IP (fenêtre glissante en mémoire) ---- */
const RL = {
  win: 60000,
  maxTotal: 300,  // toutes requêtes confondues
  maxApi: 120,    // /api/*
  maxPut: 30,     // écritures
  failMax: 8,     // échecs de clé avant blocage
  failBlock: 15 * 60000,
  hits: new Map(),  // ip -> { total: [], api: [], put: [] }
  fails: new Map()   // ip -> { n, until }
};
/* derrière le tunnel Cloudflare, l'IP réelle arrive dans CF-Connecting-IP ;
   en accès LAN direct, on retombe sur l'adresse de la socket */
function clientIp(req) {
  const cf = req.headers["cf-connecting-ip"];
  return (typeof cf === "string" && cf.length > 0 && cf.length < 64) ? cf : (req.socket.remoteAddress || "?");
}
function rateLimit(req, urlPath) {
  const k = clientIp(req), now = Date.now();
  const f = RL.fails.get(k);
  if (f && f.until > now) return { blocked: true, retryAfter: Math.ceil((f.until - now) / 1000) };
  let h = RL.hits.get(k);
  if (!h) { h = { total: [], api: [], put: [] }; RL.hits.set(k, h); }
  const push = (arr) => { arr.push(now); const cut = now - RL.win; while (arr.length && arr[0] <= cut) arr.shift(); };
  push(h.total);
  const isApi = urlPath.startsWith("/api/");
  if (isApi) { push(h.api); if (req.method === "PUT" || req.method === "DELETE") push(h.put); }
  if (isApi && h.put.length > RL.maxPut) return { blocked: true, retryAfter: 60, msg: "trop d'écritures" };
  if (isApi && h.api.length > RL.maxApi) return { blocked: true, retryAfter: 60, msg: "trop de requêtes API" };
  if (h.total.length > RL.maxTotal) return { blocked: true, retryAfter: 60, msg: "trop de requêtes" };
  return { blocked: false };
}
function noteAuthFailure(req) {
  const k = clientIp(req);
  const f = RL.fails.get(k) || { n: 0, until: 0 };
  f.n += 1;
  if (f.n >= RL.failMax) { f.until = Date.now() + RL.failBlock; f.n = 0; }
  RL.fails.set(k, f);
}
/* purge périodique des compteurs inactifs */
setInterval(() => {
  const now = Date.now();
  for (const [k, h] of RL.hits)
    if (!h.total.length || now - h.total[h.total.length - 1] > RL.win * 2) RL.hits.delete(k);
  for (const [k, f] of RL.fails) if (f.until < now - RL.failBlock) RL.fails.delete(k);
}, 5 * 60000).unref();

/* ---- réponses ---- */
function send(res, code, body, mime, extra) {
  res.writeHead(code, Object.assign({
    "Content-Type": mime || "application/json; charset=utf-8",
    "Cache-Control": mime && mime.startsWith("text/html") ? "no-cache" : "no-store"
  }, SEC_HEADERS, extra || {}));
  res.end(body);
}
const jerr = (res, code, msg, extra) =>
  send(res, code, JSON.stringify({ ok: false, error: msg }), "application/json; charset=utf-8", extra);

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", c => {
      size += c.length;
      if (size > max) { reject(new Error("corps trop volumineux")); req.destroy(); }
      else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function serveStatic(res, urlPath) {
  if (urlPath.length > MAX_URL) return jerr(res, 414, "URL trop longue");
  let p;
  try { p = decodeURIComponent(urlPath); } catch (e) { return jerr(res, 400, "URL invalide"); }
  if (p.indexOf("\0") >= 0) return jerr(res, 400, "URL invalide");
  if (p === "/" || p === "") p = "/index.html";
  const file = path.normalize(path.join(ROOT, p));
  /* anti-traversée : le fichier doit rester dans ROOT (préfixe + séparateur) */
  const rel = path.relative(ROOT, file);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return jerr(res, 403, "interdit");
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, "Fichier introuvable : " + p, "text/plain; charset=utf-8");
    const ext = path.extname(file).toLowerCase();
    send(res, 200, buf, MIME[ext] || "application/octet-stream");
  });
}

const server = http.createServer(async (req, res) => {
  let urlPath = "/";
  try {
    if (req.url.length > MAX_URL) return jerr(res, 414, "URL trop longue");
    urlPath = new URL(req.url, "http://localhost").pathname;
  } catch (e) { return jerr(res, 400, "URL invalide"); }

  if (urlPath.startsWith("/api/")) {
    /* limite de débit : s'applique à toutes les routes API */
    const rl = rateLimit(req, urlPath);
    if (rl.blocked)
      return jerr(res, 429, rl.msg || "trop de requêtes", { "Retry-After": String(rl.retryAfter || 60) });

    if (urlPath === "/api/ping")
      return send(res, 200, JSON.stringify({ ok: true, app: "trainingtrail-server", version: 1, tracks: true, auth: registered() }));

    if (urlPath === "/api/salt")
      return send(res, 200, JSON.stringify({ ok: true, registered: registered(), salt: (loadAuth() || {}).salt || null }));

    /* enregistrement / changement du coffre : { salt, keyHash } */
    if (urlPath === "/api/auth") {
      if (req.method !== "PUT") return jerr(res, 405, "méthode non autorisée");
      const auth = loadAuth();
      if (auth && auth.keyHash) {
        const c = checkKey(req); // changer exige la clé actuelle
        if (!c.ok) { noteAuthFailure(req); return jerr(res, 401, "clé d'accès invalide"); }
      }
      try {
        const obj = JSON.parse(await readBody(req, 4096));
        const salt = String(obj && obj.salt || ""), keyHash = String(obj && obj.keyHash || "");
        if (!/^[A-Za-z0-9+/]{16,64}={0,2}$/.test(salt) || !KEY_RE.test(keyHash))
          throw new Error("salt/keyHash invalides");
        writeJsonAtomic(AUTH_FILE, { salt, keyHash });
        console.log("[" + new Date().toLocaleTimeString() + "] Coffre enregistré (salt présent, SHA-256 de la clé conservé)");
        return send(res, 200, JSON.stringify({ ok: true }));
      } catch (e) { return jerr(res, 400, e.message); }
    }

    if (urlPath === "/api/state") {
      if (req.method === "OPTIONS") return send(res, 204, "");
      const c = checkKey(req);
      if (!c.ok) { noteAuthFailure(req); return jerr(res, 401, "clé d'accès requise"); }
      if (req.method === "GET") {
        const st = readJson(STATE_FILE);
        return send(res, 200, JSON.stringify({ ok: true, updatedAt: (st && st.updatedAt) || 0, state: st }));
      }
      if (req.method === "PUT") {
        try {
          const obj = JSON.parse(await readBody(req, MAX_BODY));
          if (typeof obj !== "object" || obj === null || Array.isArray(obj)) throw new Error("état invalide");
          /* anti-rollback : on refuse une version plus ancienne que celle du serveur */
          const cur = readJson(STATE_FILE);
          const curUp = cur && typeof cur.updatedAt === "number" ? cur.updatedAt : 0;
          const newUp = typeof obj.updatedAt === "number" ? obj.updatedAt : 0;
          if (newUp < curUp) return jerr(res, 409, "état plus ancien que la copie du serveur");
          /* premier envoi chiffré avec clé valide : le serveur adopte le coffre
             (salt du blob + SHA-256 de la clé reçue) pour bloquer les accès suivants sans clé */
          const auth = loadAuth();
          if (!auth || !auth.keyHash) {
            if (obj.enc === 1 && typeof req.headers["x-tt-key"] === "string" && KEY_RE.test(req.headers["x-tt-key"])) {
              writeJsonAtomic(AUTH_FILE, { salt: String(obj.salt || ""), keyHash: sha256b64(req.headers["x-tt-key"]) });
              console.log("[" + new Date().toLocaleTimeString() + "] Coffre adopté automatiquement (premier état chiffré)");
            }
          }
          writeJsonAtomic(STATE_FILE, obj);
          console.log("[" + new Date().toLocaleTimeString() + "] État enregistré (" + JSON.stringify(obj).length + " octets)");
          return send(res, 200, JSON.stringify({ ok: true, updatedAt: obj.updatedAt || 0 }));
        } catch (e) {
          return jerr(res, 400, e.message);
        }
      }
      return jerr(res, 405, "méthode non autorisée");
    }

    /* traces GPS : opaques pour le serveur (chiffrées côté client quand le coffre est actif) */
    if (urlPath === "/api/track") {
      const id = new URL(req.url, "http://localhost").searchParams.get("id");
      if (!id || !/^\d{1,12}$/.test(id)) return jerr(res, 400, "id invalide");
      const c = checkKey(req);
      if (!c.ok) { noteAuthFailure(req); return jerr(res, 401, "clé d'accès requise"); }
      const file = path.join(TRACKS_DIR, "track-" + id + ".json");
      if (req.method === "PUT") {
        try {
          const body = await readBody(req, MAX_TRACK);
          JSON.parse(body); // refuse tout ce qui n'est pas du JSON valide
          fs.mkdirSync(TRACKS_DIR, { recursive: true });
          fs.writeFileSync(file, body);
          return send(res, 200, JSON.stringify({ ok: true }));
        } catch (e) { return jerr(res, 400, e.message); }
      }
      if (req.method === "GET") {
        try { return send(res, 200, fs.readFileSync(file, "utf8"), "application/json"); }
        catch (e) { return jerr(res, 404, "trace inconnue"); }
      }
      if (req.method === "DELETE") {
        try { fs.unlinkSync(file); } catch (e) { }
        return send(res, 200, JSON.stringify({ ok: true }));
      }
      return jerr(res, 405, "méthode non autorisée");
    }

    return jerr(res, 404, "endpoint inconnu");
  }

  if (req.method !== "GET" && req.method !== "HEAD") return jerr(res, 405, "méthode non autorisée");
  return serveStatic(res, urlPath);
});

/* durcissement HTTP : délais bornés contre les connexions lentes/abandonnées */
server.headersTimeout = 20000;
server.requestTimeout = 120000;
server.keepAliveTimeout = 10000;
server.maxRequestsPerSocket = 1000;

server.listen(PORT, () => {
  console.log("TrainingTrail — serveur dynamique sur http://localhost:" + PORT);
  console.log("  Site      : " + ROOT);
  console.log("  Données   : " + STATE_FILE + (registered() ? " (chiffré côté client, coffre actif)" : ""));
  console.log("  Téléphone : http://<ip-de-l'ordinateur>:" + PORT + " (même réseau Wi-Fi)");
});
