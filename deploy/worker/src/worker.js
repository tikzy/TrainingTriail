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
