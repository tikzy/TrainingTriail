"use strict";
/* Moteur d'animation des exercices — squelette à articulations interpolé entre
   poses-clés (mouvement fluide, comme un GIF), corps en volume (capsules),
   matériel (marche, chaise) et corde à sauter animés.
   Chaque pose définit des points nommés : h tête, sp épaules, hip bassin,
   k/a genou/cheville, e/w coude/poignet (L gauche, R droite), plus des
   polylignes optionnelles dash / dash2 (corde, élastique). */

const FIGS = {

  squat: { dur: 2400, frames: [
    { h: [60, 24], sp: [60, 32], hip: [60, 72], kL: [54, 74], aL: [52, 120], kR: [66, 74], aR: [68, 120], eL: [53, 50], wL: [46, 56], eR: [67, 50], wR: [74, 56] },
    { h: [74, 46], sp: [74, 54], hip: [58, 84], kL: [45, 96], aL: [47, 120], kR: [71, 96], aR: [73, 120], eL: [84, 62], wL: [98, 64], eR: [66, 66], wR: [52, 74] },
    null,
    null
  ] },

  fente: { dur: 2400, frames: [
    { h: [62, 24], sp: [62, 32], hip: [62, 74], kL: [54, 76], aL: [52, 120], kR: [72, 76], aR: [74, 120], eL: [52, 50], wL: [44, 58], eR: [72, 50], wR: [80, 58] },
    { h: [70, 40], sp: [70, 48], hip: [66, 88], kL: [46, 104], aL: [38, 116], kR: [80, 90], aR: [86, 100], eL: [58, 62], wL: [48, 68], eR: [82, 64], wR: [92, 70] },
    null, null
  ] },

  stepup: { dur: 2600, box: [64, 92, 118, 122], frames: [
    { h: [44, 26], sp: [44, 34], hip: [44, 76], kL: [46, 94], aL: [50, 118], kR: [58, 84], aR: [66, 92], eL: [36, 52], wL: [28, 60], eR: [52, 52], wR: [60, 58] },
    { h: [86, 22], sp: [86, 30], hip: [86, 70], kL: [84, 82], aL: [82, 90], kR: [90, 82], aR: [94, 90], eL: [78, 46], wL: [68, 40], eR: [94, 48], wR: [104, 44] },
    null, null
  ] },

  bulgare: { dur: 2400, box: [14, 58, 46, 122], frames: [
    { h: [76, 28], sp: [76, 36], hip: [74, 76], kL: [66, 78], aL: [64, 120], kR: [62, 66], aR: [44, 60], eL: [66, 54], wL: [58, 62], eR: [84, 56], wR: [92, 64] },
    { h: [76, 44], sp: [76, 52], hip: [72, 90], kL: [56, 90], aL: [54, 120], kR: [58, 66], aR: [42, 60], eL: [62, 68], wL: [52, 76], eR: [88, 70], wR: [98, 78] },
    null, null
  ] },

  pont: { dur: 2000, frames: [
    { h: [20, 104], sp: [32, 112], hip: [62, 110], kL: [82, 92], aL: [88, 112], kR: [84, 92], aR: [90, 112], eL: [40, 106], wL: [50, 102], eR: [46, 108], wR: [56, 104] },
    { h: [20, 104], sp: [32, 112], hip: [62, 88], kL: [82, 86], aL: [88, 112], kR: [84, 86], aR: [90, 112], eL: [40, 104], wL: [50, 100], eR: [46, 106], wR: [56, 102] },
    null, null
  ] },

  mollets: { dur: 1700, box: [62, 94, 118, 122], frames: [
    { h: [86, 30], sp: [86, 38], hip: [84, 78], kL: [82, 98], aL: [76, 102], kR: [83, 98], aR: [78, 103], eL: [78, 48], wL: [70, 44], eR: [94, 52], wR: [102, 56] },
    { h: [86, 22], sp: [86, 30], hip: [84, 70], kL: [82, 90], aL: [80, 94], kR: [83, 90], aR: [82, 95], eL: [78, 40], wL: [70, 36], eR: [94, 44], wR: [102, 48] },
    null, null
  ] },

  stepdown: { dur: 3200, box: [58, 94, 118, 122], frames: [
    { h: [88, 26], sp: [88, 34], hip: [88, 76], kL: [86, 84], aL: [84, 92], kR: [92, 84], aR: [96, 90], eL: [80, 52], wL: [70, 46], eR: [96, 54], wR: [106, 48] },
    { h: [88, 34], sp: [88, 42], hip: [88, 82], kL: [86, 90], aL: [84, 96], kR: [88, 92], aR: [72, 108], eL: [80, 60], wL: [70, 54], eR: [96, 62], wR: [106, 56] },
    { h: [88, 40], sp: [88, 48], hip: [88, 86], kL: [86, 94], aL: [84, 98], kR: [88, 96], aR: [66, 116], eL: [80, 64], wL: [70, 58], eR: [96, 66], wR: [106, 60] },
    null, null
  ] },

  planche: { dur: 2600, frames: [
    { h: [36, 80], sp: [46, 88], hip: [86, 96], kL: [98, 110], aL: [106, 116], kR: [100, 110], aR: [108, 116], eL: [38, 100], wL: [34, 108], eR: [44, 100], wR: [42, 108] },
    { h: [36, 78], sp: [46, 86], hip: [86, 90], kL: [98, 108], aL: [106, 116], kR: [100, 108], aR: [108, 116], eL: [38, 100], wL: [34, 108], eR: [44, 100], wR: [42, 108] },
    null, null
  ] },

  planchelat: { dur: 2600, frames: [
    { h: [34, 74], sp: [46, 90], hip: [90, 76], kL: [98, 90], aL: [104, 102], kR: [100, 90], aR: [106, 102], eL: [38, 102], wL: [34, 110], eR: [54, 78], wR: [58, 56] },
    { h: [34, 74], sp: [46, 90], hip: [90, 74], kL: [98, 88], aL: [104, 102], kR: [100, 88], aR: [106, 102], eL: [38, 102], wL: [34, 110], eR: [56, 74], wR: [62, 54] },
    null, null
  ] },

  deadbug: { dur: 2800, frames: [
    { h: [22, 104], sp: [34, 112], hip: [74, 112], kL: [78, 92], aL: [76, 78], kR: [86, 92], aR: [96, 98], eL: [38, 100], wL: [36, 82], eR: [48, 106], wR: [62, 108] },
    { h: [22, 104], sp: [34, 112], hip: [74, 112], kL: [78, 92], aL: [76, 78], kR: [88, 96], aR: [106, 108], eL: [28, 106], wL: [14, 110], eR: [48, 104], wR: [62, 106] },
    null, null
  ] },

  birddog: { dur: 2800, frames: [
    { h: [24, 70], sp: [36, 88], hip: [82, 88], kL: [74, 108], aL: [72, 112], kR: [88, 108], aR: [90, 112], eL: [38, 100], wL: [34, 112], eR: [44, 100], wR: [48, 112] },
    { h: [24, 70], sp: [36, 88], hip: [82, 88], kL: [76, 108], aL: [72, 112], kR: [92, 82], aR: [108, 72], eL: [38, 100], wL: [34, 112], eR: [52, 88], wR: [72, 80] },
    null, null
  ] },

  proprio: { dur: 2200, ellipse: [60, 120, 16, 4], frames: [
    { h: [62, 22], sp: [62, 30], hip: [62, 72], kL: [60, 96], aL: [60, 118], kR: [76, 86], aR: [80, 98], eL: [50, 46], wL: [38, 46], eR: [74, 46], wR: [86, 46] },
    { h: [62, 22], sp: [62, 30], hip: [62, 72], kL: [60, 96], aL: [60, 118], kR: [78, 84], aR: [76, 100], eL: [48, 38], wL: [40, 26], eR: [76, 38], wR: [84, 26] }
  ] },

  monstre: { dur: 2000, frames: [
    { h: [60, 22], sp: [60, 30], hip: [60, 70], kL: [50, 94], aL: [44, 118], kR: [70, 94], aR: [76, 118], eL: [51, 40], wL: [42, 34], eR: [69, 40], wR: [78, 34], dash: [[44, 112], [60, 106], [76, 112]] },
    { h: [60, 22], sp: [60, 30], hip: [60, 70], kL: [42, 94], aL: [34, 118], kR: [78, 94], aR: [86, 118], eL: [51, 40], wL: [42, 34], eR: [69, 40], wR: [78, 34], dash: [[34, 112], [60, 104], [86, 112]] },
    null, null
  ] },

  "corde-base": { dur: 620, frames: [
    { h: [60, 26], sp: [60, 34], hip: [60, 70], kL: [54, 72], aL: [52, 118], kR: [66, 72], aR: [68, 118], eL: [52, 54], wL: [44, 62], eR: [68, 54], wR: [76, 62], dash: [[44, 62], [30, 96], [60, 114], [90, 96], [76, 62]] },
    { h: [60, 20], sp: [60, 28], hip: [60, 62], kL: [54, 78], aL: [52, 104], kR: [66, 78], aR: [68, 104], eL: [52, 46], wL: [44, 52], eR: [68, 46], wR: [76, 52], dash: [[44, 52], [28, 26], [60, 12], [92, 26], [76, 52]] }
  ] },

  "corde-alterne": { dur: 600, frames: [
    { h: [60, 26], sp: [60, 34], hip: [60, 70], kL: [50, 78], aL: [42, 118], kR: [68, 76], aR: [74, 112], eL: [52, 54], wL: [44, 62], eR: [68, 54], wR: [76, 62], dash: [[44, 62], [28, 96], [60, 116], [92, 96], [76, 62]] },
    { h: [60, 26], sp: [60, 34], hip: [60, 70], kL: [52, 76], aL: [46, 112], kR: [70, 78], aR: [78, 118], eL: [52, 54], wL: [44, 62], eR: [68, 54], wR: [76, 62], dash: [[44, 62], [28, 96], [60, 116], [92, 96], [76, 62]] }
  ] },

  "corde-genoux": { dur: 600, frames: [
    { h: [60, 22], sp: [60, 30], hip: [60, 64], kL: [50, 84], aL: [48, 96], kR: [68, 88], aR: [66, 118], eL: [50, 48], wL: [42, 54], eR: [70, 48], wR: [78, 54], dash: [[42, 54], [28, 78], [60, 88], [92, 78], [78, 54]] },
    { h: [60, 22], sp: [60, 30], hip: [60, 64], kL: [52, 88], aL: [54, 118], kR: [70, 84], aR: [72, 96], eL: [50, 48], wL: [42, 54], eR: [70, 48], wR: [78, 54], dash: [[42, 54], [28, 40], [60, 26], [92, 40], [78, 54]] }
  ] },

  "corde-latereau": { dur: 660, frames: [
    { h: [46, 24], sp: [46, 32], hip: [46, 66], kL: [40, 68], aL: [38, 118], kR: [52, 68], aR: [54, 118], eL: [38, 52], wL: [30, 56], eR: [54, 52], wR: [62, 56], dash: [[30, 56], [16, 90], [48, 110], [80, 90], [62, 56]] },
    { h: [74, 24], sp: [74, 32], hip: [74, 66], kL: [68, 68], aL: [66, 118], kR: [80, 68], aR: [82, 118], eL: [66, 52], wL: [58, 56], eR: [82, 52], wR: [90, 56], dash: [[58, 56], [40, 90], [72, 110], [104, 90], [90, 56]] }
  ] },

  "corde-double": { dur: 700, frames: [
    { h: [60, 18], sp: [60, 26], hip: [60, 58], kL: [56, 82], aL: [52, 96], kR: [64, 82], aR: [62, 96], eL: [48, 42], wL: [42, 48], eR: [72, 42], wR: [78, 48],
      dash: [[42, 48], [24, 72], [60, 90], [96, 72], [78, 48]], dash2: [[42, 48], [28, 64], [60, 80], [92, 64], [78, 48]] },
    { h: [60, 18], sp: [60, 26], hip: [60, 58], kL: [56, 82], aL: [52, 96], kR: [64, 82], aR: [62, 96], eL: [48, 42], wL: [42, 48], eR: [72, 42], wR: [78, 48],
      dash: [[42, 48], [22, 20], [60, 6], [98, 20], [78, 48]], dash2: [[42, 48], [26, 28], [60, 14], [94, 28], [78, 48]] }
  ] }
};

/* remplace les marqueurs null par un clone de la pose précédente ou suivante
   (pose de pause : le mouvement marque un temps d'arrêt à l'amplitude) */
(function fillHolds() {
  Object.keys(FIGS).forEach(id => {
    const frames = FIGS[id].frames;
    for (let i = 0; i < frames.length; i++)
      if (frames[i] === null) frames[i] = JSON.parse(JSON.stringify(frames[i - 1] || frames[frames.length - 1]));
  });
})();

/* ---------- moteur ---------- */
const _lerp = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
const _ease = u => u * u * (3 - 2 * u); // démarrage/arrêt souples, comme un geste réel

function poseAt(fig, t) {
  const n = fig.frames.length;
  const x = t * n;
  const seg = Math.floor(x) % n;
  const u = _ease(x - Math.floor(x));
  const A = fig.frames[seg], B = fig.frames[(seg + 1) % n];
  const out = {};
  ["h", "sp", "hip", "kL", "aL", "kR", "aR", "eL", "wL", "eR", "wR"].forEach(k => {
    out[k] = A[k] && B[k] ? _lerp(A[k], B[k], u) : (A[k] || B[k] || null);
  });
  ["dash", "dash2"].forEach(k => {
    if (A[k] && B[k] && A[k].length === B[k].length) out[k] = A[k].map((p, i) => _lerp(p, B[k][i], u));
    else out[k] = A[k] || B[k] || null;
  });
  return out;
}

/* dégradés partagés par toutes les figures (sol, bois des marches/chaises).
   Injectés une seule fois dans un SVG masqué : chaque figure y fait référence
   par url(#g-gnd) / url(#g-wood). */
(function injectDefs() {
  const d = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  d.setAttribute("width", "0"); d.setAttribute("height", "0");
  d.setAttribute("aria-hidden", "true");
  d.style.position = "absolute";
  d.innerHTML =
    '<defs>' +
    '<linearGradient id="g-gnd" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#2c3d5f"/><stop offset="1" stop-color="#141d31"/>' +
    "</linearGradient>" +
    '<linearGradient id="g-wood" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#8a6a44"/><stop offset="1" stop-color="#5d452c"/>' +
    "</linearGradient>" +
    "</defs>";
  document.body.appendChild(d);
})();

function drawPose(p) {
  const line = (a, b, w, cls) => a && b
    ? '<line x1="' + a[0].toFixed(1) + '" y1="' + a[1].toFixed(1) + '" x2="' + b[0].toFixed(1) + '" y2="' + b[1].toFixed(1) + '" stroke-width="' + w + '" class="' + cls + '"/>'
    : "";
  const poly = (pts, w, cls) => pts && pts[0]
    ? '<polyline points="' + pts.filter(Boolean).map(q => q[0].toFixed(1) + "," + q[1].toFixed(1)).join(" ") + '" stroke-width="' + w + '" class="' + cls + '"/>'
    : "";
  const dot = (a, r, cls) => a
    ? '<circle cx="' + a[0].toFixed(1) + '" cy="' + a[1].toFixed(1) + '" r="' + r + '" class="' + cls + '"/>'
    : "";
  /* un membre en deux tons : habit (hanche→genou / épaule→coude) puis peau,
     avec l'articulation en cercle pour un rendu « capsule » continu */
  const limb2 = (a, mid, b, wUp, wLo, jR, upCls, loCls, jCls, far) => {
    let s = "";
    s += line(a, mid, wUp, upCls + (far ? " far" : ""));
    s += line(mid, b, wLo, loCls + (far ? " far" : ""));
    s += dot(mid, jR, jCls + (far ? " far" : ""));
    return s;
  };
  let s = "";
  // ombre portée sous le bassin
  if (p.hip) s += '<ellipse cx="' + p.hip[0].toFixed(1) + '" cy="121" rx="24" ry="4" class="shadow"/>';
  // membres éloignés (côté droit) : atténués pour la profondeur
  s += limb2(p.hip, p.kR, p.aR, 8, 6.5, 3.6, "leg-up", "leg-lo", "knee", true);
  s += dot(p.aR, 3.4, "shoe far");
  s += limb2(p.sp, p.eR, p.wR, 5.5, 4.8, 2.6, "arm-up", "arm-lo", "elbow", true);
  s += dot(p.wR, 2.6, "hand far");
  // tronc (tee-shirt), cou, tête + cheveux
  s += line(p.sp, p.hip, 14, "torso");
  if (p.sp && p.h) s += line(p.sp, [p.sp[0] + (p.h[0] - p.sp[0]) * 0.55, p.sp[1] + (p.h[1] - p.sp[1]) * 0.55], 4, "neck");
  if (p.h) {
    s += '<circle cx="' + p.h[0].toFixed(1) + '" cy="' + p.h[1].toFixed(1) + '" r="8.5" class="head"/>';
    s += '<path d="M ' + (p.h[0] - 8.2).toFixed(1) + " " + (p.h[1] - 1).toFixed(1) +
      " A 8.2 8.2 0 0 1 " + (p.h[0] + 8.2).toFixed(1) + " " + (p.h[1] - 1).toFixed(1) + '" class="hair"/>';
  }
  // membres proches (côté gauche)
  s += limb2(p.hip, p.kL, p.aL, 8, 6.5, 3.6, "leg-up", "leg-lo", "knee", false);
  s += dot(p.aL, 3.4, "shoe");
  s += limb2(p.sp, p.eL, p.wL, 5.5, 4.8, 2.6, "arm-up", "arm-lo", "elbow", false);
  s += dot(p.wL, 2.6, "hand");
  // corde / élastique par-dessus le corps
  if (p.dash) s += poly(p.dash, 2, "dashline");
  if (p.dash2) s += poly(p.dash2, 2, "dashline");
  return s;
}

function figureHTML(id) {
  const fig = FIGS[id];
  if (!fig) return "";
  let stat = "";
  if (fig.box) {
    stat += '<rect x="' + fig.box[0] + '" y="' + fig.box[1] + '" width="' + (fig.box[2] - fig.box[0]) +
      '" height="' + (fig.box[3] - fig.box[1]) + '" rx="2" class="box"/>';
    // veines du bois
    for (const f of [0.33, 0.66]) {
      const gy = fig.box[1] + (fig.box[3] - fig.box[1]) * f;
      stat += '<line x1="' + fig.box[0] + '" y1="' + gy.toFixed(1) + '" x2="' + fig.box[2] + '" y2="' + gy.toFixed(1) + '" class="box-grain"/>';
    }
  }
  if (fig.ellipse) stat += '<ellipse cx="' + fig.ellipse[0] + '" cy="' + fig.ellipse[1] + '" rx="' + fig.ellipse[2] + '" ry="' + fig.ellipse[3] + '" class="dashline"/>';
  return '<svg class="exfig exanim" data-fig="' + id + '" viewBox="0 0 120 130" aria-hidden="true">' +
    '<rect x="4" y="122" width="112" height="7" rx="2" class="gnd-strip"/>' +
    '<line x1="8" y1="122" x2="112" y2="122" class="gnd"/>' +
    '<path d="M22 122 l-3 4 M46 122 l-2 4 M74 122 l3 4 M98 122 l-2 4" class="ground-tex"/>' +
    stat + '<g class="dyn"></g></svg>';
}

/* boucle d'animation unique pour toutes les figures visibles (~30 fps).
   Double pilotage : requestAnimationFrame (fluide, synchronisé à l'écran) +
   setInterval en filet de sécurité (onglets en arrière-plan, environnements
   sans rAF) — le throttle interne évite les double-dessins. */
(function animLoop() {
  let last = 0;
  function frame() {
    const now = performance.now();
    if (now - last < 32) return;
    last = now;
    document.querySelectorAll("svg.exanim").forEach(svg => {
      const fig = FIGS[svg.dataset.fig];
      const g = svg.querySelector("g.dyn");
      if (!fig || !g) return;
      if (svg._off == null) svg._off = Math.floor(Math.random() * fig.dur);
      const t = ((now + svg._off) % fig.dur) / fig.dur;
      g.innerHTML = drawPose(poseAt(fig, t));
    });
  }
  requestAnimationFrame(function tick() { frame(); requestAnimationFrame(tick); });
  setInterval(frame, 50);
})();
