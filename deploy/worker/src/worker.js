/* TrainingTrail — Worker Cloudflare + D1 (prototype de stockage central).
   Réimplémente l'API du serveur Node (server/server.js) sans machine dédiée :
     GET  /api/ping   -> { ok, app, version, tracks, auth }
     GET  /api/salt   -> { ok, registered, salt } (public : le sel n'est pas secret)
     PUT  /api/auth   -> enregistre { salt, keyHash } du coffre (SHA-256 de la clé)
     GET  /api/state  -> état (blob chiffré {enc,salt,iv,ct} si coffre actif)
     PUT  /api/state  -> enregistre l'état (JSON) dans D1 (table `state`)
     DELETE /api/state -> supprime la session (D1 + traces R2)
     GET/PUT/DELETE /api/track?id=... -> traces GPS (opaques, chiffrées côté client)
   Multi-sessions : ?user=<slug> sur /api/state et /api/track -> ligne D1 dédiée
   (table `sessions`) et clés R2 dédiées ; sans user, la session racine
   (table `state` id=1, clés "track-<id>") est utilisée (rétrocompatible).
   Tout le reste est servi depuis les fichiers statiques de ../../site
   (liaison ASSETS, voir wrangler.toml). L'app ne change pas : ServerSync
   appelle "api/ping" et "api/state" en relatif, donc same-origin.

   Sécurité :
   - chiffrement de bout en bout : le worker ne voit passer que du chiffré ;
     dès qu'un coffre est enregistré, l'accès aux données exige l'en-tête
     X-TT-Key (comparaison en temps constant du SHA-256 — jamais le mot de
     passe ni la clé ne sont stockés)
   - limitation de débit (liaison native ratelimit si déployée avec wrangler
     >= 4.36, sinon repli en mémoire par isolat) + blocage après échecs de clé
   - en-têtes de sécurité + CSP, anti-rollback sur l'état (409) */

const MAX_BODY = 2 * 1024 * 1024; // limite prototype : au-delà, passer les traces GPX sur R2
const MAX_TRACK = 5 * 1024 * 1024; // trace GPS maximale en R2
const KEY_RE = /^[A-Za-z0-9+/]{43}=$/; // b64(32 octets)

/* ---- multi-sessions : ?user=<slug> -> ligne dédiée (table `sessions`) et
      clés R2 dédiées ; sans user, la session racine (table `state` id=1,
      clés "track-<id>") est utilisée — rétrocompatible, aucune migration. ---- */
const USER_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
function checkUser(u) { return typeof u === "string" && (u === "" || USER_RE.test(u)) ? u : null; }
async function readState(env, user) {
  if (!user) {
    const row = await env.DB.prepare("SELECT json, updated_at AS updatedAt FROM state WHERE id = 1").first();
    return row ? { json: JSON.parse(row.json), updatedAt: row.updatedAt } : null;
  }
  const row = await env.DB.prepare("SELECT json, updated_at AS updatedAt FROM sessions WHERE id = ?").bind(user).first();
  return row ? { json: JSON.parse(row.json), updatedAt: row.updatedAt } : null;
}
async function writeState(env, user, body, updatedAt) {
  if (!user)
    return env.DB.prepare("INSERT INTO state (id, json, updated_at) VALUES (1, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at")
      .bind(body, updatedAt).run();
  return env.DB.prepare("INSERT INTO sessions (id, json, updated_at) VALUES (?, ?, ?) " +
    "ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at")
    .bind(user, body, updatedAt).run();
}
async function deleteState(env, user) {
  if (!user) return env.DB.prepare("DELETE FROM state WHERE id = 1").run();
  return env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(user).run();
}
function trackKey(user, id) { return "track-" + (user ? user + "-" : "") + id; }

/* Polar AccessLink v3 : endpoints OAuth et API (https://www.polar.com/accesslink-api/) */
const POLAR_AUTH = "https://flow.polar.com/oauth2/authorization";
const POLAR_TOKEN = "https://polarremote.com/v2/oauth2/token";
const POLAR_API = "https://www.polaraccesslink.com/v3";

/* en-têtes de sécurité (le site est same-origin : pas de CORS ouvert) */
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

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }, SEC_HEADERS)
  });
}
const jerr = (msg, status, extra) => new Response(JSON.stringify({ ok: false, error: msg }), {
  status: status || 400,
  headers: Object.assign({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, SEC_HEADERS, extra || {})
});

/* ---- limitation de débit ---- */
const RL = { win: 60000, maxApi: 120, maxPut: 30, failMax: 8, failBlock: 15 * 60000 };
const MEM = { hits: new Map(), fails: new Map() }; // repli par isolat (best effort)
function ipKey(request) {
  return request.headers.get("cf-connecting-ip") ||
    (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
}
/* false = à bloquer (429). Liaison native « ratelimit » (wrangler >= 4.36) si
   présente ; sinon fenêtre glissante en mémoire de l'isolat. */
async function rateLimit(request, env) {
  if (env.RATE_LIMITER) {
    try {
      const r = await env.RATE_LIMITER.limit({ key: ipKey(request) });
      if (r && r.success === false) return false;
      return true;
    } catch (e) { /* repli mémoire ci-dessous */ }
  }
  const k = ipKey(request), now = Date.now();
  let h = MEM.hits.get(k);
  if (!h) { h = { api: [], put: [] }; MEM.hits.set(k, h); }
  const push = arr => { arr.push(now); const cut = now - RL.win; while (arr.length && arr[0] <= cut) arr.shift(); };
  push(h.api);
  if (request.method === "PUT" || request.method === "DELETE") push(h.put);
  return h.put.length <= RL.maxPut && h.api.length <= RL.maxApi;
}
function noteAuthFailure(request) {
  const k = ipKey(request), now = Date.now();
  const f = MEM.fails.get(k) || { n: 0, until: 0 };
  if (f.until > now) return;
  f.n += 1;
  if (f.n >= RL.failMax) { f.until = now + RL.failBlock; f.n = 0; }
  MEM.fails.set(k, f);
}
function authLocked(request) {
  const f = MEM.fails.get(ipKey(request));
  return !!(f && f.until > Date.now());
}

/* ---- coffre : D1 ne stocke que { salt, key_hash } (SHA-256 de l'apiKey) ---- */
async function loadAuth(env) {
  try {
    const row = await env.DB.prepare("SELECT salt, key_hash FROM auth WHERE id = 1").first();
    return row || null;
  } catch (e) { return null; }
}
async function sha256b64(s) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  let bin = "";
  for (let i = 0; i < h.length; i++) bin += String.fromCharCode(h[i]);
  return btoa(bin);
}
function fixedEq(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}
/* { ok, registered } : pas de coffre enregistré (héritage) = tout passe */
async function checkKey(request, env) {
  const auth = await loadAuth(env);
  if (!auth || !auth.key_hash) return { ok: true, registered: false };
  const key = request.headers.get("x-tt-key") || "";
  if (!KEY_RE.test(key)) return { ok: false, registered: true };
  return { ok: fixedEq(await sha256b64(key), auth.key_hash), registered: true };
}

export default {
  async fetch(request, env) {
    let url;
    try { url = new URL(request.url); }
    catch (e) { return jerr("URL invalide", 400); }

    if (url.pathname === "/api/ping") {
      const auth = await loadAuth(env);
      return json({ ok: true, app: "trainingtrail-worker", version: 1, tracks: !!env.TRACKS, auth: !!(auth && auth.key_hash) });
    }

    /* limite de débit sur toutes les routes API, avant toute autre action */
    if (url.pathname.startsWith("/api/")) {
      if (authLocked(request) || !(await rateLimit(request, env)))
        return jerr("trop de requêtes", 429, { "Retry-After": "60" });
    }

    /* sel du coffre : public (il voyage avec les blobs), nécessaire aux autres
       appareils pour dériver les clés avant de prouver le mot de passe */
    if (url.pathname === "/api/salt") {
      const auth = await loadAuth(env);
      return json({ ok: true, registered: !!(auth && auth.key_hash), salt: (auth && auth.salt) || null });
    }

    /* enregistrement / changement du coffre : { salt, keyHash } */
    if (url.pathname === "/api/auth") {
      if (request.method !== "PUT") return jerr("méthode non autorisée", 405);
      const cur = await loadAuth(env);
      if (cur && cur.key_hash) {
        const c = await checkKey(request, env); // changer exige la clé actuelle
        if (!c.ok) { noteAuthFailure(request); return jerr("clé d'accès invalide", 401); }
      }
      let obj = null;
      try { obj = JSON.parse(await request.text()); } catch (e) { return jerr("JSON invalide", 400); }
      const salt = String(obj && obj.salt || ""), keyHash = String(obj && obj.keyHash || "");
      if (!/^[A-Za-z0-9+/]{16,64}={0,2}$/.test(salt) || !KEY_RE.test(keyHash))
        return jerr("salt/keyHash invalides", 400);
      try {
        await env.DB
          .prepare("INSERT INTO auth (id, salt, key_hash, updated_at) VALUES (1, ?, ?, ?) " +
                   "ON CONFLICT(id) DO UPDATE SET salt = excluded.salt, key_hash = excluded.key_hash, updated_at = excluded.updated_at")
          .bind(salt, keyHash, Date.now()).run();
        return json({ ok: true });
      } catch (e) { return jerr("D1 indisponible : " + String(e && e.message || e), 500); }
    }

    /* ================= Polar AccessLink (montre Vantage M3) =================
       Le worker porte l'OAuth : client id/secret (secrets wrangler) et le jeton
       d'accès de l'utilisateur (table D1 `polar`) ne sortent jamais du serveur.
       L'app, same-origin, appelle /api/polar/* en relatif. Les endpoints de
       DONNÉES exigent la clé du coffre dès qu'il est enregistré ; les redirects
       OAuth (connect/callback) et status/disconnect restent ouverts (aucune
       donnée personnelle, navigations du navigateur sans en-têtes possibles).
         GET /api/polar/status         -> { ok, configured, connected, lastSync, callback }
         GET /api/polar/connect         -> 302 vers flow.polar.com (autorisation)
         GET /api/polar/callback        -> échange du code + inscription, 302 vers /#polar=ok
         GET /api/polar/disconnect      -> révoque l'inscription + efface le jeton
         GET /api/polar/exercises       -> liste des exercices (30 derniers jours, v3)
         GET /api/polar/exercise?id=...  -> détail d'un exercice (zones FC + samples en ligne)
         GET /api/polar/gpx?id=...      -> trace GPX d'un exercice (application/gpx+xml)
         GET /api/polar/physical-info   -> infos physiques (FC max, FC repos, poids, VO2max)
         GET /api/polar/sleep?from&to   -> nuits de sommeil (score, stades, 30 j max)
         GET /api/polar/recharge        -> Nightly Recharge (recharge ANS, VFC, respiration)
         GET /api/polar/load            -> charge cardio quotidienne (strain/tolérance) */
    if (url.pathname.startsWith("/api/polar/")) {
      const configured = !!(env.POLAR_CLIENT_ID && env.POLAR_CLIENT_SECRET);
      const polarApiError = (e) =>
        json({ ok: false, error: String(e && e.error || e) }, e && e.status || 500);

      async function polarLoad() {
        try {
          const row = await env.DB.prepare("SELECT json FROM polar WHERE id = 1").first();
          return row ? JSON.parse(row.json) : null;
        } catch (e) { return null; }
      }
      async function polarSave(obj) {
        await env.DB
          .prepare("INSERT INTO polar (id, json, updated_at) VALUES (1, ?, ?) " +
                   "ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at")
          .bind(JSON.stringify(obj), Date.now()).run();
      }
      /* appel AccessLink authentifié. Doc Polar : seul /v3/users/* utilise le
         jeton utilisateur ; le reste (p. ex. /v3/exercises) est une ressource
         cliente (Basic client_id:client_secret). On tente les deux, la méthode
         qui réussit gagne — sans masquer une erreur 401 du jeton utilisateur. */
      async function polarApi(path, accept) {
        const p = await polarLoad();
        if (!p || !p.accessToken) throw { status: 503, error: "montre non connectée" };
        const auths = [
          "Bearer " + p.accessToken,
          "Basic " + btoa(env.POLAR_CLIENT_ID + ":" + env.POLAR_CLIENT_SECRET)
        ];
        let saw401 = false, lastOther = null;
        for (const auth of auths) {
          let res;
          try {
            res = await fetch(POLAR_API + path, {
              headers: { "Authorization": auth, "Accept": accept || "application/json" }
            });
          } catch (e) { lastOther = lastOther || { status: 502, error: "Polar injoignable" }; continue; }
          if (res.ok) return res;
          if (res.status === 401) saw401 = true;
          else {
            let body = "";
            try { body = (await res.text()).slice(0, 300); } catch (e) { }
            lastOther = { status: 502, error: "Polar a répondu " + res.status + (body ? " : " + body : "") };
          }
        }
        /* le vrai diagnostic prime : 404 (pas de trace) sur le second essai
           ne doit pas être masqué par un 401 du premier */
        if (lastOther) throw lastOther;
        if (saw401) throw { status: 401, error: "jeton Polar refusé — reconnecte la montre dans Réglages" };
        throw { status: 502, error: "Polar injoignable" };
      }
      const redirect = (to) => new Response(null, { status: 302, headers: Object.assign({ Location: to }, SEC_HEADERS) });

      const sub = url.pathname.slice("/api/polar/".length);
      if (!configured) return json({ ok: false, error: "Polar non configuré sur le serveur (POLAR_CLIENT_ID / POLAR_CLIENT_SECRET)" }, 503);

      if (sub === "status") {
        const p = await polarLoad();
        return json({
          ok: true, configured: true,
          connected: !!(p && p.accessToken),
          xUserId: p && p.xUserId || null,
          connectedAt: p && p.connectedAt || null,
          lastSync: p && p.lastSync || null,
          callback: url.origin + "/api/polar/callback"
        });
      }

      if (sub === "connect") {
        const p = await polarLoad() || {};
        p.pendingState = crypto.randomUUID();
        await polarSave(p);
        const authUrl = POLAR_AUTH + "?response_type=code" +
          "&client_id=" + encodeURIComponent(env.POLAR_CLIENT_ID) +
          "&redirect_uri=" + encodeURIComponent(url.origin + "/api/polar/callback") +
          "&scope=accesslink.read_all" +
          "&state=" + encodeURIComponent(p.pendingState);
        return redirect(authUrl);
      }

      if (sub === "callback") {
        try {
          const code = url.searchParams.get("code");
          const state = url.searchParams.get("state");
          if (!code) return redirect("/#polar=err");
          const p = await polarLoad() || {};
          if (p.pendingState && state !== p.pendingState) return redirect("/#polar=err");
          /* échange du code contre un jeton d'accès (Basic client_id:client_secret) */
          const basic = btoa(env.POLAR_CLIENT_ID + ":" + env.POLAR_CLIENT_SECRET);
          const tres = await fetch(POLAR_TOKEN, {
            method: "POST",
            headers: {
              "Authorization": "Basic " + basic,
              "Content-Type": "application/x-www-form-urlencoded",
              "Accept": "application/json"
            },
            body: "grant_type=authorization_code&code=" + encodeURIComponent(code) +
                  "&redirect_uri=" + encodeURIComponent(url.origin + "/api/polar/callback")
          });
          if (!tres.ok) return redirect("/#polar=err");
          const tok = await tres.json();
          if (!tok || !tok.access_token) return redirect("/#polar=err");
          /* inscription obligatoire de l'utilisateur AccessLink (409 = déjà inscrit) */
          const reg = await fetch(POLAR_API + "/users", {
            method: "POST",
            headers: {
              "Authorization": "Bearer " + tok.access_token,
              "Content-Type": "application/json",
              "Accept": "application/json"
            },
            body: JSON.stringify({ "member-id": "trainingtrail" })
          });
          if (!reg.ok && reg.status !== 409) return redirect("/#polar=err");
          await polarSave({
            memberId: "trainingtrail",
            accessToken: tok.access_token,
            xUserId: tok.x_user_id != null ? tok.x_user_id : (p.xUserId || null),
            connectedAt: Date.now(),
            lastSync: p.lastSync || null,
            pendingState: null
          });
          return redirect("/#polar=ok");
        } catch (e) { return redirect("/#polar=err"); }
      }

      if (sub === "disconnect") {
        const p = await polarLoad();
        if (p && p.accessToken && p.xUserId != null) {
          /* révocation de l'inscription chez Polar, au mieux (erreur non bloquante) */
          try {
            await fetch(POLAR_API + "/users/" + p.xUserId, {
              method: "DELETE",
              headers: { "Authorization": "Bearer " + p.accessToken, "Accept": "application/json" }
            });
          } catch (e) { }
        }
        await env.DB.prepare("DELETE FROM polar WHERE id = 1").run();
        return redirect("/#polar=off");
      }

      /* ---- endpoints de données : clé du coffre requise dès qu'enregistrée ---- */
      const c = await checkKey(request, env);
      if (!c.ok) { noteAuthFailure(request); return jerr("clé d'accès requise", 401); }

      if (sub === "exercises") {
        try {
          const p = await polarLoad();
          if (!p || !p.accessToken) throw { status: 503, error: "montre non connectée" };
          const seen = {}, list = [];
          let lastErr = null;
          const add = (x) => {
            if (x && x.id && !seen[x.id]) { seen[x.id] = true; list.push(x); }
          };
          const addSummary = (x, fallbackId) => {
            if (!x) return;
            if (!x.id && fallbackId != null) x.id = fallbackId;
            add(x);
          };

          /* 1) API moderne : GET /v3/exercises (OAuth2, jeton utilisateur).
             Renvoie des résumés complets (ExerciseHashId) ; « polar-user »
             peut être un lien absolu (https://…/v3/users/123) et non un id nu. */
          try {
            const res = await fetch(POLAR_API + "/exercises", {
              headers: { "Authorization": "Bearer " + p.accessToken, "Accept": "application/json" }
            });
            if (res.ok) {
              const arr = await res.json();
              if (Array.isArray(arr)) arr.forEach(add);
            } else if (res.status !== 401 && res.status !== 404) {
              let body = "";
              try { body = (await res.text()).slice(0, 200); } catch (e) { }
              lastErr = { status: 502, error: "Polar a répondu " + res.status + " (exercises)" + (body ? " : " + body : "") };
            }
          } catch (e) { lastErr = lastErr || { status: 502, error: "Polar injoignable" }; }

          /* 2) API historique (file transactionnelle) : les exercices non
             encore consommés — en particulier ceux antérieurs à la connexion
             qui n'apparaissent pas toujours dans la liste moderne.
             POST  /v3/users/{uid}/exercise-transactions  -> 200 {transaction-id} | 204 (rien de neuf)
             GET   /v3/users/{uid}/exercise-transactions/{tid} -> {exercises:[id]}
             GET   /v3/users/{uid}/exercise-transactions/{tid}/exercises/{id} -> résumé
             PUT   /v3/users/{uid}/exercise-transactions/{tid} -> commit (la file est vidée) */
          if (p.xUserId != null) {
            try {
              const u = p.xUserId;
              const auth = { "Authorization": "Bearer " + p.accessToken, "Accept": "application/json" };
              const tres = await fetch(POLAR_API + "/users/" + u + "/exercise-transactions",
                { method: "POST", headers: auth });
              if (tres.status === 204) {
                /* file vide : rien à consommer */
              } else if (tres.ok) {
                const t = await tres.json();
                const tid = t && (t["transaction-id"] != null ? t["transaction-id"]
                  : t["transactionId"] != null ? t["transactionId"]
                  : t["transaction_id"] != null ? t["transaction_id"] : null);
                if (tid != null) {
                  const lres = await fetch(POLAR_API + "/users/" + u + "/exercise-transactions/" + tid,
                    { headers: auth });
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
                  /* commit systématique une fois la transaction lue : sinon les
                     appels suivants échouent (transaction déjà ouverte) */
                  try {
                    await fetch(POLAR_API + "/users/" + u + "/exercise-transactions/" + tid,
                      { method: "PUT", headers: auth });
                  } catch (e) { }
                }
              }
            } catch (e) { /* échec de la file historique : la liste moderne suffit */ }
          }

          /* 3) repli client (Basic) : certaines implémentations l'acceptent */
          try {
            const res = await fetch(POLAR_API + "/exercises", {
              headers: { "Authorization": "Basic " + btoa(env.POLAR_CLIENT_ID + ":" + env.POLAR_CLIENT_SECRET), "Accept": "application/json" }
            });
            if (res.ok) {
              const arr = await res.json();
              if (Array.isArray(arr)) arr.forEach(add);
            }
          } catch (e) { }

          if (lastErr && !list.length) throw lastErr;

          /* filtre utilisateur : comparaison NORMALISÉE — « polar-user » peut être
             un lien absolu (…/v3/users/123) ou un identifiant nu ; sans identifiant
             explicite différent, on garde l'exercice (client mono-utilisateur) et le
             filtre ne vide JAMAIS la liste */
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
          await polarSave(p);
          return json({ ok: true, exercises: mine, count: mine.length, seen: list.length });
        } catch (e) { return polarApiError(e); }
      }

      /* détail d'un exercice : zones de FC + séries (samples) en ligne.
         AccessLink : GET /v3/exercises/{id}?samples=true&zones=true */
      if (sub === "exercise") {
        const id = url.searchParams.get("id");
        if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return jerr("id invalide", 400);
        try {
          const res = await polarApi("/exercises/" + id + "?samples=true&zones=true");
          const data = await res.json();
          return json({ ok: true, exercise: data });
        } catch (e) { return polarApiError(e); }
      }

      if (sub === "gpx") {
        const id = url.searchParams.get("id");
        if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return jerr("id invalide", 400);
        try {
          const res = await polarApi("/exercises/" + id + "/gpx", "application/gpx+xml");
          return new Response(await res.text(), {
            headers: Object.assign({ "Content-Type": "application/gpx+xml; charset=utf-8", "Cache-Control": "no-store" }, SEC_HEADERS)
          });
        } catch (e) { return polarApiError(e); }
      }

      if (sub === "physical-info") {
        try {
          const res = await polarApi("/users/physical-info");
          return json({ ok: true, info: await res.json() });
        } catch (e) { return polarApiError(e); }
      }

      /* sommeil : GET /v3/users/sleep?from=..&to=.. (30 jours max chez Polar) */
      if (sub === "sleep") {
        const from = url.searchParams.get("from"), to = url.searchParams.get("to");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(from || "") || !/^\d{4}-\d{2}-\d{2}$/.test(to || ""))
          return jerr("dates invalides (YYYY-MM-DD)", 400);
        try {
          if (Date.parse(to) - Date.parse(from) > 31 * 864e5)
            return jerr("intervalle trop large (max 31 jours)", 400);
          const res = await polarApi("/users/sleep?from=" + from + "&to=" + to);
          const data = await res.json();
          return json({ ok: true, nights: (data && data.nights) || [] });
        } catch (e) { return polarApiError(e); }
      }

      /* Nightly Recharge (recharge ANS, VFC RMSSD, respiration) : 28 derniers jours */
      if (sub === "recharge") {
        try {
          const res = await polarApi("/users/nightly-recharge");
          const data = await res.json();
          return json({ ok: true, recharges: (data && data.recharges) || (Array.isArray(data) ? data : []) });
        } catch (e) { return polarApiError(e); }
      }

      /* charge cardio (strain/tolerance/statut) : 28 derniers jours */
      if (sub === "load") {
        try {
          const res = await polarApi("/users/cardio-load");
          const data = await res.json();
          return json({ ok: true, loads: Array.isArray(data) ? data : [] });
        } catch (e) { return polarApiError(e); }
      }

      return jerr("endpoint Polar inconnu", 404);
    }

    /* traces GPS en R2 (si la liaison TRACKS est configurée) : hors de l'état
       D1, plafonné par ailleurs à 2 Mo. id = identifiant de la sortie. Le contenu
       est opaque pour le serveur (chiffré côté client quand le coffre est actif). */
    if (url.pathname === "/api/track") {
      const id = url.searchParams.get("id");
      const user = checkUser(url.searchParams.get("user") || "");
      if (!id || !/^\d{1,12}$/.test(id)) return jerr("id invalide", 400);
      if (user === null) return jerr("user invalide", 400);
      if (!env.TRACKS) return jerr("stockage des traces non activé", 503);
      const c = await checkKey(request, env);
      if (!c.ok) { noteAuthFailure(request); return jerr("clé d'accès requise", 401); }
      const key = trackKey(user, id);
      if (request.method === "PUT") {
        try {
          const body = await request.text();
          if (body.length > MAX_TRACK) return jerr("trace trop volumineuse", 400);
          JSON.parse(body); // refuse tout ce qui n'est pas du JSON valide
          await env.TRACKS.put(key, body);
          return json({ ok: true });
        } catch (e) { return jerr(String(e && e.message || e), 400); }
      }
      if (request.method === "GET") {
        const obj = await env.TRACKS.get(key);
        if (!obj) return jerr("trace inconnue", 404);
        return new Response(await obj.text(), {
          headers: Object.assign({ "Content-Type": "application/json", "Cache-Control": "no-store" }, SEC_HEADERS)
        });
      }
      if (request.method === "DELETE") {
        await env.TRACKS.delete(key);
        return json({ ok: true });
      }
      return jerr("méthode non autorisée", 405);
    }

    if (url.pathname === "/api/state") {
      const user = checkUser(url.searchParams.get("user") || "");
      if (user === null) return jerr("user invalide", 400);
      const c = await checkKey(request, env);
      if (!c.ok) { noteAuthFailure(request); return jerr("clé d'accès requise", 401); }

      if (request.method === "GET") {
        const cur = await readState(env, user);
        if (!cur) return json({ ok: true, updatedAt: 0, state: null });
        return json({ ok: true, updatedAt: cur.updatedAt, state: cur.json });
      }

      if (request.method === "PUT") {
        try {
          const body = await request.text();
          if (body.length > MAX_BODY) throw new Error("corps trop volumineux (max 2 Mo)");
          const obj = JSON.parse(body);
          if (typeof obj !== "object" || obj === null || Array.isArray(obj))
            throw new Error("état invalide");
          const updatedAt = typeof obj.updatedAt === "number" ? obj.updatedAt : 0;
          /* anti-rollback : on refuse une version plus ancienne que la copie serveur */
          const cur = await readState(env, user);
          if (cur && typeof cur.updatedAt === "number" && updatedAt < cur.updatedAt)
            return jerr("état plus ancien que la copie du serveur", 409);
          /* premier envoi chiffré avec clé valide : le worker adopte le coffre
             (salt du blob + SHA-256 de la clé reçue) pour bloquer les accès sans clé */
          const auth = await loadAuth(env);
          if (!auth || !auth.key_hash) {
            const key = request.headers.get("x-tt-key") || "";
            if (obj.enc === 1 && KEY_RE.test(key))
              await env.DB
                .prepare("INSERT INTO auth (id, salt, key_hash, updated_at) VALUES (1, ?, ?, ?) " +
                         "ON CONFLICT(id) DO UPDATE SET salt = excluded.salt, key_hash = excluded.key_hash, updated_at = excluded.updated_at")
                .bind(String(obj.salt || ""), await sha256b64(key), Date.now()).run();
          }
          await writeState(env, user, body, updatedAt);
          return json({ ok: true, updatedAt: updatedAt });
        } catch (e) {
          return jerr(String(e && e.message || e), 400);
        }
      }

      if (request.method === "DELETE") {
        /* supprime la session : état + traces R2 de cette session */
        try {
          await deleteState(env, user);
          if (env.TRACKS) {
            const listed = await env.TRACKS.list({ prefix: "track-" });
            const mine = (listed.objects || []).filter(o =>
              user ? o.key.startsWith("track-" + user + "-") : /^track-\d+$/.test(o.key));
            await Promise.all(mine.map(o => env.TRACKS.delete(o.key).catch(() => { })));
          }
        } catch (e) { return jerr(String(e && e.message || e), 500); }
        return json({ ok: true });
      }

      return jerr("méthode non autorisée", 405);
    }

    /* fichiers statiques : mêmes en-têtes de sécurité que l'API */
    const res = await env.ASSETS.fetch(request);
    const h = new Headers(res.headers);
    for (const k in SEC_HEADERS) h.set(k, SEC_HEADERS[k]);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
  }
};
