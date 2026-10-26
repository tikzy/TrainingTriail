"use strict";
/* GPS / GPX : enregistrement via l'API Geolocation, import et export de fichiers GPX,
   calcul de distance, vitesse et dénivelé. */

const Geo = {
  R: 6371000, // rayon terre (m)

  haversine(a, b) {
    const rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    const s = Math.sin(dLat / 2) ** 2 +
      Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * this.R * Math.asin(Math.sqrt(s));
  },

  /* D+ / D- avec seuil pour filtrer le bruit du GPS barométrique */
  elevation(pts, threshold) {
    threshold = threshold == null ? 3 : threshold;
    let up = 0, down = 0, ref = null;
    for (const p of pts) {
      if (p.ele == null) continue;
      if (ref == null) { ref = p.ele; continue; }
      const d = p.ele - ref;
      if (d >= threshold) { up += d; ref = p.ele; }
      else if (d <= -threshold) { down -= d; ref = p.ele; }
    }
    return { up, down };
  },

  stats(pts) {
    let dist = 0;
    for (let i = 1; i < pts.length; i++) dist += this.haversine(pts[i - 1], pts[i]);
    const dur = pts.length > 1 ? (pts[pts.length - 1].t - pts[0].t) / 1000 : 0;
    const el = this.elevation(pts);
    return {
      dist: dist / 1000,                 // km
      dur,                               // s
      dplus: Math.round(el.up),
      dminus: Math.round(el.down),
      speed: dur > 0 ? (dist / 1000) / (dur / 3600) : 0, // km/h
      maxEle: pts.reduce((m, p) => Math.max(m, p.ele == null ? -Infinity : p.ele), -Infinity),
      minEle: pts.reduce((m, p) => Math.min(m, p.ele == null ? Infinity : p.ele), Infinity)
    };
  },

  /* réduit le nombre de points pour le stockage localStorage */
  decimate(pts, max) {
    max = max || 3000;
    if (pts.length <= max) return pts;
    const step = Math.ceil(pts.length / max);
    const out = [];
    for (let i = 0; i < pts.length; i += step) out.push(pts[i]);
    if (out[out.length - 1] !== pts[pts.length - 1]) out.push(pts[pts.length - 1]);
    return out;
  },

  /* version compacte pour le localStorage : moins de points, coordonnées arrondies (~1 m) */
  compact(pts, max) {
    max = max || 1200;
    return this.decimate(pts, max).map(p => {
      const o = {
        lat: Math.round(p.lat * 1e5) / 1e5,
        lon: Math.round(p.lon * 1e5) / 1e5,
        ele: p.ele == null ? null : Math.round(p.ele * 10) / 10,
        t: p.t
      };
      if (p.hr != null) o.hr = Math.round(p.hr);
      return o;
    });
  },

  toGpx(name, pts) {
    const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    let trkpts = "";
    for (const p of pts) {
      trkpts += '<trkpt lat="' + p.lat.toFixed(6) + '" lon="' + p.lon.toFixed(6) + '">';
      if (p.ele != null) trkpts += "<ele>" + p.ele.toFixed(1) + "</ele>";
      trkpts += "<time>" + new Date(p.t).toISOString() + "</time></trkpt>";
    }
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<gpx version="1.1" creator="TrainingTrail" xmlns="http://www.topografix.com/GPX/1/1">\n' +
      "<trk><name>" + esc(name) + "</name><trkseg>\n" + trkpts + "</trkseg></trk>\n</gpx>";
  },

  parseGpx(xml) {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("Fichier GPX illisible.");
    const out = [];
    doc.querySelectorAll("trkpt, rtept").forEach(p => {
      const lat = parseFloat(p.getAttribute("lat")), lon = parseFloat(p.getAttribute("lon"));
      if (isNaN(lat) || isNaN(lon)) return;
      let ele = null, t = null, hr = null;
      const e = p.querySelector("ele"); if (e) ele = parseFloat(e.textContent);
      const tm = p.querySelector("time"); if (tm) t = Date.parse(tm.textContent);
      /* fréquence cardiaque : extension gpxtpx (Garmin/Polar/Strava), quel que soit le préfixe */
      const hrEl = p.getElementsByTagName("gpxtpx:hr")[0] ||
        Array.from(p.getElementsByTagName("*")).find(n => n.localName === "hr");
      if (hrEl) { const v = parseFloat(hrEl.textContent); if (!isNaN(v)) hr = v; }
      out.push({ lat, lon, ele, t: isNaN(t) ? null : t, hr: hr });
    });
    if (out.length < 2) throw new Error("Pas assez de points GPS dans ce fichier.");
    // si pas d'horodatage, en fabrique un régulier (1 s / point)
    if (out[0].t == null) out.forEach((p, i) => { p.t = Date.now() - (out.length - i) * 1000; });
    return out;
  },

  download(filename, content, mime) {
    const blob = new Blob([content], { type: mime || "application/gpx+xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  },

  /* distance et temps « en mouvement » : segments où la vitesse > 2,5 km/h
     (feux, pauses, à-coups exclus de la moyenne en mouvement) */
  movingStats(pts) {
    let mt = 0, md = 0;
    for (let i = 1; i < pts.length; i++) {
      const dt = (pts[i].t - pts[i - 1].t) / 1000;
      if (dt <= 0 || dt > 30) continue;          // trou dans la trace : on ne compte pas
      const dd = this.haversine(pts[i - 1], pts[i]);
      if (dd / dt >= 0.7) { mt += dt; md += dd; } // 0,7 m/s ≈ 2,5 km/h
    }
    return { time: mt, dist: md };
  },

  /* profil altimétrique en SVG */
  profileSVG(pts, w, h) {
    w = w || 560; h = h || 110;
    const withEle = pts.filter(p => p.ele != null);
    if (withEle.length < 2) return '<div class="muted">Pas de données d\'altitude.</div>';
    let dist = 0; const xs = [{ d: 0, e: withEle[0].ele }];
    for (let i = 1; i < withEle.length; i++) {
      dist += Geo.haversine(withEle[i - 1], withEle[i]);
      xs.push({ d: dist / 1000, e: withEle[i].ele });
    }
    const maxD = Math.max(xs[xs.length - 1].d, 0.01);
    let minE = Infinity, maxE = -Infinity;
    xs.forEach(p => { minE = Math.min(minE, p.e); maxE = Math.max(maxE, p.e); });
    if (maxE - minE < 10) { maxE += 5; minE -= 5; }
    const X = d => 30 + (d / maxD) * (w - 40);
    const Y = e => h - 20 - ((e - minE) / (maxE - minE)) * (h - 35);
    let path = "M" + X(0) + "," + Y(xs[0].e).toFixed(1);
    xs.forEach(p => { path += " L" + X(p.d).toFixed(1) + "," + Y(p.e).toFixed(1); });
    const area = path + " L" + X(maxD) + "," + (h - 20) + " L" + X(0) + "," + (h - 20) + " Z";
    return '<svg class="profile" viewBox="0 0 ' + w + " " + h + '" width="100%">' +
      '<path d="' + area + '" class="prof-area"/><path d="' + path + '" class="prof-line"/>' +
      '<text x="30" y="12" class="prof-label">' + Math.round(maxE) + ' m</text>' +
      '<text x="30" y="' + (h - 6) + '" class="prof-label">' + Math.round(minE) + ' m</text>' +
      '<text x="' + (w - 8) + '" y="' + (h - 6) + '" class="prof-label" text-anchor="end">' + maxD.toFixed(1) + ' km</text></svg>';
  },

  /* courbe générique vs temps : série [{ t, v }], limites calculées, zone + ligne */
  seriesSVG(series, w, h, fmt, color) {
    w = w || 560; h = h || 90; fmt = fmt || (v => v);
    if (!series || series.length < 2) return "";
    let minV = Infinity, maxV = -Infinity;
    series.forEach(p => { minV = Math.min(minV, p.v); maxV = Math.max(maxV, p.v); });
    if (maxV - minV < 1e-6) { maxV += 1; minV -= 1; }
    const t0 = series[0].t, t1 = Math.max(series[series.length - 1].t, t0 + 1);
    const X = t => 38 + ((t - t0) / (t1 - t0)) * (w - 48);
    const Y = v => h - 18 - ((v - minV) / (maxV - minV)) * (h - 32);
    let path = "M" + X(series[0].t).toFixed(1) + "," + Y(series[0].v).toFixed(1);
    series.forEach(p => { path += " L" + X(p.t).toFixed(1) + "," + Y(p.v).toFixed(1); });
    const area = path + " L" + X(t1).toFixed(1) + "," + (h - 18) + " L" + X(t0).toFixed(1) + "," + (h - 18) + " Z";
    const minutes = Math.round((t1 - t0) / 60000);
    return '<svg class="profile" viewBox="0 0 ' + w + " " + h + '" width="100%" style="--curve:' + (color || "var(--acc)") + '">' +
      '<path d="' + area + '" class="prof-area" style="stroke:none"/>' +
      '<path d="' + path + '" class="prof-line" style="stroke:' + (color || "var(--acc)") + '"/>' +
      '<text x="38" y="12" class="prof-label">' + esc(fmt(maxV)) + "</text>" +
      '<text x="38" y="' + (h - 5) + '" class="prof-label">' + esc(fmt(minV)) + "</text>" +
      '<text x="' + (w - 8) + '" y="' + (h - 5) + '" class="prof-label" text-anchor="end">' + Math.floor(minutes / 60) + "h" + String(minutes % 60).padStart(2, "0") + "</text></svg>";
    function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;"); }
  },

  /* vitesses lissées (fenêtre ~30 s) : [{ t, v: km/h }] */
  speedSeries(pts, windowMs) {
    windowMs = windowMs || 30000;
    const cum = [{ t: pts[0].t, d: 0 }];
    for (let i = 1; i < pts.length; i++)
      cum.push({ t: pts[i].t, d: cum[i - 1].d + Geo.haversine(pts[i - 1], pts[i]) });
    return cum.map((p, i) => {
      let a = i, b = i;
      while (a > 0 && p.t - cum[a].t < windowMs / 2) a--;
      while (b < cum.length - 1 && cum[b].t - p.t < windowMs / 2) b++;
      const dt = cum[b].t - cum[a].t;
      return { t: p.t, v: dt > 0 ? ((cum[b].d - cum[a].d) / dt) * 3.6 : 0 };
    }).filter(s => s.t != null);
  },

  /* courbes détaillées d'une sortie : altitude, vitesse et FC en fonction du temps */
  plotsSVG(pts) {
    if (!pts || pts.length < 2) return '<div class="muted">Trace trop courte pour tracer des courbes.</div>';
    let html = "";
    const withEle = pts.filter(p => p.ele != null && p.t != null);
    if (withEle.length >= 2)
      html += '<div class="plot-block"><div class="plot-title">Altitude (m)</div>' +
        this.seriesSVG(withEle.map(p => ({ t: p.t, v: p.ele })), 560, 90, v => Math.round(v) + " m", "var(--dplus)") + "</div>";
    const timed = pts.filter(p => p.t != null);
    if (timed.length >= 2)
      html += '<div class="plot-block"><div class="plot-title">Vitesse lissée (km/h, fenêtre 30 s)</div>' +
        this.seriesSVG(this.speedSeries(timed), 560, 90, v => v.toFixed(1).replace(".", ",") + " km/h", "var(--teal)") + "</div>";
    const withHr = pts.filter(p => p.hr != null && p.t != null);
    if (withHr.length >= 2)
      html += '<div class="plot-block"><div class="plot-title">Fréquence cardiaque (bpm)</div>' +
        this.seriesSVG(withHr.map(p => ({ t: p.t, v: p.hr })), 560, 90, v => Math.round(v) + " bpm", "var(--danger)") + "</div>";
    if (!html) return '<div class="muted">Pas de données exploitables (altitude ni horodatage).</div>';
    if (withHr.length < 2) html += '<div class="muted small">Pas de données FC dans cette trace — exporte le GPX depuis Polar Flow avec la FC pour la voir ici.</div>';
    return '<div class="run-plots">' + html + "</div>";
  }
};

/* ---------- filtre GPS ----------
   Un GPS « qui décroche » surajoute de la distance : chaque fix est bruité de
   plusieurs mètres, et la somme de ces bruits gonfle le tracé (surtout à
   l'arrêt ou à faible vitesse). Le filtre, calibré par simulation :
   1. rejette les fixes trop imprécis (accuracy > maxAcc) ;
   2. rejette les sauts physiquement impossibles (vitesse > maxSpeed) ;
   3. lisse la position par moyenne exponentielle (EMA) — l'EMA ne dérive pas
      dans le temps, donc à l'arrêt la position reste piégée dans son cercle
      de bruit au lieu de faire une marche aléatoire ;
   4. n'ajoute de la distance que lorsque la position lissée sort du cercle
      de bruit, et retire en quadrature le bruit résiduel de l'EMA.
   Simulation (bruit σ = 4 m, 1 fix/s) : sortie 5 km : +186 % d'erreur brute
   → +7 % filtrée ; marche 2,5 km : +422 % → +8 % ; 10 min immobile :
   4,3 km de faux déplacement → 0,55 km. */
Geo.mkGpsFilter = function () {
  const ALPHA = 0.45;   // coefficient de lissage de l'EMA position
  const K_TH = 0.4;     // rayon du cercle de bruit : 0,4 × accuracy
  const K_NOISE = 0.24; // bruit résiduel RMS de l'EMA : 0,24 × accuracy
  return {
    ema: null, lastAcc: null, lastAny: null, dist: 0, out: [],
    push(p) {
      if (p.acc == null) p.acc = 15;
      if (p.acc > 50) return null;
      if (!this.ema) {
        this.ema = { lat: p.lat, lon: p.lon, ele: p.ele, t: p.t, acc: p.acc };
        this.lastAcc = this.ema; this.lastAny = p; this.out.push(this.ema);
        return this.ema;
      }
      const la = this.lastAny; this.lastAny = p;
      const dt = (p.t - la.t) / 1000;
      if (dt <= 0) return null;
      if (Geo.haversine(la, p) / dt > 25) return null; // saut impossible
      const prev = this.ema;
      const ema = {
        lat: prev.lat + (p.lat - prev.lat) * ALPHA,
        lon: prev.lon + (p.lon - prev.lon) * ALPHA,
        ele: p.ele == null ? prev.ele : (prev.ele == null ? p.ele : prev.ele + (p.ele - prev.ele) * 0.35),
        t: p.t, acc: p.acc
      };
      this.ema = ema;
      const d = Geo.haversine(this.lastAcc, ema);
      const noise = Math.max(1.5, K_TH * p.acc);
      if (d >= noise) {
        const n = K_NOISE * p.acc;
        this.dist += Math.max(0, Math.sqrt(Math.max(0, d * d - n * n)));
        this.lastAcc = ema;
        this.out.push(ema);
      } else if (p.t - this.lastAcc.t > 30000) {
        // à l'arrêt : garder une trace vivante sans ajouter de distance
        this.lastAcc = ema;
        this.out.push(ema);
      }
      return ema;
    },
    /* reprise après interruption : on repart du dernier point connu */
    reseed(pts, baseDist) {
      this.out = pts.slice();
      this.dist = baseDist || 0;
      const last = pts[pts.length - 1];
      this.ema = { lat: last.lat, lon: last.lon, ele: last.ele, t: last.t, acc: last.acc || 15 };
      this.lastAcc = this.ema;
      this.lastAny = this.ema;
    }
  };
};

/* ---------- enregistreur GPS temps réel ----------
   Persistant : la trace est sauvegardée en continu dans le localStorage
   (point de reprise), donc l'enregistrement survit à un changement d'onglet,
   à la mise en arrière-plan ou à un rechargement de la page (reprise proposée). */
const REC_KEY = "trainingtrail_rec_v1";
const Recorder = {
  watchId: null,
  pts: [],
  baseDist: 0,     // distance déjà acquise (avant une reprise)
  t0: null,        // timestamp du premier point
  pausedMs: 0,     // temps total passé en pause
  pauseStart: null,
  active: false,
  paused: false,
  lastFix: null,
  filt: null,
  onTick: null,
  _saveTimer: 0,

  start(onTick) {
    if (!("geolocation" in navigator)) return Promise.reject(new Error("Géolocalisation non disponible dans ce navigateur."));
    this.onTick = onTick || null;
    this.filt = Geo.mkGpsFilter();
    this.pts = this.filt.out;
    this.baseDist = 0;
    this.t0 = null;
    this.pausedMs = 0;
    this.pauseStart = null;
    this.active = true;
    this.paused = false;
    return new Promise((resolve, reject) => {
      this.watchId = navigator.geolocation.watchPosition(
        pos => {
          this.lastFix = pos;
          if (this.t0 == null) this.t0 = pos.timestamp;
          const p = { lat: pos.coords.latitude, lon: pos.coords.longitude, ele: pos.coords.altitude, t: pos.timestamp, acc: pos.coords.accuracy };
          this.filt.push(p);
          this.checkpoint(true);
          if (this.onTick) this.onTick(this.live());
        },
        err => { reject(err); },
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
      );
      resolve();
    });
  },

  /* reprise d'un enregistrement interrompu (rechargement de page, onglet fermé) */
  resume(onTick) {
    const cp = this.loadCheckpoint();
    if (!cp) return Promise.reject(new Error("Aucun enregistrement à reprendre."));
    this.onTick = onTick || null;
    this.filt = Geo.mkGpsFilter();
    if (cp.pts && cp.pts.length) this.filt.reseed(cp.pts, cp.dist || 0);
    else { this.filt.out = []; this.filt.dist = 0; }
    this.pts = this.filt.out;
    this.baseDist = 0;
    this.t0 = cp.t0 != null ? cp.t0 : (this.pts.length ? this.pts[0].t : Date.now());
    // le temps écoulé depuis la sauvegarde compte comme une pause
    this.pausedMs = (cp.pausedMs || 0) + Math.max(0, Date.now() - (cp.savedAt || Date.now()));
    this.pauseStart = null;
    this.active = true;
    this.paused = false;
    localStorage.removeItem(REC_KEY);
    return new Promise((resolve, reject) => {
      this.watchId = navigator.geolocation.watchPosition(
        pos => {
          this.lastFix = pos;
          const p = { lat: pos.coords.latitude, lon: pos.coords.longitude, ele: pos.coords.altitude, t: pos.timestamp, acc: pos.coords.accuracy };
          this.filt.push(p);
          this.checkpoint(true);
          if (this.onTick) this.onTick(this.live());
        },
        err => { reject(err); },
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
      );
      resolve();
    });
  },

  pause() {
    if (!this.active || this.paused) return;
    this.paused = true;
    this.pauseStart = Date.now();
    if (this.watchId != null) { navigator.geolocation.clearWatch(this.watchId); this.watchId = null; }
    this.checkpoint(false);
  },
  unpause() {
    if (!this.active || !this.paused) return;
    this.pausedMs += Date.now() - this.pauseStart;
    this.pauseStart = null;
    this.paused = false;
    this.watchId = navigator.geolocation.watchPosition(
      pos => {
        this.lastFix = pos;
        const p = { lat: pos.coords.latitude, lon: pos.coords.longitude, ele: pos.coords.altitude, t: pos.timestamp, acc: pos.coords.accuracy };
        this.filt.push(p);
        this.checkpoint(true);
        if (this.onTick) this.onTick(this.live());
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
    );
  },

  dist() { return (this.baseDist || 0) + (this.filt ? this.filt.dist : 0); },
  dur() {
    if (this.t0 == null) return 0;
    const end = this.paused && this.pauseStart ? this.pauseStart : Date.now();
    return Math.max(0, (end - this.t0 - this.pausedMs) / 1000);
  },
  /* durée « de trace » : l'étendue des points moins les pauses */
  traceDur() {
    const pts = this.filt ? this.filt.out : [];
    if (pts.length < 2) return this.dur();
    const span = (pts[pts.length - 1].t - pts[0].t) / 1000;
    const gaps = (this.pausedMs || 0) / 1000;
    return Math.max(0, span - gaps);
  },

  live() {
    const pts = this.filt ? this.filt.out : [];
    const el = Geo.elevation(pts);
    const fix = this.lastFix;
    const mv = Geo.movingStats(pts);
    return {
      dist: this.dist() / 1000,
      dur: this.dur(),
      dplus: Math.round(el.up),
      speed: fix && fix.coords.speed != null && fix.coords.speed >= 0 ? fix.coords.speed * 3.6 : (this.dur() > 0 ? (this.dist() / 1000) / (this.dur() / 3600) : 0),
      avg: this.dur() > 0 ? (this.dist() / 1000) / (this.dur() / 3600) : 0,          // moyenne globale
      movingAvg: mv.time > 0 ? (mv.dist / 1000) / (mv.time / 3600) : 0,              // moyenne en mouvement
      ele: pts.length && pts[pts.length - 1].ele != null ? pts[pts.length - 1].ele : (fix && fix.coords.altitude != null ? fix.coords.altitude : null),
      acc: fix ? fix.coords.accuracy : null,
      npts: pts.length
    };
  },

  stop() {
    if (this.watchId != null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    const pts = this.filt ? Geo.decimate(this.filt.out, 3000) : [];
    const out = { pts, dist: this.dist(), dur: this.traceDur() };
    this.active = false;
    this.paused = false;
    this.lastFix = null;
    this.filt = null;
    this.pts = [];
    localStorage.removeItem(REC_KEY);
    return out;
  },

  abort() {
    if (this.watchId != null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    this.active = false; this.paused = false;
    this.lastFix = null; this.filt = null; this.pts = [];
    localStorage.removeItem(REC_KEY);
  },

  /* point de reprise : écrit au plus toutes les 5 s, et à chaque passage en arrière-plan */
  checkpoint(throttled) {
    if (!this.active) return;
    const now = Date.now();
    if (throttled && this._saveTimer && now - this._saveTimer < 5000) return;
    this._saveTimer = now;
    try {
      localStorage.setItem(REC_KEY, JSON.stringify({
        pts: Geo.compact(this.filt ? this.filt.out : [], 2000),
        dist: this.dist(),
        t0: this.t0,
        pausedMs: (this.pausedMs || 0) + (this.paused && this.pauseStart ? now - this.pauseStart : 0),
        savedAt: now
      }));
    } catch (e) { /* stockage plein : l'enregistrement continue en mémoire */ }
  },

  loadCheckpoint() {
    try {
      const raw = localStorage.getItem(REC_KEY);
      if (!raw) return null;
      const cp = JSON.parse(raw);
      if (!cp || !cp.pts || cp.pts.length < 1) return null;
      return cp;
    } catch (e) { return null; }
  },

  hasCheckpoint() { return !!this.loadCheckpoint(); }
};

/* survit au rechargement de page : sauvegarde avant déchargement et à chaque passage en arrière-plan */
window.addEventListener("pagehide", () => { if (Recorder.active) Recorder.checkpoint(false); });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && Recorder.active) Recorder.checkpoint(false);
});
