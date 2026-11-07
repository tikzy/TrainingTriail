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
       DELETE /api/state -> supprime la session (état + traces)
       GET/PUT/DELETE /api/track?id=... -> traces GPS (opaques, chiffrées côté client)
       GET /api/polar/*  -> montre Polar (AccessLink v3), comme le worker Cloudflare
   Multi-sessions : ?user=<slug> sur /api/state et /api/track -> emplacements
   dédiés (data/state_<slug>.json, data/tracks/track_<slug>_<id>.json) ; sans
   user, l'emplacement racine historique est utilisé (rétrocompatible).
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
const STATE_FILE = path.join(DATA_DIR, "state.json"); // session racine (compte principal)
const AUTH_FILE = path.join(DATA_DIR, "auth.json");
const TRACKS_DIR = path.join(DATA_DIR, "tracks");

/* ---- multi-sessions : chaque session a son propre emplacement (?user=<slug>).
       slug vide = emplacement racine historique (state.json / track-<id>.json),
       sinon state_<slug>.json / track_<slug>_<id>.json — aucune migration. ---- */
const USER_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
function checkUser(user) { return typeof user === "string" && (user === "" || USER_RE.test(user)) ? user : null; }
function stateFileFor(user) { return user ? path.join(DATA_DIR, "state_" + user + ".json") : STATE_FILE; }
function trackFileFor(user, id) { return user ? path.join(TRACKS_DIR, "track_" + user + "_" + id + ".json") : path.join(TRACKS_DIR, "track-" + id + ".json"); }

/* snapshot daté de l'état dans sauvegardes/ (backup committable) : une écriture
   par jour et par session, écrasée au fil des PUT du jour */
const BACKUP_DIR = path.join(__dirname, "..", "sauvegardes");
function snapshotState(user, obj) {
  try {
    const day = new Date().toISOString().slice(0, 10);
    const name = "etat-central" + (user ? "-" + user : "") + "-" + day + ".json";
    writeJsonAtomic(path.join(BACKUP_DIR, name), { ok: true, updatedAt: obj.updatedAt || 0, state: obj });
  } catch (e) { /* backup best-effort : ne jamais faire échouer un PUT */ }
}
const MAX_BODY = 8 * 1024 * 1024;  // état (chiffré = ~1,33x le clair)
const MAX_TRACK = 5 * 1024 * 1024; // trace GPS maximale
const MAX_URL = 2048;

/* ---- Polar AccessLink v3 (montre Vantage M3) : mêmes endpoints que le worker
       Cloudflare (deploy/worker/src/worker.js), pour que la synchro Polar
       fonctionne aussi via ce serveur (ex. derrière un tunnel cloudflared).
       Secrets : variables d'environnement POLAR_CLIENT_ID / POLAR_CLIENT_SECRET,
       ou fichier data/polar-secrets.json { "clientId", "clientSecret" } (non
       committé, voir .gitignore). Le jeton utilisateur reste dans
       data/polar.json (non committé) et ne sort jamais du serveur. ---- */
const POLAR_FILE = path.join(DATA_DIR, "polar.json");
const POLAR_SECRETS_FILE = path.join(DATA_DIR, "polar-secrets.json");
const POLAR_AUTH = "https://flow.polar.com/oauth2/authorization";
const POLAR_TOKEN = "https://polarremote.com/v2/oauth2/token";
const POLAR_API = "https://www.polaraccesslink.com/v3";
function polarSecrets() {
  const f = readJson(POLAR_SECRETS_FILE) || {};
  return {
    id: process.env.POLAR_CLIENT_ID || f.clientId || "",
    secret: process.env.POLAR_CLIENT_SECRET || f.clientSecret || ""
  };
}
const polarConfigured = () => { const s = polarSecrets(); return !!(s.id && s.secret); };
const polarLoad = () => readJson(POLAR_FILE);
const polarSave = (obj) => writeJsonAtomic(POLAR_FILE, obj);
/* origine publique : derrière cloudflared, X-Forwarded-Proto + Host donnent
   l'URL https du tunnel ; en LAN direct, http://<ip>:<port> */
function publicOrigin(req) {
  const proto = String(req.headers["x-forwarded-proto"] || "http").split(",")[0].trim();
  return proto + "://" + String(req.headers["host"] || ("localhost:" + PORT));
}
const redirect = (res, to) => send(res, 302, "", null, { Location: to });
/* appel AccessLink authentifié : jeton utilisateur d'abord, puis Basic client
   (certaines ressources v3 sont des ressources client) — la méthode qui
   réussit gagne, sans masquer une erreur 401 du jeton utilisateur */
async function polarApi(pathName, accept) {
  const p = polarLoad();
  if (!p || !p.accessToken) { const e = new Error("montre non connectée"); e.status = 503; throw e; }
  const s = polarSecrets();
  const auths = [
    "Bearer " + p.accessToken,
    "Basic " + Buffer.from(s.id + ":" + s.secret).toString("base64")
  ];
  let saw401 = false, lastOther = null;
  for (const auth of auths) {
    let r;
    try {
      r = await fetch(POLAR_API + pathName, { headers: { Authorization: auth, Accept: accept || "application/json" } });
    } catch (e) { lastOther = lastOther || { status: 502, error: "Polar injoignable" }; continue; }
    if (r.ok) return r;
    if (r.status === 401) saw401 = true;
    else {
      let body = "";
      try { body = (await r.text()).slice(0, 300); } catch (e) { }
      lastOther = { status: 502, error: "Polar a répondu " + r.status + (body ? " : " + body : "") };
    }
  }
  if (lastOther) { const e = new Error(lastOther.error); e.status = lastOther.status; throw e; }
  if (saw401) { const e = new Error("jeton Polar refusé — reconnecte la montre dans Réglages"); e.status = 401; throw e; }
  const e = new Error("Polar injoignable"); e.status = 502; throw e;
}

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".gif": "image/gif",
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
  let urlPath = "/", q;
  try {
    if (req.url.length > MAX_URL) return jerr(res, 414, "URL trop longue");
    q = new URL(req.url, "http://localhost");
    urlPath = q.pathname;
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
      const user = checkUser(q.searchParams.get("user") || "");
      if (user === null) return jerr(res, 400, "user invalide");
      const stateFile = stateFileFor(user);
      const c = checkKey(req);
      if (!c.ok) { noteAuthFailure(req); return jerr(res, 401, "clé d'accès requise"); }
      if (req.method === "GET") {
        const st = readJson(stateFile);
        return send(res, 200, JSON.stringify({ ok: true, updatedAt: (st && st.updatedAt) || 0, state: st }));
      }
      if (req.method === "PUT") {
        try {
          const obj = JSON.parse(await readBody(req, MAX_BODY));
          if (typeof obj !== "object" || obj === null || Array.isArray(obj)) throw new Error("état invalide");
          /* anti-rollback : on refuse une version plus ancienne que celle du serveur */
          const cur = readJson(stateFile);
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
          writeJsonAtomic(stateFile, obj);
          snapshotState(user, obj);
          console.log("[" + new Date().toLocaleTimeString() + "] État enregistré" + (user ? " (session " + user + ")" : "") + " (" + JSON.stringify(obj).length + " octets)");
          return send(res, 200, JSON.stringify({ ok: true, updatedAt: obj.updatedAt || 0 }));
        } catch (e) {
          return jerr(res, 400, e.message);
        }
      }
      if (req.method === "DELETE") {
        /* supprime la session : état + traces GPS déplacés dans data/trash/
           (pas de suppression définitive — récupérable en cas d'erreur) */
        const TRASH = path.join(DATA_DIR, "trash");
        const stamp = Date.now();
        try {
          fs.mkdirSync(TRASH, { recursive: true });
          if (fs.existsSync(stateFile))
            fs.renameSync(stateFile, path.join(TRASH, path.basename(stateFile) + ".deleted-" + stamp));
        } catch (e) { }
        try {
          fs.mkdirSync(TRACKS_DIR, { recursive: true });
          for (const f of fs.readdirSync(TRACKS_DIR)) {
            const mine = user ? f.startsWith("track_" + user + "_") : /^track-\d+\.json$/.test(f);
            if (mine) { try { fs.renameSync(path.join(TRACKS_DIR, f), path.join(TRASH, f + ".deleted-" + stamp)); } catch (e) { } }
          }
        } catch (e) { }
        console.log("[" + new Date().toLocaleTimeString() + "] Session supprimée (corbeille)" + (user ? " (" + user + ")" : ""));
        return send(res, 200, JSON.stringify({ ok: true }));
      }
      return jerr(res, 405, "méthode non autorisée");
    }

    /* traces GPS : opaques pour le serveur (chiffrées côté client quand le coffre est actif) */
    if (urlPath === "/api/track") {
      const id = q.searchParams.get("id");
      const user = checkUser(q.searchParams.get("user") || "");
      if (!id || !/^\d{1,12}$/.test(id)) return jerr(res, 400, "id invalide");
      if (user === null) return jerr(res, 400, "user invalide");
      const c = checkKey(req);
      if (!c.ok) { noteAuthFailure(req); return jerr(res, 401, "clé d'accès requise"); }
      const file = trackFileFor(user, id);
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

    /* ================= Polar AccessLink (montre Vantage M3) =================
       Mêmes routes que le worker (deploy/worker/src/worker.js) : le site appelle
       api/polar/* en relatif, donc la synchro Polar marche aussi via ce serveur
       (cloudflared). Les endpoints de DONNÉES exigent la clé du coffre dès qu'il
       est enregistré ; connect/callback/disconnect restent ouverts (navigation
       navigateur, aucune donnée personnelle). Nécessite Node >= 18 (fetch). */
    if (urlPath.startsWith("/api/polar/")) {
      const sub = urlPath.slice("/api/polar/".length);
      if (!polarConfigured())
        return jerr(res, 503, "Polar non configuré sur le serveur (POLAR_CLIENT_ID / POLAR_CLIENT_SECRET, ou data/polar-secrets.json)");

      if (sub === "status") {
        const p = polarLoad();
        return send(res, 200, JSON.stringify({
          ok: true, configured: true,
          connected: !!(p && p.accessToken),
          xUserId: (p && p.xUserId) || null,
          connectedAt: (p && p.connectedAt) || null,
          lastSync: (p && p.lastSync) || null,
          callback: publicOrigin(req) + "/api/polar/callback"
        }));
      }

      if (sub === "connect") {
        if (typeof fetch !== "function") return jerr(res, 503, "Node >= 18 requis pour la synchro Polar");
        const p = polarLoad() || {};
        p.pendingState = crypto.randomUUID();
        polarSave(p);
        const authUrl = POLAR_AUTH + "?response_type=code" +
          "&client_id=" + encodeURIComponent(polarSecrets().id) +
          "&redirect_uri=" + encodeURIComponent(publicOrigin(req) + "/api/polar/callback") +
          "&scope=accesslink.read_all" +
          "&state=" + encodeURIComponent(p.pendingState);
        return redirect(res, authUrl);
      }

      if (sub === "callback") {
        try {
          const code = q.searchParams.get("code");
          const st = q.searchParams.get("state");
          if (!code) return redirect(res, "/#polar=err");
          const p = polarLoad() || {};
          if (p.pendingState && st !== p.pendingState) return redirect(res, "/#polar=err");
          /* échange du code contre un jeton (Basic client_id:client_secret) */
          const s = polarSecrets();
          const tres = await fetch(POLAR_TOKEN, {
            method: "POST",
            headers: {
              Authorization: "Basic " + Buffer.from(s.id + ":" + s.secret).toString("base64"),
              "Content-Type": "application/x-www-form-urlencoded",
              Accept: "application/json"
            },
            body: "grant_type=authorization_code&code=" + encodeURIComponent(code) +
              "&redirect_uri=" + encodeURIComponent(publicOrigin(req) + "/api/polar/callback")
          });
          if (!tres.ok) return redirect(res, "/#polar=err");
          const tok = await tres.json();
          if (!tok || !tok.access_token) return redirect(res, "/#polar=err");
          /* inscription obligatoire de l'utilisateur AccessLink (409 = déjà inscrit) */
          const reg = await fetch(POLAR_API + "/users", {
            method: "POST",
            headers: { Authorization: "Bearer " + tok.access_token, "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ "member-id": "trainingtrail" })
          });
          if (!reg.ok && reg.status !== 409) return redirect(res, "/#polar=err");
          polarSave({
            memberId: "trainingtrail",
            accessToken: tok.access_token,
            xUserId: tok.x_user_id != null ? tok.x_user_id : (p.xUserId || null),
            connectedAt: Date.now(),
            lastSync: p.lastSync || null,
            pendingState: null
          });
          console.log("[" + new Date().toLocaleTimeString() + "] Montre Polar connectée (jeton enregistré localement)");
          return redirect(res, "/#polar=ok");
        } catch (e) { return redirect(res, "/#polar=err"); }
      }

      if (sub === "disconnect") {
        const p = polarLoad();
        if (p && p.accessToken && p.xUserId != null) {
          try {
            await fetch(POLAR_API + "/users/" + p.xUserId, {
              method: "DELETE",
              headers: { Authorization: "Bearer " + p.accessToken, Accept: "application/json" }
            });
          } catch (e) { }
        }
        try { fs.unlinkSync(POLAR_FILE); } catch (e) { }
        return redirect(res, "/#polar=off");
      }

      /* ---- endpoints de données : clé du coffre requise dès qu'enregistrée ---- */
      const ck = checkKey(req);
      if (!ck.ok) { noteAuthFailure(req); return jerr(res, 401, "clé d'accès requise"); }

      try {
        if (sub === "exercises") {
          const p = polarLoad();
          if (!p || !p.accessToken) return jerr(res, 503, "montre non connectée");
          const seen = {}, list = [];
          let lastErr = null;
          const add = (x) => { if (x && x.id && !seen[x.id]) { seen[x.id] = true; list.push(x); } };
          const addSummary = (x, fallbackId) => {
            if (!x) return;
            if (!x.id && fallbackId != null) x.id = fallbackId;
            add(x);
          };
          /* 1) API moderne : GET /v3/exercises (jeton utilisateur) */
          try {
            const r = await fetch(POLAR_API + "/exercises", {
              headers: { Authorization: "Bearer " + p.accessToken, Accept: "application/json" }
            });
            if (r.ok) {
              const arr = await r.json();
              if (Array.isArray(arr)) arr.forEach(add);
            } else if (r.status !== 401 && r.status !== 404) {
              let body = "";
              try { body = (await r.text()).slice(0, 200); } catch (e) { }
              lastErr = "Polar a répondu " + r.status + " (exercises)" + (body ? " : " + body : "");
            }
          } catch (e) { lastErr = lastErr || "Polar injoignable"; }
          /* 2) API historique (file transactionnelle) : exercices non consommés,
             en particulier antérieurs à la connexion */
          if (p.xUserId != null) {
            try {
              const u = p.xUserId;
              const auth = { Authorization: "Bearer " + p.accessToken, Accept: "application/json" };
              const tres = await fetch(POLAR_API + "/users/" + u + "/exercise-transactions",
                { method: "POST", headers: auth });
              if (tres.ok) {
                const t = await tres.json();
                const tid = t && (t["transaction-id"] != null ? t["transaction-id"]
                  : t["transactionId"] != null ? t["transactionId"]
                  : t["transaction_id"] != null ? t["transaction_id"] : null);
                if (tid != null) {
                  const lres = await fetch(POLAR_API + "/users/" + u + "/exercise-transactions/" + tid, { headers: auth });
                  if (lres.ok) {
                    const data = await lres.json();
                    const ids = data && Array.isArray(data.exercises) ? data.exercises : [];
                    for (const eid of ids) {
                      try {
                        const sres = await fetch(POLAR_API + "/users/" + u + "/exercise-transactions/" + tid +
                          "/exercises/" + eid + "?samples=true&zones=true", { headers: auth });
                        if (!sres.ok) continue;
                        addSummary(await sres.json(), eid);
                      } catch (e) { /* un résumé manquant ne bloque pas les autres */ }
                    }
                  }
                  /* commit systématique : sinon la transaction reste ouverte */
                  try {
                    await fetch(POLAR_API + "/users/" + u + "/exercise-transactions/" + tid,
                      { method: "PUT", headers: auth });
                  } catch (e) { }
                }
              }
            } catch (e) { /* la liste moderne suffit */ }
          }
          /* 3) repli client (Basic) */
          try {
            const s = polarSecrets();
            const r = await fetch(POLAR_API + "/exercises", {
              headers: { Authorization: "Basic " + Buffer.from(s.id + ":" + s.secret).toString("base64"), Accept: "application/json" }
            });
            if (r.ok) {
              const arr = await r.json();
              if (Array.isArray(arr)) arr.forEach(add);
            }
          } catch (e) { }
          if (lastErr && !list.length) return jerr(res, 502, lastErr);
          /* filtre utilisateur : « polar-user » peut être un lien absolu ou un id
             nu ; le filtre ne vide JAMAIS la liste (client mono-utilisateur) */
          const uidOf = (x) => {
            const u = x["polar-user"] != null ? x["polar-user"]
              : x["polar_user"] != null ? x["polar_user"]
              : x["polar-user-id"] != null ? x["polar-user-id"] : null;
            if (u == null) return null;
            const m = String(u).match(/(\d+)\s*$/);
            return m ? m[1] : null;
          };
          const uid = p.xUserId != null ? String(p.xUserId) : null;
          let mine = list;
          if (uid != null) {
            const matching = list.filter(x => { const id = uidOf(x); return id == null || id === uid; });
            if (matching.length) mine = matching;
          }
          p.lastSync = Date.now();
          polarSave(p);
          return send(res, 200, JSON.stringify({ ok: true, exercises: mine, count: mine.length, seen: list.length }));
        }

        /* détail d'un exercice : zones de FC + séries (samples) en ligne */
        if (sub === "exercise") {
          const id = q.searchParams.get("id");
          if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return jerr(res, 400, "id invalide");
          const r = await polarApi("/exercises/" + id + "?samples=true&zones=true");
          const data = await r.json();
          return send(res, 200, JSON.stringify({ ok: true, exercise: data }));
        }

        if (sub === "gpx") {
          const id = q.searchParams.get("id");
          if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return jerr(res, 400, "id invalide");
          const r = await polarApi("/exercises/" + id + "/gpx", "application/gpx+xml");
          return send(res, 200, await r.text(), "application/gpx+xml; charset=utf-8");
        }

        if (sub === "physical-info") {
          const r = await polarApi("/users/physical-info");
          return send(res, 200, JSON.stringify({ ok: true, info: await r.json() }));
        }

        /* sommeil : GET /v3/users/sleep?from=..&to=.. (30 jours max chez Polar) */
        if (sub === "sleep") {
          const from = q.searchParams.get("from"), to = q.searchParams.get("to");
          if (!/^\d{4}-\d{2}-\d{2}$/.test(from || "") || !/^\d{4}-\d{2}-\d{2}$/.test(to || ""))
            return jerr(res, 400, "dates invalides (YYYY-MM-DD)");
          if (Date.parse(to) - Date.parse(from) > 31 * 864e5)
            return jerr(res, 400, "intervalle trop large (max 31 jours)");
          const r = await polarApi("/users/sleep?from=" + from + "&to=" + to);
          const data = await r.json();
          return send(res, 200, JSON.stringify({ ok: true, nights: (data && data.nights) || [] }));
        }

        /* Nightly Recharge : 28 derniers jours */
        if (sub === "recharge") {
          const r = await polarApi("/users/nightly-recharge");
          const data = await r.json();
          return send(res, 200, JSON.stringify({ ok: true, recharges: (data && data.recharges) || (Array.isArray(data) ? data : []) }));
        }

        /* charge cardio quotidienne : 28 derniers jours */
        if (sub === "load") {
          const r = await polarApi("/users/cardio-load");
          const data = await r.json();
          return send(res, 200, JSON.stringify({ ok: true, loads: Array.isArray(data) ? data : [] }));
        }

        return jerr(res, 404, "endpoint Polar inconnu");
      } catch (e) {
        return jerr(res, e.status || 500, e.message || String(e));
      }
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
  if (typeof fetch !== "function")
    console.log("  Polar     : INDISPONIBLE (Node >= 18 requis pour fetch) — synchro montre via le worker uniquement");
  else
    console.log("  Polar     : " + (polarConfigured()
      ? (polarLoad() && polarLoad().accessToken ? "montre connectée" : "configuré, montre non connectée")
      : "non configuré (POLAR_CLIENT_ID / POLAR_CLIENT_SECRET ou data/polar-secrets.json)"));
});
