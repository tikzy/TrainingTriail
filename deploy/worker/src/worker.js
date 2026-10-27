/* TrainingTrail — Worker Cloudflare + D1 (prototype de stockage central).
   Réimplémente l'API du serveur Node (server/server.js) sans machine dédiée :
     GET  /api/ping   -> { ok: true, app, version }
     GET  /api/state  -> { ok, updatedAt, state }
     PUT  /api/state  -> enregistre l'état (JSON) dans D1 (table `state`)
   Tout le reste est servi depuis les fichiers statiques de ../../site
   (liaison ASSETS, voir wrangler.toml). L'app ne change pas : ServerSync
   appelle "api/ping" et "api/state" en relatif, donc same-origin. */

const MAX_BODY = 2 * 1024 * 1024; // limite prototype : au-delà, passer les traces GPX sur R2
const MAX_TRACK = 5 * 1024 * 1024; // trace GPS maximale en R2

/* Polar AccessLink v3 : endpoints OAuth et API (https://www.polar.com/accesslink-api/) */
const POLAR_AUTH = "https://flow.polar.com/oauth2/authorization";
const POLAR_TOKEN = "https://polarremote.com/v2/oauth2/token";
const POLAR_API = "https://www.polaraccesslink.com/v3";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }, CORS)
  });
}

export default {
  async fetch(request, env) {
    let url;
    try { url = new URL(request.url); }
    catch (e) { return json({ ok: false, error: "URL invalide" }, 400); }

    if (url.pathname === "/api/ping")
      return json({ ok: true, app: "trainingtrail-worker", version: 1, tracks: !!env.TRACKS });

    /* ================= Polar AccessLink (montre Vantage M3) =================
       Le worker porte l'OAuth : client id/secret (secrets wrangler) et le jeton
       d'accès de l'utilisateur (table D1 `polar`) ne sortent jamais du serveur.
       L'app, same-origin, appelle /api/polar/* en relatif.
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
      const redirect = (to) => new Response(null, { status: 302, headers: { Location: to } });

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

      if (sub === "exercises") {
        try {
          const p = await polarLoad();
          if (!p || !p.accessToken) throw { status: 503, error: "montre non connectée" };
          /* la liste peut venir du jeton utilisateur OU des identifiants client
             (ressource cliente selon la doc) : on fusionne, dédoublonnée par id */
          const auths = [
            "Bearer " + p.accessToken,
            "Basic " + btoa(env.POLAR_CLIENT_ID + ":" + env.POLAR_CLIENT_SECRET)
          ];
          const seen = {}, list = [];
          let lastErr = null;
          for (const auth of auths) {
            let res;
            try {
              res = await fetch(POLAR_API + "/exercises", {
                headers: { "Authorization": auth, "Accept": "application/json" }
              });
            } catch (e) { lastErr = { status: 502, error: "Polar injoignable" }; continue; }
            if (!res.ok) {
              let body = "";
              try { body = (await res.text()).slice(0, 300); } catch (e) { }
              lastErr = { status: 502, error: "Polar a répondu " + res.status + (body ? " : " + body : "") };
              continue;
            }
            let arr = null;
            try { arr = await res.json(); } catch (e) { }
            if (Array.isArray(arr)) arr.forEach(x => {
              if (x && x.id && !seen[x.id]) { seen[x.id] = true; list.push(x); }
            });
          }
          if (lastErr && !list.length) throw lastErr;
          /* Au niveau client, la liste couvre en théorie tous les inscrits ; on
             privilégie les exercices de l'utilisateur connecté (x_user_id OAuth),
             mais le filtre ne doit JAMAIS vider la liste : l'identifiant porté
             par un exercice ne correspond pas toujours à x_user_id (non garanti
             par la doc), et ce client n'a qu'un seul inscrit. */
          const uid = p.xUserId;
          let mine = list;
          if (uid != null) {
            const of = (x) => {
              const u = x["polar-user"] != null ? x["polar-user"]
                : x["polar_user"] != null ? x["polar_user"]
                : x["polar-user-id"] != null ? x["polar-user-id"] : null;
              return u == null ? null : String(u) === String(uid);
            };
            const matching = list.filter(x => of(x) !== false);
            if (matching.length || list.length === 0) mine = matching;
          }
          p.lastSync = Date.now();
          await polarSave(p);
          return json({ ok: true, exercises: mine, count: mine.length });
        } catch (e) { return polarApiError(e); }
      }

      /* détail d'un exercice : zones de FC + séries (samples) en ligne.
         AccessLink : GET /v3/exercises/{id}?samples=true&zones=true */
      if (sub === "exercise") {
        const id = url.searchParams.get("id");
        if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return json({ ok: false, error: "id invalide" }, 400);
        try {
          const res = await polarApi("/exercises/" + id + "?samples=true&zones=true");
          const data = await res.json();
          return json({ ok: true, exercise: data });
        } catch (e) { return polarApiError(e); }
      }

      if (sub === "gpx") {
        const id = url.searchParams.get("id");
        if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return json({ ok: false, error: "id invalide" }, 400);
        try {
          const res = await polarApi("/exercises/" + id + "/gpx", "application/gpx+xml");
          return new Response(await res.text(), {
            headers: Object.assign({ "Content-Type": "application/gpx+xml; charset=utf-8", "Cache-Control": "no-store" }, CORS)
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
          return json({ ok: false, error: "dates invalides (YYYY-MM-DD)" }, 400);
        try {
          if (Date.parse(to) - Date.parse(from) > 31 * 864e5)
            return json({ ok: false, error: "intervalle trop large (max 31 jours)" }, 400);
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

      return json({ ok: false, error: "endpoint Polar inconnu" }, 404);
    }

    /* traces GPS en R2 (si la liaison TRACKS est configurée) : hors de l'état
       D1, plafonné par ailleurs à 2 Mo. id = identifiant de la sortie. */
    if (url.pathname === "/api/track") {
      const id = url.searchParams.get("id");
      if (!id || !/^\d{1,12}$/.test(id)) return json({ ok: false, error: "id invalide" }, 400);
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
      if (!env.TRACKS) return json({ ok: false, error: "stockage des traces non activé" }, 503);
      const key = "track-" + id;
      if (request.method === "PUT") {
        try {
          const body = await request.text();
          if (body.length > MAX_TRACK) return json({ ok: false, error: "trace trop volumineuse" }, 400);
          JSON.parse(body); // refuse tout ce qui n'est pas du JSON valide
          await env.TRACKS.put(key, body);
          return json({ ok: true });
        } catch (e) { return json({ ok: false, error: String(e && e.message || e) }, 400); }
      }
      if (request.method === "GET") {
        const obj = await env.TRACKS.get(key);
        if (!obj) return json({ ok: false, error: "trace inconnue" }, 404);
        return new Response(await obj.text(), {
          headers: Object.assign({ "Content-Type": "application/json", "Cache-Control": "no-store" }, CORS)
        });
      }
      if (request.method === "DELETE") {
        await env.TRACKS.delete(key);
        return json({ ok: true });
      }
      return json({ ok: false, error: "méthode non autorisée" }, 405);
    }

    if (url.pathname === "/api/state") {
      if (request.method === "OPTIONS")
        return new Response(null, { status: 204, headers: CORS });

      if (request.method === "GET") {
        const row = await env.DB
          .prepare("SELECT json, updated_at AS updatedAt FROM state WHERE id = 1")
          .first();
        if (!row) return json({ ok: true, updatedAt: 0, state: null });
        return json({ ok: true, updatedAt: row.updatedAt, state: JSON.parse(row.json) });
      }

      if (request.method === "PUT") {
        try {
          const body = await request.text();
          if (body.length > MAX_BODY) throw new Error("corps trop volumineux (max 2 Mo)");
          const obj = JSON.parse(body);
          if (typeof obj !== "object" || obj === null || Array.isArray(obj))
            throw new Error("état invalide");
          const updatedAt = obj.updatedAt || 0;
          await env.DB
            .prepare("INSERT INTO state (id, json, updated_at) VALUES (1, ?, ?) " +
                     "ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at")
            .bind(body, updatedAt)
            .run();
          return json({ ok: true, updatedAt: updatedAt });
        } catch (e) {
          return json({ ok: false, error: String(e && e.message || e) }, 400);
        }
      }

      return json({ ok: false, error: "méthode non autorisée" }, 405);
    }

    return env.ASSETS.fetch(request);
  }
};
