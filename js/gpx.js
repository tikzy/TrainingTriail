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
    return this.decimate(pts, max).map(p => ({
      lat: Math.round(p.lat * 1e5) / 1e5,
      lon: Math.round(p.lon * 1e5) / 1e5,
      ele: p.ele == null ? null : Math.round(p.ele * 10) / 10,
      t: p.t
    }));
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
      let ele = null, t = null;
      const e = p.querySelector("ele"); if (e) ele = parseFloat(e.textContent);
      const tm = p.querySelector("time"); if (tm) t = Date.parse(tm.textContent);
      out.push({ lat, lon, ele, t: isNaN(t) ? null : t });
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
  }
};

/* ---------- enregistreur GPS temps réel ---------- */
const Recorder = {
  watchId: null,
  pts: [],
  startTime: null,
  lastFix: null,
  onTick: null,

  start(onTick) {
    if (!("geolocation" in navigator)) return Promise.reject(new Error("Géolocalisation non disponible dans ce navigateur."));
    this.onTick = onTick;
    this.pts = [];
    this.startTime = Date.now();
    return new Promise((resolve, reject) => {
      this.watchId = navigator.geolocation.watchPosition(
        pos => { this.lastFix = pos; this.pts.push({ lat: pos.coords.latitude, lon: pos.coords.longitude, ele: pos.coords.altitude, t: pos.timestamp }); if (this.onTick) this.onTick(this.live()); },
        err => { reject(err); },
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
      );
      resolve();
    });
  },

  live() {
    const s = Geo.stats(this.pts);
    const fix = this.lastFix;
    return {
      dist: s.dist, dur: (Date.now() - this.startTime) / 1000, dplus: s.dplus,
      speed: fix ? (fix.coords.speed != null && fix.coords.speed >= 0 ? fix.coords.speed * 3.6 : s.speed) : 0,
      ele: fix && fix.coords.altitude != null ? fix.coords.altitude : null,
      acc: fix ? fix.coords.accuracy : null,
      npts: this.pts.length
    };
  },

  stop() {
    if (this.watchId != null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    return Geo.decimate(this.pts, 3000);
  }
};
