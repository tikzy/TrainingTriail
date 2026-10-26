"use strict";
/* TrainingTrail — application principale (vanilla JS, données en localStorage) */

/* ================= état ================= */
const LS_KEY = "trainingtrail_v1";
let state = {
  start: DEFAULT_START,
  done: {},       // clé "w-d-i" -> true
  moves: {},      // clé "w-d-i" -> { w, d } : séance déplacée sur un autre jour
  hidden: {},     // clé "w-d-i" -> true : séance du programme masquée (onglet Semaine)
  custom: [],     // séances ajoutées : [{ id, w, d, c, t, m }]
  timers: {},     // minuteurs standard enregistrés : { exoId: { work, rest, reps, sets, setrest } }
  profile: null, // profil coureur : { fcm, repos, poids, vma } — alimente zones et coach
  loads: {},     // dernière charge de renforcement par exercice : { exoId: { kg, reps, date } }
  daily: {},     // quotidiennes cochées : { "YYYY-MM-DD": { PROP: true, MAS: true } } — hors volume
  notes: {},     // notes personnelles par semaine : { "S12": "..." }
  ui: { theme: "dark", font: 0 }, // thème clair/sombre et taille de police (0 normale, 1 grande)
  password: null, // mot de passe d'accès (Réglages) ; null = pas de verrou
  extra: [],      // temps d'exercice hors programme : [{id, date, code, label, min, runId}]
  runs: [],       // sorties réelles + feedback
  shoes: [],
  lastShoeId: null,
  seq: 1,
  lastWeekView: null,
  mistral: { key: "", model: "mistral-small-latest", url: "https://api.mistral.ai" },
  chat: []        // conversation coach : [{role, content}]
};

let storageWarned = false;
function save() {
  state.updatedAt = Date.now();
  const write = () => localStorage.setItem(LS_KEY, JSON.stringify(state));
  try { write(); }
  catch (e) {
    // quota dépassé : compacter d'abord les traces GPS, puis les supprimer en dernier recours
    try {
      state.runs.forEach(r => { if (r.points && r.points.length) r.points = Geo.compact(r.points, 1200); });
      write();
    } catch (e2) {
      const withPts = state.runs.slice().sort((a, b) => a.id - b.id).filter(r => r.points);
      let ok = false;
      for (const r of withPts) { r.points = null; try { write(); ok = true; break; } catch (e3) {} }
      if (!ok && !storageWarned) {
        storageWarned = true;
        toast("Sauvegarde impossible : stockage du navigateur plein. Exporte tes données (Réglages) puis supprime d'anciennes sorties.");
      }
      if (!ok) console.error("Échec de la sauvegarde localStorage", e);
    }
  }
  ServerSync.push();
  updateSaveStamp();
}
function updateSaveStamp() {
  const el = $("#save-stamp");
  if (el) el.textContent = "Enregistré à " + new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}
function load() {
  try { const raw = localStorage.getItem(LS_KEY); if (raw) Object.assign(state, JSON.parse(raw)); }
  catch (e) { console.warn("Lecture localStorage impossible", e); }
  normalizeState();
}
function normalizeState() {
  if (!state.done) state.done = {};
  if (!state.moves) state.moves = {};
  if (!state.hidden) state.hidden = {};
  if (!state.custom) state.custom = [];
  if (!state.timers) state.timers = {};
  if (!state.profile) state.profile = null;
  if (!state.loads) state.loads = {};
  if (!state.daily) state.daily = {};
  if (!state.notes) state.notes = {};
  if (!state.ui) state.ui = { theme: "dark", font: 0 };
  applyUi();
  if (state.password == null) state.password = "0612"; // verrou par défaut (modifiable en Réglages, vide = pas de verrou)
  if (!state.extra) state.extra = [];
  if (!state.runs) state.runs = [];
  if (!state.shoes) state.shoes = [];
  if (state.lastShoeId == null) state.lastShoeId = null;
  if (!state.mistral) state.mistral = { key: "", model: "mistral-small-latest", url: "https://api.mistral.ai" };
  if (!state.chat) state.chat = [];
}
load();

/* ================= dates ================= */
const DAY_NAMES = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
function parseDate(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
function weekStartDate(n) { const s = parseDate(state.start); return new Date(s.getTime() + (n - 1) * 7 * 864e5); }
function weekDates(n) { const s = weekStartDate(n); return Array.from({ length: 7 }, (_, i) => new Date(s.getTime() + i * 864e5)); }
function daysBetween(a, b) { return Math.round((parseDate(b) - parseDate(a)) / 864e5); }
function isoDate(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function fmtDate(d) { return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }); }
function fmtDateShort(d) { return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }); }
function fmtDur(sec) {
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h > 0) return h + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}
function fmtHours(min) { return (Math.round((min / 60) * 10) / 10).toLocaleString("fr-FR"); }
function raceDay() { return parseDate(RACE.date); }
function currentWeek() {
  const days = Math.floor((Date.now() - parseDate(state.start).getTime()) / 864e5);
  if (days < 0) return 1;
  return Math.min(29, Math.floor(days / 7) + 1);
}
function todayIdx() { return (new Date().getDay() + 6) % 7; } // 0 = lundi
function weekOfDate(iso) {
  const d = parseDate(iso), start = parseDate(state.start);
  const days = Math.floor((d - start) / 864e5);
  if (days < 0) return 1;
  return Math.min(29, Math.floor(days / 7) + 1);
}
function dayIndexOfDate(iso) { const d = parseDate(iso); return (d.getDay() + 6) % 7; }
function blockOf(w) { return BLOCKS.find(b => w >= b.weeks[0] && w <= b.weeks[1]); }

/* ================= aide ================= */
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/* toast avec action optionnelle : toast("Message", { label: "Annuler", fn: () => … }) */
function toast(msg, action) {
  const t = $("#toast");
  t.innerHTML = esc(msg) + (action ? ' <button id="toast-act">' + esc(action.label) + "</button>" : "");
  t.classList.remove("hidden");
  clearTimeout(t._h);
  if (action) {
    const b = $("#toast-act");
    if (b) b.addEventListener("click", () => { t.classList.add("hidden"); action.fn(); });
  }
  t._h = setTimeout(() => t.classList.add("hidden"), action ? 6000 : 3200);
}
/* vibration (Android ; silencieuse ailleurs) */
function vib(pattern) { try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { } }
/* écran allumé pendant un minuteur ou un enregistrement */
let wakeLock = null;
async function lockScreenOn() {
  try { if ("wakeLock" in navigator && !wakeLock) wakeLock = await navigator.wakeLock.request("screen"); } catch (e) { }
}
function unlockScreen() { if (wakeLock) { try { wakeLock.release(); } catch (e) { } wakeLock = null; } }
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && ((typeof Timer !== "undefined" && Timer.run) || (typeof Recorder !== "undefined" && Recorder.active))) lockScreenOn();
});
function typeChip(code) {
  const ty = TYPES[code]; if (!ty) return "";
  const kindCls = { run: "c-run", strength: "c-str", jump: "c-corde", bike: "c-bike", swim: "c-swim", yoga: "c-yoga", recovery: "c-rec", rest: "c-rest" }[ty.kind] || "";
  return '<span class="chip ' + kindCls + '">' + esc(ty.label) + "</span>";
}
function itemKey(w, d, i) { return w + "-" + d + "-" + i; }
function isDone(w, d, i) { return !!state.done[itemKey(w, d, i)]; }
function toggleDone(w, d, i) {
  const k = itemKey(w, d, i);
  if (state.done[k]) delete state.done[k]; else state.done[k] = true;
  save();
}

/* ================= profil & zones ================= */
/* zones de Fréquence cardiaque selon Karvonen : repos + % × (FCM − repos) */
function hrZones() {
  const p = state.profile;
  if (!p || !p.fcm) return null;
  const rest = p.repos != null ? p.repos : 0;
  const z = pct => Math.round(rest + (pct / 100) * (p.fcm - rest));
  return [
    { name: "Z1 · récupération", lo: z(50), hi: z(60) },
    { name: "Z2 · endurance fondamentale", lo: z(60), hi: z(70) },
    { name: "Z3 · tempo", lo: z(70), hi: z(80) },
    { name: "Z4 · seuil", lo: z(80), hi: z(90) },
    { name: "Z5 · VMA", lo: z(90), hi: p.fcm }
  ];
}
function zonesHTML() {
  const zs = hrZones();
  if (!zs) return "";
  return '<div class="zones"><b>Tes zones (Karvonen)</b>' +
    zs.map(z => '<div class="zone-row"><span>' + esc(z.name) + "</span><b>" + z.lo + "–" + z.hi + " bpm</b></div>").join("") +
    (state.profile.repos != null ? "" : '<div class="muted small">Précise ta FC de repos (Réglages) pour des zones exactes.</div>') +
    "</div>";
}

/* ================= budget de stockage des traces GPS =================
   Sans stockage R2, l'état synchronisé est plafonné (2 Mo). Les 12 sorties
   les plus récentes gardent leur trace complète ; les plus anciennes sont
   réduites à ~100 points (profil et courbes restent lisibles). */
function slimOldTracks() {
  let ptsSize = 0;
  state.runs.forEach(r => { if (r.points) ptsSize += JSON.stringify(r.points).length; });
  if (ptsSize < 600000) return; // loin de la limite : rien à faire
  const withPts = state.runs.filter(r => r.points && r.points.length > 150)
    .sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.id - a.id);
  let changed = false;
  withPts.forEach((r, idx) => {
    if (idx >= 12) { r.points = Geo.decimate(r.points, 100); changed = true; }
  });
  if (changed) {
    save();
    toast("Anciennes traces GPS allégées pour tenir dans le stockage centralisé.");
  }
}

/* ================= apparence (thème, taille) ================= */
function applyUi() {
  const root = document.documentElement;
  if (state.ui && state.ui.theme === "light") root.classList.add("theme-light");
  else root.classList.remove("theme-light");
  root.dataset.font = String((state.ui && state.ui.font) || 0);
}

/* ---------- déplacements / échanges de séances ----------
   state.moves : { "w-d-i": { w, d } } — la séance d'origine (w, d, i) est
   affichée sur le jour cible. L'identité reste l'emplacement d'origine,
   donc les cochages existants et la synchronisation continuent de fonctionner. */
function moveOf(w, d, i) { return state.moves[itemKey(w, d, i)] || null; }
function isMoved(w, d, i) { return !!moveOf(w, d, i); }
function effPosOf(w, d, i) { const m = moveOf(w, d, i); return m ? m : { w, d }; }

/* séances ajoutées par l'utilisateur : identité "cust-<id>" */
function customKey(id) { return "cust-" + id; }
function customOfKey(k) {
  if (!String(k).startsWith("cust-")) return null;
  const id = +String(k).slice(5);
  return (state.custom || []).find(c => c.id === id) || null;
}
function itemDone(x) { return x.isCustom ? !!state.done[customKey(x.custom.id)] : isDone(x.w, x.d, x.i); }
function effPosOfKey(k) { const c = customOfKey(k); if (c) return { w: c.w, d: c.d }; const [w, d, i] = String(k).split("-").map(Number); return effPosOf(w, d, i); }

/* échange deux séances (programme ou ajoutée) — retourne false si impossible */
function swapItems(ka, kb) {
  const ca = customOfKey(ka), cb = customOfKey(kb);
  if (ka === kb) return false;
  if (ca && cb) {
    const tw = ca.w, td = ca.d; ca.w = cb.w; ca.d = cb.d; cb.w = tw; cb.d = td;
    save(); return true;
  }
  if (ca) { const bPos = effPosOfKey(kb); const aw = ca.w, ad = ca.d; ca.w = bPos.w; ca.d = bPos.d; state.moves[kb] = { w: aw, d: ad }; save(); return true; }
  if (cb) { const aPos = effPosOfKey(ka); const bw = cb.w, bd = cb.d; cb.w = aPos.w; cb.d = aPos.d; state.moves[ka] = { w: bw, d: bd }; save(); return true; }
  const aPos = effPosOfKey(ka), bPos = effPosOfKey(kb);
  if (aPos.w === bPos.w && aPos.d === bPos.d) return false; // même jour : échange visuel sans effet
  state.moves[ka] = { w: bPos.w, d: bPos.d };
  state.moves[kb] = { w: aPos.w, d: aPos.d };
  save(); return true;
}

/* semaine « effective » : chaque jour contient les séances à leur place
   réelle (d'origine ou déplacée), chaque entrée portant son identité d'origine
   { it, w, d, i, moved } — itérer WEEKS en entier car une séance peut venir
   d'une autre semaine. Les séances masquées (state.hidden) sont retirées,
   les séances ajoutées (state.custom) sont insérées { it, custom, isCustom }. */
function effWeek(n) {
  const days = [[], [], [], [], [], [], []];
  WEEKS.forEach(wk => wk.days.forEach((day, d) => day.forEach((it, i) => {
    const key = itemKey(wk.n, d, i);
    if (state.hidden && state.hidden[key]) return;
    const pos = effPosOf(wk.n, d, i);
    if (pos.w !== n) return;
    days[pos.d].push({ it, w: wk.n, d, i, moved: pos.w !== wk.n || pos.d !== d });
  })));
  (state.custom || []).forEach(c => {
    if (c.w === n) days[c.d].push({ it: { c: c.c, t: c.t, m: c.m || 0 }, custom: c, isCustom: true });
  });
  const base = WEEKS[n - 1];
  return { n, light: base.light, vol: base.vol, days };
}

function weekItems(n) {
  const out = [];
  effWeek(n).days.forEach(day => day.forEach(x => out.push(x)));
  return out;
}
function allItems(weekN) {
  const out = [];
  effWeek(weekN).days.forEach(day => day.forEach(x => out.push({ w: x.w, d: x.d, i: x.i, it: x.it, isCustom: !!x.isCustom, custom: x.custom })));
  return out;
}
function plannedMinutes(weekN) { return weekItems(weekN).reduce((s, x) => s + (x.it.m || 0), 0); }
function doneMinutes(weekN) { return weekItems(weekN).filter(x => itemDone(x)).reduce((s, x) => s + (x.it.m || 0), 0); }

/* ---------- temps réalisé : cochages du programme + exercices hors programme ---------- */
function extraMinutes(weekN) {
  return (state.extra || []).filter(e => weekOfDate(e.date) === weekN).reduce((s, e) => s + (e.min || 0), 0);
}
function totalExtraMin() { return (state.extra || []).reduce((s, e) => s + (e.min || 0), 0); }
function addExtra(label, min, code) {
  min = Math.round(min);
  if (!min || min < 1) return null;
  const e = { id: state.seq++, date: isoDate(new Date()), code: code || "EXO", label: label || "Exercice libre", min };
  state.extra.push(e);
  save();
  return e;
}

/* ---------- sorties : le temps réel remplace les minutes planifiées ----------
   Une sortie enregistrée compte pour sa durée réelle dans le volume réalisé.
   Si elle correspond à une séance prévue ce jour-là et que cette case est
   cochée, la durée réelle REMPLPLACE les minutes planifiées (une séance
   prévue à 45' mais courue en 52' compte pour 52'). */
function plannedRunEntry(date) {
  const w = weekOfDate(date);
  const day = effWeek(w).days[dayIndexOfDate(date)];
  return day.find(x => RUN_CODES.includes(x.it.c) && x.it.c !== "GAM" && x.it.c !== "LD") || null;
}
function itemOfKey(key) {
  const [w, d, i] = String(key).split("-").map(Number);
  const day = WEEKS[w - 1] && WEEKS[w - 1].days[d];
  return day ? day[i] : null;
}
/* clé de la séance prévue correspondant à une sortie (stockée à l'enregistrement ;
   pour les anciennes sorties, retrouvée via le titre mémorisé dans r.planned) */
function runPlanKey(r) {
  if (r.planKey) return r.planKey;
  if (!r.planned) return null;
  const w = weekOfDate(r.date);
  const day = effWeek(w).days[dayIndexOfDate(r.date)];
  const pe = day.find(x => x.it.t === r.planned && RUN_CODES.includes(x.it.c));
  return pe ? (pe.isCustom ? customKey(pe.custom.id) : itemKey(pe.w, pe.d, pe.i)) : null;
}
function runMinutes(weekN) {
  return state.runs.filter(r => weekOfDate(r.date) === weekN).reduce((s, r) => s + (r.dur || 0), 0);
}
function realizedMinutes(weekN) {
  let m = doneMinutes(weekN) + extraMinutes(weekN);
  const replaced = new Set(); // minutes planifiées déjà remplacées (une fois par séance)
  state.runs.forEach(r => {
    if (!r.dur || r.dur < 1) return;
    if (weekOfDate(r.date) !== weekN) return;
    m += r.dur;                                   // temps réel de la sortie
    const k = runPlanKey(r);
    if (k && state.done[k] && !replaced.has(k)) {
      const cust = customOfKey(k);
      if (cust) { replaced.add(k); m -= (cust.m || 0); }        // minutes planifiées de la séance ajoutée
      else {
        const [w2, d2, i2] = k.split("-").map(Number);
        if (effPosOf(w2, d2, i2).w !== weekN) return;
        replaced.add(k);
        const it = itemOfKey(k);
        if (it) m -= (it.m || 0);                   // …à la place des minutes planifiées
      }
    }
  });
  return m;
}
function weekProgressPct() {
  let total = 0, done = 0;
  for (let n = 1; n <= WEEKS.length; n++) weekItems(n).forEach(x => { total++; if (itemDone(x)) done++; });
  return total ? Math.round(100 * done / total) : 0;
}
function totalPlannedMin() { let s = 0; for (let n = 1; n <= WEEKS.length; n++) s += plannedMinutes(n); return s; }
function totalRealizedMin() { let s = 0; for (let n = 1; n <= WEEKS.length; n++) s += realizedMinutes(n); return s; }

/* ================= navigation ================= */
$$("nav#tabs button").forEach(btn => {
  btn.addEventListener("click", () => {
    $$("nav#tabs button").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    $$(".view").forEach(v => v.classList.remove("active"));
    $("#view-" + btn.dataset.view).classList.add("active");
    renderView(btn.dataset.view);
    window.scrollTo(0, 0);
  });
});
function showView(name) { $$('nav#tabs button[data-view="' + name + '"]').forEach(b => b.click()); }


function renderView(name) {
  if (name === "today") renderToday();
  else if (name === "semaine") renderSemaine();
  else if (name === "program") renderProgram();
  else if (name === "exercises") renderExercises();
  else if (name === "runs") renderRuns();
  else if (name === "shoes") renderShoes();
  else if (name === "progress") renderProgress();
  else if (name === "conseil") renderConseil();
  else if (name === "coach") renderCoach();
  else if (name === "settings") renderSettings();
  updateHeader();
}

/* ================= vue : semaine (organiser les séances) ================= */
let SwapSel = null; // clé de la séance sélectionnée pour un échange (⇄ puis clic sur une autre séance)
function swapKeyOf(x) { return x.isCustom ? customKey(x.custom.id) : itemKey(x.w, x.d, x.i); }

function semItemHTML(x, dates, d) {
  const key = swapKeyOf(x);
  const sel = SwapSel && SwapSel.key === key ? " swap-sel" : "";
  const done = itemDone(x);
  const past = dates && dates[d] && !done && (dates[d].getTime() + 864e5) < Date.now() ? " missed" : "";
  const cb = x.isCustom
    ? '<input type="checkbox" ' + (done ? "checked " : "") + 'data-custom="' + x.custom.id + '">'
    : '<input type="checkbox" ' + (done ? "checked " : "") + 'data-w="' + x.w + '" data-d="' + x.d + '" data-i="' + x.i + '">';
  const mv = !x.isCustom && isMoved(x.w, x.d, x.i);
  return '<div class="item ' + (done ? "done" : "") + sel + past + '" data-swapkey="' + esc(key) + '">' +
    '<label class="item-l">' + cb + typeChip(x.it.c) +
    '<span class="item-txt">' + esc(x.it.t) +
    (mv ? ' <span class="moved-badge" title="Séance déplacée ici">déplacée</span>' : "") +
    (x.isCustom ? '<span class="custom-badge">ajoutée</span>' : "") + "</span></label>" +
    '<div class="item-actions">' +
    '<button class="icon-btn" data-sem-swap="' + esc(key) + '" title="Échanger avec une autre séance">⇄</button>' +
    '<button class="icon-btn" data-sem-move="' + esc(key) + '" title="Déplacer sur un autre jour (ou une autre semaine)">→</button>' +
    '<button class="icon-btn del" data-sem-hide="' + esc(key) + '" title="' + (x.isCustom ? "Supprimer cette séance ajoutée" : "Masquer cette séance") + '">✕</button>' +
    "</div></div>";
}

/* avertissements basés sur les règles du plan (coach-trail) */
function planWarnings(cur, week) {
  const warns = [];
  const isStrength = it => ["RMA", "RMB", "RMC", "CORDE", "GAING"].includes(it.c);
  const isHard = it => /^SQ/.test(it.c) || it.c === "SL" || it.c === "LD";
  week.days.forEach((day, d) => day.forEach(x => {
    if (!isStrength(x.it)) return;
    (week.days[d + 1] || []).forEach(y => {
      if (isHard(y.it)) warns.push(esc("Renforcement (" + TYPES[x.it.c].label + ") la veille de « " + y.it.t + " » — le plan dit : jamais de renforcement la veille d'une qualité ou d'une sortie longue."));
    });
  }));
  const last2 = state.runs.slice(-2);
  if (last2.length === 2 && last2.every(r => (r.knee != null && r.knee > 3) || (r.ankle != null && r.ankle > 3)))
    warns.push(esc("Douleur > 3/10 sur les deux dernières sorties : retire le dénivelé négatif de la semaine ; consulte si ça persiste deux semaines (règle du plan)."));
  if (week.light && (state.custom || []).some(c => c.w === cur))
    warns.push(esc("Semaine allégée : les séances ajoutées chargent une semaine qui doit rester douce."));
  return warns;
}

function renderSemaine() {
  const cur = state.lastWeekView || currentWeek();
  const week = effWeek(cur), dates = weekDates(cur);
  let html = "<h2>Ma semaine</h2>" +
    '<div class="muted small">Coche, échange (⇄ puis clique une autre séance), déplace (→), masque (✕) ou ajoute des séances. Les cochages sont conservés.</div>' +
    '<div class="week-selector">' +
    '<button class="icon-btn" id="sprev">◀</button><b style="min-width:150px;text-align:center">Semaine ' + cur + " · " + esc(blockOf(cur).name) + (week.light ? " (allégée)" : "") + "</b>" +
    '<button class="icon-btn" id="snext">▶</button>' +
    '<button class="btn" id="sback">Semaine actuelle</button></div>';
  if (SwapSel) {
    html += '<div class="swap-banner"><b>Échange en cours :</b> ' + esc(SwapSel.label) +
      ' — clique la séance à échanger <button class="btn" id="swap-cancel">Annuler</button></div>';
  }
  html += '<div class="add-form"><div class="form-grid">' +
    '<label>Jour <select id="add-day">' + DAY_NAMES.map((d, i) => '<option value="' + i + '">' + d + "</option>").join("") + "</select></label>" +
    '<label class="full">Séance standard <select id="add-std">' +
      STD_SESSIONS.map(g => '<optgroup label="' + esc(g.g) + '">' + g.items.map(s =>
        '<option value="' + esc(s.c) + "|" + esc(s.t) + "|" + s.m + '">' + esc(s.t) + " (" + s.m + ' min)</option>').join("") + "</optgroup>").join("") +
      '<optgroup label="Autre"><option value="AUTRE|Autre|0">Autre — à définir ci-dessous</option></optgroup>' +
      "</select></label>" +
    '<label>Type <select id="add-type">' + Object.keys(TYPES).map(c => '<option value="' + c + '">' + esc(TYPES[c].label) + "</option>").join("") + "</select></label>" +
    '<label class="full">Titre <input type="text" id="add-title" placeholder="titre libre (si « Autre »)"></label>' +
    '<label>Minutes <input type="number" id="add-min" min="0" max="600" value="30"></label>' +
    "</div>" +
    '<div class="row-actions"><button class="btn primary" id="add-go">Ajouter à la semaine ' + cur + "</button></div></div>";
  const warns = planWarnings(cur, week);
  if (warns.length) html += '<div class="plan-warnings">' + warns.map(w2 => "<div>⚠ " + w2 + "</div>").join("") + "</div>";
  html += '<div class="week-grid big">';
  week.days.forEach((day, d) => {
    html += '<div class="day-card"><div class="day-head"><span>' + DAY_NAMES[d] + ' <span class="muted">' + fmtDateShort(dates[d]) + "</span></span>" +
      (day.length ? '<span class="count">' + day.filter(x => itemDone(x)).length + "/" + day.length + "</span>" : "") + "</div>";
    if (day.length) day.forEach(x => { html += semItemHTML(x, dates, d); });
    else html += '<div class="muted mini-item">repos</div>';
    html += '<div class="row-actions" style="margin:4px 0"><button class="mini-btn" data-add-day="' + d + '">+ Ajouter ici</button></div>';
    html += "</div>";
  });
  html += "</div>";
  const hiddenKeys = Object.keys(state.hidden || {}).filter(k => state.hidden[k]);
  if (hiddenKeys.length) {
    html += "<h3>Séances masquées</h3><div class=\"row-actions\">" + hiddenKeys.map(k => {
      const it = itemOfKey(k);
      return it ? '<button class="btn" data-unhide="' + k + '">Restaurer : ' + esc(it.t) + " (S" + k.split("-")[0] + ", " + DAY_NAMES[+k.split("-")[1]] + ")</button>" : "";
    }).join("") + "</div>";
  }
  html += "<h3>Notes de la semaine</h3>" +
    '<textarea id="week-notes" rows="3" placeholder="Sensations, météo, ajustements… (transmises au coach IA)">' + esc((state.notes || {})["S" + cur] || "") + "</textarea>";
  $("#view-semaine").innerHTML = html;

  $("#sprev").addEventListener("click", () => { state.lastWeekView = Math.max(1, cur - 1); save(); renderSemaine(); });
  $("#snext").addEventListener("click", () => { state.lastWeekView = Math.min(WEEKS.length, cur + 1); save(); renderSemaine(); });
  $("#sback").addEventListener("click", () => { state.lastWeekView = currentWeek(); save(); renderSemaine(); });
  const sc = $("#swap-cancel");
  if (sc) sc.addEventListener("click", () => { SwapSel = null; renderSemaine(); });
  $("#add-std").addEventListener("change", () => {
    const [c, t, m] = $("#add-std").value.split("|");
    if (c === "AUTRE") { $("#add-title").value = ""; $("#add-title").focus(); return; }
    $("#add-type").value = c;
    $("#add-title").value = t;
    $("#add-min").value = m;
  });
  $("#add-go").addEventListener("click", () => {
    const c = $("#add-type").value, t = $("#add-title").value.trim() || (TYPES[c] ? TYPES[c].label : c);
    state.custom.push({ id: state.seq++, w: cur, d: +$("#add-day").value, c, t, m: Math.max(0, +$("#add-min").value || 0) });
    save(); toast("Séance ajoutée : " + t + "."); renderSemaine();
  });
  $$("button[data-add-day]").forEach(b => b.addEventListener("click", () => {
    $("#add-day").value = b.dataset.addDay;
    $("#add-title").focus();
    toast("Jour sélectionné — choisis le type et le titre, puis « Ajouter ».");
  }));
  $$("button[data-sem-swap]").forEach(b => b.addEventListener("click", e => {
    e.stopPropagation();
    const key = b.dataset.semSwap;
    if (!SwapSel) {
      const x = weekItems(cur).find(y => swapKeyOf(y) === key);
      SwapSel = { key, label: x ? x.it.t : key };
      toast("Sélection : " + SwapSel.label + " — clique la séance à échanger.");
      renderSemaine();
      return;
    }
    if (SwapSel.key === key) { SwapSel = null; renderSemaine(); return; }
    if (swapItems(SwapSel.key, key)) {
      toast("Séances échangées.");
    } else {
      toast("Impossible : les deux séances sont déjà le même jour.");
    }
    SwapSel = null;
    renderSemaine();
  }));
  $$("button[data-sem-move]").forEach(b => b.addEventListener("click", e => {
    e.stopPropagation();
    const key = b.dataset.semMove;
    if (String(key).startsWith("cust-")) {
      toast("Séance ajoutée : utilise ⇄ (échange) ou ✕ (supprime) puis réajoute-la au bon jour.");
      return;
    }
    const [w, d, i] = key.split("-").map(Number);
    openMoveModal(w, d, i);
  }));
  $$("button[data-sem-hide]").forEach(b => b.addEventListener("click", e => {
    e.stopPropagation();
    const key = b.dataset.semHide;
    if (String(key).startsWith("cust-")) {
      const c = customOfKey(key);
      if (!c || !confirm("Supprimer la séance ajoutée « " + c.t + " » ?")) return;
      state.custom = state.custom.filter(x => x.id !== c.id);
      delete state.done[customKey(c.id)];
      save(); toast("Séance ajoutée supprimée.");
    } else {
      state.hidden[key] = true;
      save();
      toast("Séance masquée.", { label: "Annuler", fn: () => { delete state.hidden[key]; save(); renderSemaine(); } });
    }
    renderSemaine();
  }));
  $$("button[data-unhide]").forEach(b => b.addEventListener("click", () => {
    delete state.hidden[b.dataset.unhide];
    save(); toast("Séance restaurée.");
    renderSemaine();
  }));
  const wn = $("#week-notes");
  if (wn) wn.addEventListener("change", () => {
    state.notes["S" + cur] = wn.value.trim();
    save(); toast("Notes de la semaine enregistrées.");
  });
}

/* ================= vue : conseils ================= */
const TIPS_FOCUS = {
  "Fondation": ["Renforcement / prévention", "Cardio / endurance", "Récupération"],
  "Développement": ["Cardio / endurance", "Renforcement / prévention", "Alimentation — avant l'effort"],
  "Spécifique I": ["Descentes & technique", "Alimentation — pendant l'effort", "Cardio / endurance"],
  "Pic spécifique": ["Alimentation — pendant l'effort", "Cardio / endurance", "Matériel"],
  "Affûtage": ["Mental & jour J", "Récupération", "Matériel"]
};
/* semaines avec course préparatoire (texte de l'item SL) */
const isPrepWeek = n => (WEEKS[n - 1] || { days: [] }).days
  .some(d => d.some(it => it.t && it.t.indexOf("Course préparatoire") !== -1));
/* note propre au bloc courant (règles issues de la bibliographie, cf. coach-trail) */
const BLOCK_NOTES = {
  "Fondation": "",
  "Développement": "Bloc 2 : la sortie longue d'une semaine sur deux suffit — ne l'allonge jamais au-delà de 4 h 30 plus tard ; le volume se compte en temps, pas en kilomètres.",
  "Spécifique I": "Bloc 3 : deux courses préparatoires sont prévues (S15 : trail 25-28 km, S19 : trail 28-32 km) — elles remplacent la sortie longue et servent de répétition générale (matériel, ravito, départ contrôlé, objectifs A/B/C), pas de performance.",
  "Pic spécifique": "Bloc 4 : répartis le profil de la course (environ 130 m de D+/10 km) sur la semaine plutôt que sur une seule sortie (Koop). Vérifie le règlement sur les bâtons avant la fin de S24 : si tu les utilises, entraîne-toi avec dès S25 (au moins 4 semaines).",
  "Affûtage": "Affûtage à décroissance rapide (Koop) : environ 55 % du volume du pic en S26, 40-45 % en S27, 25 % en S28, moins de 2 h en semaine de course — intensité conservée en touches courtes. Les petites douleurs fantômes de l'affûtage sont normales ; accepte ton niveau de forme deux semaines avant la course (Sharman)."
};
function renderConseil() {
  const w = currentWeek(), blk = blockOf(w);
  const focus = (TIPS_FOCUS[blk.name] || []).filter(n => TIPS.some(c => c.cat === n));
  const bnote = BLOCK_NOTES[blk.name] || "";
  let html = "<h2>Conseils</h2>" +
    '<div class="muted small">Fondés sur la bibliographie ultratrail (Koop <i>Training Essentials for Ultrarunning</i>, Koerner <i>Field Guide</i>, Sharman <i>The Art of Ultrarunning</i>, Garza-Hillman <i>Ultrarunning for Normal People</i>) et sur les règles de ton plan. Pour un cas particulier, demande au coach IA.</div>' +
    (bnote ? '<div class="note plan-warnings">' + esc(bnote) + "</div>" : "") +
    (focus.length ? '<div class="note">Bloc actuel : ' + esc(blk.name) + " — catégories les plus utiles maintenant surlignées ci-dessous.</div>" : "");
  if (isPrepWeek(w)) html += '<div class="note plan-warnings">Semaine de course préparatoire : pars volontairement prudent (l\'allure à tenir doit sembler lente), répète exactement le matériel et le ravito du jour J, et repars de chaque ravito en moins de 2 minutes.</div>';
  TIPS.forEach(cat => {
    const hot = focus.includes(cat.cat);
    html += "<h3" + (hot ? " class='tip-focus'" : "") + ">" + esc(cat.cat) + (hot ? ' <span class="badge light">utile maintenant</span>' : "") + "</h3>" +
      '<div class="tip-list">' + cat.tips.map(t => '<div class="tip">' + esc(t) + "</div>").join("") + "</div>";
  });
  $("#view-conseil").innerHTML = html;
}

function updateHeader() {
  const w = currentWeek();
  $("#hdr-week").textContent = "S" + w + (blockOf(w) ? " · " + blockOf(w).name : "");
  const j = Math.max(0, daysBetween(isoDate(new Date()), RACE.date));
  $("#hdr-j").textContent = j;
  $("#hdr-done").textContent = weekProgressPct() + "%";
}

/* ================= cases à cocher de séances ================= */
function itemHTML(w, d, i, it, opts) {
  opts = opts || {};
  const key = itemKey(w, d, i);
  const done = isDone(w, d, i);
  const moved = isMoved(w, d, i);
  const ty = TYPES[it.c] || {};
  const isRun = RUN_CODES.includes(it.c);
  const routineKey = { RMA: "A", RMB: "B", RMC: "C", GAING: "G", CORDE: "S" }[it.c];
  const attrs = [];
  if (it.dplus) attrs.push(it.dplus + " m D+");
  return '<div class="item ' + (done ? "done" : "") + '" data-key="' + key + '">' +
    '<label class="item-l"><input type="checkbox" ' + (done ? "checked" : "") + ' data-w="' + w + '" data-d="' + d + '" data-i="' + i + '">' +
    typeChip(it.c) +
    '<span class="item-txt">' + esc(it.t) + (attrs.length ? ' <span class="dplus">· ' + attrs.join(" · ") + "</span>" : "") +
    (moved ? ' <span class="moved-badge" title="Séance déplacée ici">déplacée</span>' : "") + "</span></label>" +
    '<div class="item-actions">' +
    (ty.desc ? '<button class="icon-btn info" data-info="' + it.c + '" title="Détails de la séance">i</button>' : "") +
    (routineKey ? '<button class="mini-btn" data-routine="' + routineKey + '">Lancer</button>' : "") +
    (isRun && !opts.noRunBtn ? '<button class="mini-btn" data-goto-run="' + w + "-" + d + '">Sortie</button>' : "") +
    '<button class="icon-btn" data-move="' + key + '" title="Déplacer ou échanger cette séance">⇄</button>' +
    (moved ? '<button class="icon-btn" data-unmove="' + key + '" title="Remettre à sa place d\'origine">⟲</button>' : "") +
    "</div></div>";
}

/* délégation globale pour les cases à cocher et boutons */
document.addEventListener("change", e => {
  if (e.target.matches('input[type="checkbox"][data-daily]')) {
    const c = e.target.dataset.daily, day = isoDate(new Date());
    state.daily[day] = state.daily[day] || {};
    if (state.daily[day][c]) delete state.daily[day][c]; else state.daily[day][c] = true;
    vib(30);
    save();
    return;
  }
  if (e.target.matches('input[type="checkbox"][data-custom]')) {
    const k = customKey(+e.target.dataset.custom);
    if (state.done[k]) delete state.done[k]; else state.done[k] = true;
    save();
    const card = e.target.closest(".item");
    if (card) card.classList.toggle("done", !!state.done[k]);
    updateHeader();
    return;
  }
  if (e.target.matches('input[type="checkbox"][data-w]')) {
    const w = +e.target.dataset.w, d = +e.target.dataset.d, i = +e.target.dataset.i;
    toggleDone(w, d, i);
    vib(30);
    const card = e.target.closest(".item");
    if (card) card.classList.toggle("done", isDone(w, d, i));
    updateHeader();
  }
});
document.addEventListener("click", e => {
  const goto = e.target.closest("[data-goto-run]");
  if (goto) {
    const [w, d] = goto.dataset.gotoRun.split("-").map(Number);
    showView("runs");
    setTimeout(() => prefillRunFormFromItem(w, d), 60);
    return;
  }
  const info = e.target.closest("[data-info]");
  if (info) openInfo(info.dataset.info);
  const rt = e.target.closest("[data-routine]");
  if (rt) startRoutine(rt.dataset.routine);
  const mv = e.target.closest("[data-move]");
  if (mv) { openMoveModal(...mv.dataset.move.split("-").map(Number)); return; }
  const um = e.target.closest("[data-unmove]");
  if (um) {
    delete state.moves[um.dataset.unmove];
    save();
    toast("Séance remise à sa place d'origine.");
    refreshMainViews();
  }
});

/* ---------- modal de déplacement / échange ---------- */
let MoveCtx = { w: 0, d: 0, i: 0, view: 1 };
function openMoveModal(w, d, i) {
  const it = (WEEKS[w - 1] || { days: [] }).days[d] && WEEKS[w - 1].days[d][i];
  if (!it) return;
  MoveCtx = { w, d, i, view: w };
  $("#move-title").textContent = "Déplacer : " + it.t;
  paintMoveModal();
  $("#move-modal").classList.remove("hidden");
}
function paintMoveModal() {
  const { w, d, i, view } = MoveCtx;
  const it = WEEKS[w - 1].days[d][i];
  const dates = weekDates(view);
  const mv = moveOf(w, d, i);
  let html = '<div class="muted small" style="margin-bottom:8px">Choisis le jour de réception, ou échange avec une séance existante. ' +
    "Les cochages et l'historique sont conservés.</div>" +
    '<div class="week-selector">' +
    '<button class="icon-btn" id="mv-prev">◀</button>' +
    '<b style="min-width:150px;text-align:center">Semaine ' + view + " · " + esc(blockOf(view).name) + "</b>" +
    '<button class="icon-btn" id="mv-next">▶</button></div>';
  html += '<div class="week-grid">';
  const eff = effWeek(view);
  eff.days.forEach((day, dd) => {
    html += '<div class="day-card' + (view === w && dd === d ? " sel" : "") + '"><div class="day-head"><span>' +
      DAY_NAMES[dd] + ' <span class="muted">' + fmtDateShort(dates[dd]) + "</span></span></div>";
    if (view === w && dd === d && !mv) html += '<div class="mini-item muted">place d\'origine</div>';
    day.forEach(x => {
      const isSelf = x.w === w && x.d === d && x.i === i;
      html += '<div class="mini-item">' + typeChip(x.it.c) + "<span>" + esc(x.it.t) + "</span>" +
        (isSelf ? '<span class="chip c-rest">cette séance</span>' :
          '<button class="mini-btn" data-swapto="' + x.w + "-" + x.d + "-" + x.i + '">Échanger</button>') + "</div>";
    });
    if (!(view === w && dd === d && !mv)) {
      if (mv && view === mv.w && dd === mv.d) html += '<div class="mini-item"><span class="chip c-rest">cette séance</span> <span class="muted">(déplacée ici)</span></div>';
      else html += '<div class="row-actions" style="margin:4px 0"><button class="mini-btn" data-placeto="' + view + "-" + dd + '">Placer ici</button></div>';
    }
    html += "</div>";
  });
  html += "</div>";
  if (mv) html += '<div class="row-actions"><button class="btn" id="mv-restore">Remettre à sa place d\'origine (S' + w + ", " + DAY_NAMES[d] + ")</button></div>";
  html += '<div class="row-actions"><button class="btn primary" id="mv-done">Terminé</button></div>';
  $("#move-body").innerHTML = html;
  $("#mv-prev").addEventListener("click", () => { MoveCtx.view = Math.max(1, MoveCtx.view - 1); paintMoveModal(); });
  $("#mv-next").addEventListener("click", () => { MoveCtx.view = Math.min(WEEKS.length, MoveCtx.view + 1); paintMoveModal(); });
  const rst = $("#mv-restore");
  if (rst) rst.addEventListener("click", () => {
    delete state.moves[itemKey(w, d, i)];
    save(); toast("Séance remise à sa place d'origine.");
    $("#move-modal").classList.add("hidden"); refreshMainViews();
  });
  $("#mv-done").addEventListener("click", () => { $("#move-modal").classList.add("hidden"); refreshMainViews(); });
  $$("#move-body [data-placeto]").forEach(b => b.addEventListener("click", () => {
    const [tw, td] = b.dataset.placeto.split("-").map(Number);
    state.moves[itemKey(w, d, i)] = { w: tw, d: td };
    save();
    toast("Séance déplacée au " + DAY_NAMES[td] + " de la semaine " + tw + ".");
    MoveCtx.view = tw;
    paintMoveModal();
    refreshMainViews();
  }));
  $$("#move-body [data-swapto]").forEach(b => b.addEventListener("click", () => {
    const keyA = itemKey(w, d, i), keyB = b.dataset.swapto;
    if (swapItems(keyA, keyB)) toast("Séances échangées.");
    else toast("Impossible : les deux séances sont déjà le même jour.");
    paintMoveModal();
    refreshMainViews();
  }));
}
$("#move-close").addEventListener("click", () => { $("#move-modal").classList.add("hidden"); refreshMainViews(); });

/* rafraîchit la vue principale active (après un déplacement, une coche hors vue…) */
function refreshMainViews() {
  const active = document.querySelector("nav#tabs button.active");
  renderView(active ? active.dataset.view : "today");
}

/* ---- modal info type de séance ---- */
function openInfo(code) {
  const ty = TYPES[code]; if (!ty) return;
  $("#info-title").textContent = ty.label;
  let body = "<p>" + esc(ty.desc) + "</p>";
  if (code === "RMA" || code === "RMB") {
    const list = EXERCISES.filter(x => x.routine === code.slice(-1));
    body += "<p class='muted'>Exercices : " + list.map(x => esc(x.name)).join(" · ") + "</p>";
  }
  if (code === "CORDE") {
    const list = EXERCISES.filter(x => x.routine === "S");
    body += "<p class='muted'>Exercices : " + list.map(x => esc(x.name)).join(" · ") + "</p>";
  }
  body += '<div class="row-actions"><button class="btn" id="info-start">Lancer la séance</button></div>';
  if ((ty.kind === "run") && hrZones()) body += zonesHTML();
  $("#info-body").innerHTML = body;
  $("#info-modal").classList.remove("hidden");
  const rk = { RMA: "A", RMB: "B", RMC: "C", GAING: "G", CORDE: "S" }[code];
  const st = $("#info-start");
  if (rk) st.addEventListener("click", () => { $("#info-modal").classList.add("hidden"); startRoutine(rk); });
  else st.style.display = "none";
}
$("#info-close").addEventListener("click", () => $("#info-modal").classList.add("hidden"));

/* ligne d'une séance ajoutée par l'utilisateur (identité "cust-<id>") */
function customRowHTML(x, opts) {
  opts = opts || {};
  const done = itemDone(x);
  const key = customKey(x.custom.id);
  return '<div class="item ' + (done ? "done" : "") + '" data-key="' + key + '">' +
    '<label class="item-l"><input type="checkbox" ' + (done ? "checked " : "") + 'data-custom="' + x.custom.id + '">' +
    typeChip(x.it.c) +
    '<span class="item-txt">' + esc(x.it.t) + '<span class="custom-badge">ajoutée</span></span></label>' +
    (opts.actions ? '<div class="item-actions">' +
      '<button class="icon-btn" data-sem-swap="' + key + '" title="Échanger avec une autre séance">⇄</button>' +
      '<button class="icon-btn del" data-sem-hide="' + key + '" title="Supprimer cette séance ajoutée">✕</button>' +
      "</div>" : "") +
    "</div>";
}

/* ================= vue : aujourd'hui ================= */
function renderToday() {
  const w = currentWeek(), idx = todayIdx(), week = effWeek(w);
  const dates = weekDates(w);
  const today = dates[idx];
  const items = week.days[idx]; // entrées { it, w, d, i, moved } (places réelles)
  const wDone = realizedMinutes(w), wPlan = plannedMinutes(w), wExtra = extraMinutes(w), wRun = runMinutes(w);
  const j = daysBetween(isoDate(today), RACE.date);
  const runsToday = items.filter(x => RUN_CODES.includes(x.it.c));

  let html = '<div class="hero">' +
    '<div><div class="hero-date">' + fmtDate(today) + "</div>" +
    '<h2>Semaine ' + w + " — " + esc(blockOf(w).name) + (week.light ? ' <span class="badge light">allégée</span>' : "") + (isPrepWeek(w) ? ' <span class="badge prep">course prép.</span>' : "") + "</h2>" +
    '<div class="muted">Du ' + fmtDateShort(dates[0]) + " au " + fmtDateShort(dates[6]) + " · " + (j >= 0 ? "J−" + j + " avant la course" : "course passée") + "</div></div>" +
    '<div class="hero-weekbar">' + weekBar(w) + "</div></div>";

  html += '<h3>Ce que le programme te propose aujourd\'hui</h3>';
  html += '<div class="day-card today-card">';
  if (items.length === 0) html += '<div class="muted">Pas de séance programmée aujourd\'hui — récupération. Pense à la proprioception (5\') et à l\'automassage si ce n\'est pas déjà fait.</div>';
  items.forEach(x => { html += x.isCustom ? customRowHTML(x) : itemHTML(x.w, x.d, x.i, x.it); });
  html += "</div>";

  html += dailyTodayHTML();
  html += '<h3>Commencer une séance de renforcement (même en décalé)</h3>';
  html += '<div class="row-actions strength-launch">' +
    '<button class="btn" data-routine="A">RM-A · Jambes & chaîne post. (30-35\')</button>' +
    '<button class="btn" data-routine="B">RM-B · Tronc, fessiers & cheville (25-30\')</button>' +
    '<button class="btn" data-routine="C">RM-C · Pliométrie (20\')</button>' +
    '<button class="btn" data-routine="S">Corde à sauter (10-15\')</button>' +
    '<button class="btn" data-routine="G">Gainage léger</button></div>' +
    '<div class="muted small" style="margin-top:-6px">La séance se déroule exercice par exercice : tu coches chaque série faite, puis le site coche la bonne case du programme (premier créneau libre de la semaine — pratique pour décaler une séance).</div>';

  if (runsToday.length) {
    html += '<div class="row-actions">' + runsToday.map(x =>
      '<button class="btn primary" data-goto-run="' + w + "-" + idx + '">Préparer la sortie du jour</button>').join("") +
      '<button class="btn" id="today-record">Enregistrer avec le GPS</button></div>';
  } else {
    html += '<div class="row-actions"><button class="btn" id="today-record">Enregistrer une sortie avec le GPS</button></div>';
  }

  html += '<h3>Aperçu de la semaine</h3><div class="week-grid">';
  week.days.forEach((day, d) => {
    const doneCount = day.filter(x => itemDone(x)).length;
    html += '<div class="day-card ' + (d === idx ? "sel" : "") + '"><div class="day-head">' +
      '<span>' + DAY_NAMES[d].slice(0, 3) + ' <span class="muted">' + fmtDateShort(dates[d]) + "</span></span>" +
      (day.length ? '<span class="count">' + doneCount + "/" + day.length + "</span>" : '<span class="muted">—</span>') + "</div>" +
      day.map(x => '<div class="mini-item ' + (itemDone(x) ? "done" : "") + '">' + typeChip(x.it.c) + "<span>" + esc(x.it.t) + "</span></div>").join("") +
      (day.length ? "" : '<div class="muted mini-item">repos</div>') + "</div>";
  });
  html += "</div>";
  html += '<div class="row-actions"><button class="btn" id="today-semaine">Organiser / modifier la semaine (déplacer, échanger, ajouter, supprimer)</button></div>';

  html += '<div class="stat-cards">' +
    '<div class="stat"><span>' + fmtHours(wDone) + " / " + fmtHours(wPlan) + ' h</span><label>volume réalisé / planifié (min' +
    (wRun ? " · sorties " + wRun + " min réelles" : "") + (wExtra ? " · dont " + wExtra + " hors programme" : "") + ")</label></div>" +
    '<div class="stat"><span>' + esc(String(week.vol)).replace(".", ",") + ' h</span><label>volume indicatif de la semaine</label></div>' +
    '<div class="stat"><span>' + state.runs.length + '</span><label>sorties enregistrées</label></div>' +
    "</div>";

  html += '<div class="note">' + PAIN_RULE + "</div>";
  $("#view-today").innerHTML = html;

  const rec = $("#today-record");
  if (rec) rec.addEventListener("click", () => { showView("runs"); setTimeout(startRecording, 80); });
  const sem = $("#today-semaine");
  if (sem) sem.addEventListener("click", () => showView("semaine"));
}

/* quotidiennes : cochables, comptées à part du volume (jamais dans effWeek) */
function dailyTodayHTML() {
  const day = isoDate(new Date());
  const chk = state.daily[day] || {};
  return '<h3>Quotidiennes — 5 minutes d\'hygiène <span class="muted small">(comptées à part du volume)</span></h3>' +
    '<div class="day-card today-card">' +
    DAILY.map(d =>
      '<label class="item-l"><input type="checkbox" data-daily="' + d.c + '"' + (chk[d.c] ? " checked" : "") + ">" +
      typeChip(d.c) + '<span class="item-txt">' + esc(d.t) + ' <span class="muted small">· ' + esc(d.why) + "</span></span></label>"
    ).join("") + "</div>";
}
function dailyWeekHTML(weekN, dates) {
  let html = "<h3>Quotidiennes <span class=\"muted small\">(hors volume)</span></h3><div class=\"day-card\">";
  DAILY.forEach(d => {
    html += '<div class="daily-week-row">' + typeChip(d.c) + "<span>" + esc(d.t) + "</span><div class=\"daily-dots\">" +
      dates.map((dt, i) => {
        const iso = isoDate(dt);
        const on = (state.daily[iso] || {})[d.c];
        return '<button class="day-dot' + (on ? " on" : "") + '" data-daily-w="' + d.c + "|" + iso + '" title="' +
          DAY_NAMES[i] + " " + fmtDateShort(dt) + '">' + DAY_NAMES[i].slice(0, 1) + "</button>";
      }).join("") + "</div></div>";
  });
  html += "</div>";
  return html;
}

function weekBar(w) {
  const plan = plannedMinutes(w), done = realizedMinutes(w);
  const pct = plan ? Math.min(100, Math.round(100 * done / plan)) : 0;
  return '<div class="weekbar"><div class="weekbar-label">Semaine ' + w + "</div>" +
    '<div class="weekbar-track"><div class="weekbar-fill" style="width:' + pct + '%"></div></div>' +
    '<div class="weekbar-label">' + pct + " %</div></div>";
}

/* ================= vue : programme ================= */
function renderProgram() {
  const cur = state.lastWeekView || currentWeek();
  let html = '<div class="week-selector">' +
    '<button class="icon-btn" id="wprev">◀</button><div class="wsel-wrap">';
  WEEKS.forEach(wk => {
    const b = blockOf(wk.n);
    html += '<button class="wsel ' + (wk.n === cur ? "active" : "") + (isPrepWeek(wk.n) ? " prep" : "") + '" data-w="' + wk.n + '" style="--c:' + b.color + '" title="' + esc(b.name) + (wk.light ? " (allégée)" : "") + (isPrepWeek(wk.n) ? " (course préparatoire)" : "") + '">S' + wk.n + "</button>";
  });
  html += '</div><button class="icon-btn" id="wnext">▶</button>' +
    '<button class="btn" id="wback">Semaine actuelle</button></div>';
  const week = effWeek(cur), dates = weekDates(cur), b = blockOf(cur);
  const plan = plannedMinutes(cur), done = realizedMinutes(cur), wExtra = extraMinutes(cur), wRun = runMinutes(cur);

  html += '<div class="week-head"><h2>S' + cur + " — " + esc(b.name) + (week.light ? ' <span class="badge light">allégée</span>' : "") + (isPrepWeek(cur) ? ' <span class="badge prep">course préparatoire</span>' : "") + "</h2>" +
    '<div class="muted">' + fmtDate(dates[0]) + " → " + fmtDate(dates[6]) + "</div></div>";
  html += '<div class="stat-cards">' +
    '<div class="stat"><span>' + esc(String(week.vol)).replace(".", ",") + ' h</span><label>volume planifié (indicatif)</label></div>' +
    '<div class="stat"><span>' + fmtHours(done) + " / " + fmtHours(plan) + ' h</span><label>réalisé / planifié (cochages, sorties en temps réel' +
    (wExtra ? " + " + wExtra + " min hors programme" : "") + ")</label></div>" +
    "</div>";
  html += dailyWeekHTML(cur, dates);
  html += '<div class="week-grid big">';
  week.days.forEach((day, d) => {
    html += '<div class="day-card"><div class="day-head"><span>' + DAY_NAMES[d] + ' <span class="muted">' + fmtDateShort(dates[d]) + "</span></span>" +
      (day.length ? '<span class="count">' + day.filter(x => itemDone(x)).length + "/" + day.length + "</span>" : "") + "</div>";
    if (day.length) day.forEach(x => { html += x.isCustom ? customRowHTML(x) : itemHTML(x.w, x.d, x.i, x.it); });
    else html += '<div class="muted mini-item">repos</div>';
    html += "</div>";
  });
  html += "</div>";

  html += "<h3>Blocs du programme</h3><div class='blocks'>" + BLOCKS.map(bl =>
    '<div class="block-card" style="--c:' + bl.color + '"><b>Bloc ' + bl.n + "</b> · " + esc(bl.name) +
    ' <span class="muted">S' + bl.weeks[0] + "–S" + bl.weeks[1] + "</span></div>").join("") + "</div>";

  $("#view-program").innerHTML = html;
  $$("button.wsel").forEach(btn => btn.addEventListener("click", () => { state.lastWeekView = +btn.dataset.w; save(); renderProgram(); }));
  $$("button[data-daily-w]").forEach(btn => btn.addEventListener("click", () => {
    const [c, iso] = btn.dataset.dailyW.split("|");
    state.daily[iso] = state.daily[iso] || {};
    if (state.daily[iso][c]) delete state.daily[iso][c]; else state.daily[iso][c] = true;
    vib(30);
    save();
    renderProgram();
  }));
  $("#wprev").addEventListener("click", () => { state.lastWeekView = Math.max(1, cur - 1); save(); renderProgram(); });
  $("#wnext").addEventListener("click", () => { state.lastWeekView = Math.min(29, cur + 1); save(); renderProgram(); });
  $("#wback").addEventListener("click", () => { state.lastWeekView = currentWeek(); save(); renderProgram(); });
}

/* ================= vue : exercices ================= */
function renderExercises() {
  const sections = [
    { r: "A", title: "RM-A — Jambes et chaîne postérieure (lundi matin, 30-35')",
      subtitle: "Fais chaque répétition lentement : quelques répétitions propres valent mieux qu'une série bâclée. Lestez en bloc 2 quand 20 répétitions sont faciles." },
    { r: "B", title: "RM-B — Tronc, fessiers et cheville (jeudi matin, 25-30')",
      subtitle: "La routine anti-essuie-glace et anti-entorse. À faire deux fois par semaine, sans exception, toute l'année." },
    { r: "S", title: "Corde à sauter — pliométrie douce, cheville et coordination (10-15')",
      subtitle: "Règle ta corde : poignées à hauteur d'aisselles en marchant sur le milieu de la corde. Sur sol souple, toujours sur l'avant-pied, genoux souples." }
  ];
  let html = "";
  sections.forEach(sec => {
    const list = EXERCISES.filter(e => e.routine === sec.r);
    html += '<h3>' + esc(sec.title) + '</h3><div class="muted sub">' + esc(sec.subtitle) + "</div>";
    html += '<div class="row-actions"><button class="btn" data-routine="' + sec.r + '">Lancer la séance guidée</button></div>';
    html += '<div class="exo-grid">';
    list.forEach((ex, i) => {
      html += '<div class="exo-card">' +
        '<div class="exo-fig"><span class="exo-num">' + (i + 1) + "</span>" + figureHTML(ex.id) + "</div>" +
        '<div class="exo-body"><h4>' + esc(ex.name) + "</h4>" +
        '<div class="muscles">' + esc(ex.muscles) + "</div>" +
        '<div class="sets">' + esc(ex.sets) + "</div>" +
        '<p class="exo-desc">' + esc(ex.desc) + "</p>" +
        '<button class="btn primary" data-exo="' + ex.id + '">Ouvrir + minuteur</button></div></div>';
    });
    html += "</div>";
  });
  html += '<h3>RM-C — Pliométrie et gammes (S10, S14, 20\' après 10\' d\'échauffement)</h3>';
  html += '<div class="note">' + RM_C_DRILLS.map(esc).join("<br>") + "<br>Progressif, sur herbe ou sol souple — jamais sur sol dur si vous pesez plus de 85 kg ou si la cheville parle.</div>";
  html += '<h3>Gammes de course (1-2 fois par semaine)</h3>';
  html += '<div class="note">Après 10\' d\'échauffement, 2 à 3 fois 20\'\' de chaque : montées de genoux, talons-fesses, foulées bondissantes, puis 3-4 lignes droites progressives. Elles économisent la cheville et le tendon.</div>';
  html += '<h3>Nutrition de l\'effort</h3>';
  html += '<div class="note">' + NUTRITION_TIPS.map(esc).join("<br>") + "</div>";
  $("#view-exercises").innerHTML = html;

  $$("button[data-exo]").forEach(btn => btn.addEventListener("click", () => openExo(btn.dataset.exo)));
}

/* ---- modal exercice : animation + minuteur ---- */
let exoQueue = [], exoPos = 0;
function openExo(id) {
  const ex = EXERCISES.find(e => e.id === id); if (!ex) return;
  exoQueue = EXERCISES.filter(e => e.routine === ex.routine);
  exoPos = exoQueue.findIndex(e => e.id === id);
  renderExoModal();
  $("#exo-modal").classList.remove("hidden");
}
/* suivi de charge par exercice : dernière valeur notée + saisie rapide */
function loadBlockHTML(exoId) {
  const l = state.loads[exoId];
  return '<div class="load-block">' +
    (l ? '<div class="muted small">Dernière charge : ' + (l.kg || 0) + " kg × " + (l.reps || "?") + " rép. (" + (l.date || "") + ")</div>" : "") +
    '<div class="row-actions" style="margin:6px 0">' +
    '<input type="number" id="load-kg" min="0" step="0.5" placeholder="kg" style="width:74px">' +
    '<input type="number" id="load-reps" min="1" placeholder="rép." style="width:74px">' +
    '<button class="btn" id="load-save">Noter la charge</button></div></div>';
}

function renderExoModal() {
  const ex = exoQueue[exoPos];
  const cfg = ex.timer || { mode: "reps", rest: 60, sets: 3 };
  const exoId = ex.fig || ex.id; // identité de l'exercice (fiche directe : id ; routine : fig)
  $("#exo-title").textContent = ex.name;
  $("#exo-body").innerHTML =
    '<div class="exo-detail">' + figureHTML(exoId) +
    '<div class="exo-detail-txt"><div class="muscles">' + esc(ex.muscles) + "</div>" +
    "<p>" + esc(ex.desc) + "</p>" +
    (ex.steps ? "<ol class='exo-steps'>" + ex.steps.map(s => "<li>" + esc(s) + "</li>").join("") + "</ol>" : "") +
    (ex.mistakes ? "<p class='exo-mistakes'><b>Erreurs à éviter :</b> " + ex.mistakes.map(esc).join(" · ") + "</p>" : "") +
    "<p><b>Prescription : " + esc(ex.sets) + "</b></p>" +
    (ex.tip ? "<p class='tip'>" + esc(ex.tip) + "</p>" : "") +
    (exoId ? loadBlockHTML(exoId) : "") +
    '<button class="btn primary" id="exo-timer">Lancer le minuteur</button></div></div>';
  $("#exo-nav").innerHTML =
    (exoPos > 0 ? '<button class="btn" id="exo-prev">◀ Précédent</button>' : "") +
    '<span class="muted">' + (exoPos + 1) + " / " + exoQueue.length + " · routine RM-" + ex.routine + "</span>" +
    (exoPos < exoQueue.length - 1 ? '<button class="btn" id="exo-next">Suivant ▶</button>' : "");
  $("#exo-timer").addEventListener("click", () => {
    const c = ex.timer || {};
    openTimer(ex.name, {
      mode: c.mode || "reps",
      work: c.work || 45,
      rest: c.rest != null ? c.rest : 60,
      sets: c.sets || 3,
      reps: 1, setrest: c.rest != null ? c.rest : 60
    }, { stdKey: exoId || null });
  });
  const prev = $("#exo-prev"), next = $("#exo-next");
  if (prev) prev.addEventListener("click", () => { exoPos--; renderExoModal(); });
  if (next) next.addEventListener("click", () => { exoPos++; renderExoModal(); });
  const ls = $("#load-save");
  if (ls) ls.addEventListener("click", () => {
    const kg = parseFloat(String($("#load-kg").value).replace(",", ".")) || 0;
    const reps = +$("#load-reps").value || 0;
    if (!kg && !reps) { toast("Indique au moins une charge ou un nombre de répétitions."); return; }
    state.loads[exoId] = { kg: kg, reps: reps, date: isoDate(new Date()) };
    save();
    toast("Charge notée : " + kg + " kg × " + reps + ".");
    renderExoModal();
  });
}
$("#exo-close").addEventListener("click", () => $("#exo-modal").classList.add("hidden"));

/* ================= séance guidée (player) ================= */
const Player = { key: null, pos: 0, series: 1 };
function startRoutine(key) {
  const r = ROUTINES[key]; if (!r) return;
  Player.key = key; Player.pos = 0; Player.series = 1;
  $("#player-title").textContent = r.name + " (" + r.dur + ")";
  $("#player-modal").classList.remove("hidden");
  paintPlayerStep();
}
function playerStep() {
  const r = ROUTINES[Player.key];
  const st = r.steps[Player.pos];
  if (st.ex) {
    const ex = EXERCISES.find(e => e.id === st.ex);
    return { name: ex.name, muscles: ex.muscles, sets: st.alt || ex.sets, desc: ex.desc, steps: ex.steps, tip: ex.tip, fig: ex.id, timer: ex.timer, series: (ex.timer && ex.timer.sets) || 3 };
  }
  return { name: st.name, sets: st.txt, desc: st.desc || "", tip: "", fig: null, timer: st.timer, series: st.series || 1 };
}
function paintPlayerStep(finished) {
  const r = ROUTINES[Player.key];
  if (Player.pos >= r.steps.length) { paintPlayerDone(); return; }
  const s = playerStep();
  $("#player-progress").innerHTML =
    '<div class="player-dots">' + r.steps.map((_, i) =>
      '<i class="' + (i < Player.pos ? "on" : i === Player.pos ? "cur" : "") + '"></i>').join("") + "</div>" +
    '<div class="muted small">Exercice ' + (Player.pos + 1) + " / " + r.steps.length + "</div>";
  let body = '<div class="exo-detail">' +
    (s.fig ? figureHTML(s.fig) : '<div class="player-nofig">🏃</div>') +
    '<div class="exo-detail-txt"><h4>' + esc(s.name) + "</h4>" +
    (s.muscles ? '<div class="muscles">' + esc(s.muscles) + "</div>" : "") +
    "<p><b>" + esc(s.sets) + "</b></p>" +
    (s.desc ? "<p>" + esc(s.desc) + "</p>" : "") +
    (s.steps ? "<ol class='exo-steps'>" + s.steps.map(x => "<li>" + esc(x) + "</li>").join("") + "</ol>" : "") +
    (s.tip ? '<p class="tip">' + esc(s.tip) + "</p>" : "") +
    (finished ? '<p class="ok-msg">Exercice terminé — passe au suivant.</p>' : "") +
    "</div></div>";
  $("#player-body").innerHTML = body;
  const acts = $("#player-actions");
  if (finished) {
    acts.innerHTML = '<button class="btn primary" id="pl-next">Exercice suivant ▶</button>';
    $("#pl-next").addEventListener("click", () => { Player.pos++; Player.series = 1; paintPlayerStep(); });
    return;
  }
  const seriesTotal = s.series;
  acts.innerHTML =
    (Player.pos > 0 ? '<button class="btn" id="pl-prev">◀</button>' : "") +
    '<button class="btn primary" id="pl-series">Série ' + Player.series + "/" + seriesTotal + " faite ✔</button>" +
    (s.timer ? '<button class="btn" id="pl-timer">Minuteur</button>' : "") +
    '<button class="btn" id="pl-skip">Passer</button>';
  $("#pl-series").addEventListener("click", () => {
    if (Player.series >= seriesTotal) {
      Player.pos++; Player.series = 1;
      if (Player.pos < ROUTINES[Player.key].steps.length) { beep(880, 0.2); paintPlayerStep(true); }
      else paintPlayerDone();
    } else { Player.series++; beep(660, 0.12); paintPlayerStep(); }
  });
  if (s.timer) $("#pl-timer").addEventListener("click", () => {
    const t = s.timer;
    openTimer(s.name, { mode: t.mode || "interval", work: t.work, rest: t.rest, reps: t.reps || 1, sets: t.sets || 1, setrest: t.setrest || t.rest || 60 }, { noLog: true });
  });
  $("#pl-skip").addEventListener("click", () => { Player.pos++; Player.series = 1; paintPlayerStep(); });
  const prev = $("#pl-prev");
  if (prev) prev.addEventListener("click", () => { Player.pos = Math.max(0, Player.pos - 1); Player.series = 1; paintPlayerStep(); });
}
function paintPlayerDone() {
  const r = ROUTINES[Player.key];
  const doneAlready = firstItemOfCode(r.code) == null;
  $("#player-progress").innerHTML = "";
  $("#player-body").innerHTML = '<div class="player-done"><div class="big-check">✔</div><h4>Séance ' + esc(r.name) + " terminée !</h4>" +
    '<p class="muted">Prends 5\' pour l\'automassage (fessier, TFL, essuie-glace) et des étirements doux.</p></div>';
  $("#player-actions").innerHTML =
    (doneAlready ? '<button class="btn primary" id="pl-extra">Compter ce temps (' + parseDurMin(r.dur) + " min) dans le volume réalisé — hors programme</button>"
                 : '<button class="btn primary" id="pl-mark">Cocher la séance ' + esc(TYPES[r.code].label) + " comme faite</button>") +
    '<button class="btn" id="pl-close2">Fermer</button>';
  const mk = $("#pl-mark");
  if (mk) mk.addEventListener("click", () => { markRoutineDone(r.code); mk.disabled = true; mk.textContent = "Séance cochée ✔"; });
  const ex = $("#pl-extra");
  if (ex) ex.addEventListener("click", () => {
    addExtra("Séance : " + r.name, parseDurMin(r.dur), r.code);
    ex.disabled = true; ex.textContent = "Comptée dans le volume réalisé ✔";
    toast(parseDurMin(r.dur) + " min ajoutés au volume réalisé (hors programme).");
  });
  $("#pl-close2").addEventListener("click", () => $("#player-modal").classList.add("hidden"));
}
/* "30-35'" → 32 min : moyenne des nombres extraits d'une durée indicative */
function parseDurMin(s) {
  const nums = String(s || "").match(/\d+/g);
  if (!nums || !nums.length) return 0;
  const v = nums.map(Number);
  return Math.round(v.reduce((a, x) => a + x, 0) / v.length);
}
function firstItemOfCode(code) {
  const w = currentWeek(), week = effWeek(w);
  for (let d = 0; d < 7; d++)
    for (const x of week.days[d]) {
      if (x.it.c !== code || itemDone(x)) continue;
      if (x.isCustom) return { key: customKey(x.custom.id), pos: { w: x.custom.w, d: x.custom.d } };
      return { key: itemKey(x.w, x.d, x.i), pos: effPosOf(x.w, x.d, x.i) };
    }
  return null;
}
function markRoutineDone(code) {
  const f = firstItemOfCode(code);
  if (!f) { toast("La séance " + TYPES[code].label + " est déjà cochée cette semaine."); return; }
  state.done[f.key] = true;
  save();
  const pos = f.pos;
  const where = pos.w === currentWeek() ? DAY_NAMES[pos.d] : "S" + pos.w + " " + DAY_NAMES[pos.d];
  toast("Séance " + TYPES[code].label + " cochée (créneau du " + where + ").");
  updateHeader();
  renderToday();
}
$("#player-close").addEventListener("click", () => {
  if (confirm("Quitter la séance guidée ? La progression non terminée ne sera pas cochée.")) {
    $("#player-modal").classList.add("hidden");
    renderToday();
  }
});

/* ================= minuteur ================= */
const Timer = {
  cfg: null, mode: "interval", // interval | hold | reps
  run: false, phase: "idle", remain: 0, endAt: 0,
  set: 1, rep: 1, iv: null, label: "", repsModeSet: 1,
  noLog: false, activeMs: 0
};
/* opts.noLog : minuteur lancé depuis la séance guidée ou une séance de course
   (le temps sera compté par la routine ou par la sortie enregistrée) ;
   sinon, le temps écoulé d'un minuteur libre compte dans le volume réalisé. */
function openTimer(label, cfg, opts) {
  opts = opts || {};
  Timer.stdKey = opts.stdKey || null; // clé d'exercice pour le minuteur standard enregistré
  if (Timer.stdKey && state.timers[Timer.stdKey]) cfg = Object.assign({}, cfg, state.timers[Timer.stdKey]);
  Timer.cfg = Object.assign({ work: 30, rest: 30, reps: 10, sets: 3, setrest: 120, mode: "interval" }, cfg);
  Timer.mode = Timer.cfg.mode || "interval";
  Timer.run = false; Timer.phase = "idle"; Timer.set = 1; Timer.rep = 1; Timer.repsModeSet = 1;
  Timer.label = label;
  Timer.noLog = !!(opts && opts.noLog);
  Timer.activeMs = 0;
  $("#timer-title").textContent = label;
  const show = id => ["work", "rest", "reps", "sets", "setrest"].map(s => $("#cfg-" + s).parentElement).forEach(l => l.style.display = id ? "" : "none");
  if (Timer.mode === "interval") show(true);
  else if (Timer.mode === "hold") { show(true); }
  else show(false); // reps : pas de config, bouton "série faite"
  $("#timer-done").style.display = Timer.mode === "reps" ? "" : "none";
  $("#timer-save").style.display = Timer.stdKey ? "" : "none";
  $("#cfg-work").value = Timer.cfg.work;
  $("#cfg-rest").value = Timer.cfg.rest;
  $("#cfg-reps").value = Timer.cfg.reps;
  $("#cfg-sets").value = Timer.cfg.sets;
  $("#cfg-setrest").value = Timer.cfg.setrest;
  $("#timer-modal").classList.remove("hidden");
  Timer.remain = Timer.mode === "reps" ? 0 : Timer.cfg.work;
  paintTimer(Timer.mode === "reps" ? "Appuie sur ▶ : le chrono de ta série démarre" : "Prêt",
    Timer.remain, "Série 1 — répétition 1");
}
function readCfg() {
  Timer.cfg.work = Math.max(1, +$("#cfg-work").value || 30);
  Timer.cfg.rest = Math.max(0, +$("#cfg-rest").value || 0);
  Timer.cfg.reps = Math.max(1, +$("#cfg-reps").value || 1);
  Timer.cfg.sets = Math.max(1, +$("#cfg-sets").value || 1);
  Timer.cfg.setrest = Math.max(0, +$("#cfg-setrest").value || 0);
}
function startPhase(phase, secs) {
  Timer.phase = phase;
  Timer.remain = secs;
  Timer.endAt = Date.now() + secs * 1000;
  Timer.run = true;
  if (!Timer.iv) Timer.iv = setInterval(tickTimer, 200);
  phaseBeep(phase);
  lockScreenOn();
  paintTimerPhase();
}
function tickTimer() {
  if (!Timer.run) return;
  Timer.activeMs += 200; // temps actif (hors pause) — compté dans le volume réalisé
  if (Timer.phase === "chrono") { Timer.remain += 0.2; paintTimerPhase(); return; } // chrono de série (mode reps)
  Timer.remain = Math.max(0, (Timer.endAt - Date.now()) / 1000);
  if (Timer.remain <= 0) nextPhase();
  else paintTimerPhase();
}
function nextPhase() {
  const c = Timer.cfg;
  if (Timer.mode === "reps") {
    // fin de récupération en mode "série faite" : prêt pour la série suivante
    stopTimer();
    Timer.phase = "ready";
    Timer.remain = 0;
    phaseBeep("ready");
    paintTimerPhase();
    return;
  }
  if (Timer.phase === "work") {
    if (Timer.rep < c.reps) { Timer.rep++; startPhase("work", c.work); }
    else if (Timer.set < c.sets) { Timer.set++; Timer.rep = 1; startPhase("rest", c.setrest || c.rest); }
    else finishTimer();
  } else if (Timer.phase === "rest") {
    startPhase("work", c.work);
  } else if (Timer.phase === "prep") {
    startPhase("work", c.work);
  }
}
function finishTimer() {
  stopTimer();
  unlockScreen();
  Timer.phase = "over";
  beep(1320, 0.4); setTimeout(() => beep(1320, 0.4), 450); setTimeout(() => beep(1760, 0.6), 900);
  $("#timer-phase").textContent = "Terminé — bien joué !";
  if (!Timer.noLog) {
    const min = Math.round(Timer.activeMs / 60000);
    if (min >= 1) {
      addExtra("Minuteur : " + Timer.label, min, "EXO");
      toast(min + " min comptés dans le volume réalisé (hors programme).");
    }
  }
}
function paintTimer(phase, remain, round) {
  if (phase) $("#timer-phase").textContent = phase;
  if (round) $("#timer-round").textContent = round;
  $("#timer-clock").textContent = fmtDur(remain);
  $("#timer-clock").className = "timer-clock " + (Timer.phase === "work" ? "t-work" : Timer.phase === "rest" ? "t-rest" : "");
}
function paintTimerPhase() {
  const names = { work: "Effort", rest: "Récupération", prep: "Préparation", idle: "Prêt", chrono: "Série en cours — chrono", ready: "Série suivante : ▶ pour la démarrer, ou « Série faite »", over: "Terminé" };
  let round = "Série " + Timer.set + "/" + Timer.cfg.sets;
  if (Timer.mode === "interval") round += " — répétition " + Timer.rep + "/" + Timer.cfg.reps;
  else if (Timer.mode === "reps") round = "Série " + Timer.repsModeSet + "/" + Timer.cfg.sets;
  paintTimer(names[Timer.phase] || Timer.phase, Timer.remain, round);
}
function stopTimer() {
  Timer.run = false;
  if (Timer.iv) { clearInterval(Timer.iv); Timer.iv = null; }
}
/* ▶ démarrer / reprendre — ❚❚ pause — ↺ recommencer */
$("#timer-start").addEventListener("click", () => {
  if (Timer.run) return; // déjà en cours : la pause est sur ❚❚
  readCfg();
  if (Timer.mode === "reps") {
    // mode "série faite" : ▶ lance le chrono (compteur) de la série en cours
    if (Timer.phase === "idle" || Timer.phase === "over") { Timer.repsModeSet = 1; }
    if (Timer.phase !== "chrono") { Timer.phase = "chrono"; Timer.remain = 0; }
    Timer.run = true;
    if (!Timer.iv) Timer.iv = setInterval(tickTimer, 200);
    phaseBeep("chrono");
    lockScreenOn();
    paintTimerPhase();
    return;
  }
  if (Timer.phase === "work" || Timer.phase === "rest" || Timer.phase === "prep") {
    // reprise après pause : le décompte repart du temps restant
    Timer.run = true;
    Timer.endAt = Date.now() + Timer.remain * 1000;
    if (!Timer.iv) Timer.iv = setInterval(tickTimer, 200);
    phaseBeep(Timer.phase);
    paintTimerPhase();
  } else {
    Timer.set = 1; Timer.rep = 1;
    startPhase("prep", 10);
  }
});
$("#timer-pause").addEventListener("click", () => {
  if (!Timer.run) { toast("Le minuteur n'est pas en cours — appuie sur ▶."); return; }
  Timer.run = false;
  paintTimer(Timer.phase === "chrono" ? "Chrono en pause — ▶ pour reprendre" : "En pause — ▶ pour reprendre", Timer.remain, null);
});
$("#timer-reset").addEventListener("click", () => {
  stopTimer();
  Timer.phase = Timer.mode === "reps" ? "ready" : "idle";
  Timer.set = 1; Timer.rep = 1; Timer.repsModeSet = 1;
  Timer.remain = Timer.mode === "reps" ? 0 : Timer.cfg.work;
  paintTimer(Timer.mode === "reps" ? "Recommencé — ▶ pour chronométrer la série" : "Recommencé — prêt",
    Timer.remain, "Série 1 — répétition 1");
});
$("#timer-done").addEventListener("click", () => {
  // "ma série est faite" : arrête le chrono (ou saute la préparation) et lance la récupération
  if (Timer.phase === "chrono") {
    if (Timer.repsModeSet >= Timer.cfg.sets) { finishTimer(); return; }
    Timer.repsModeSet++;
    startPhase("rest", Timer.cfg.rest || 60);
    return;
  }
  if (Timer.phase === "ready") {
    if (Timer.repsModeSet >= Timer.cfg.sets) { finishTimer(); return; }
    Timer.repsModeSet++;
    startPhase("rest", Timer.cfg.rest || 60);
    return;
  }
  if (Timer.run && Timer.phase === "rest") { return; } // récup déjà en cours
  if (Timer.repsModeSet >= Timer.cfg.sets) { finishTimer(); return; }
  Timer.repsModeSet++;
  startPhase("rest", Timer.cfg.rest || 60);
});
$("#timer-close").addEventListener("click", () => { stopTimer(); unlockScreen(); $("#timer-modal").classList.add("hidden"); });
/* enregistre la configuration actuelle comme minuteur standard de cet exercice */
$("#timer-save").addEventListener("click", () => {
  if (!Timer.stdKey) return;
  readCfg();
  state.timers[Timer.stdKey] = {
    work: Timer.cfg.work, rest: Timer.cfg.rest, reps: Timer.cfg.reps,
    sets: Timer.cfg.sets, setrest: Timer.cfg.setrest
  };
  save();
  toast("Minuteur standard enregistré — il s'ouvrira avec ces réglages à chaque fois.");
});
/* bip WebAudio */
let actx = null;
function beep(freq, dur, delay) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const t0 = actx.currentTime + (delay || 0);
    const o = actx.createOscillator(), g = actx.createGain();
    o.frequency.value = freq; o.type = "sine";
    g.gain.setValueAtTime(0.3, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g).connect(actx.destination);
    o.start(t0); o.stop(t0 + dur);
  } catch (e) { /* audio indisponible */ }
}
/* son distinct par phase : on reconnaît le début de chaque phase sans regarder l'écran */
function phaseBeep(phase) {
  if (phase === "prep") {            // préparation : 3 blips brefs
    beep(660, 0.1); beep(660, 0.1, 0.18); beep(660, 0.1, 0.36); vib([60, 60, 60]);
  } else if (phase === "work") {     // effort : double bip montant, marqué
    beep(880, 0.16); beep(1175, 0.22, 0.2); vib(220);
  } else if (phase === "rest") {     // récupération : double bip descendant, bas
    beep(587, 0.14); beep(392, 0.22, 0.2); vib([120, 80, 120]);
  } else if (phase === "chrono") {   // début de série chronométrée : blip clair
    beep(988, 0.12); vib(90);
  } else if (phase === "ready") {    // fin de récup, prêt pour la série suivante
    beep(988, 0.1); beep(988, 0.1, 0.16); vib([90, 60, 90]);
  } else {
    beep(880, 0.15);
  }
}
// décompte : bips dans les 3 dernières secondes de travail
setInterval(() => {
  if (Timer.run && Timer.remain > 0 && Timer.remain <= 3 && (Timer.phase === "work" || Timer.phase === "rest")) beep(600, 0.08);
}, 1000);

/* ================= vue : sorties ================= */
function renderRuns() {
  const w = currentWeek(), idx = todayIdx(), week = effWeek(w);
  const runsToday = week.days[idx].filter(x => RUN_CODES.includes(x.it.c)).map(x => x.it);
  let html = "<h2>Sorties & GPS</h2>";

  html += '<div class="run-suggest"><h3>La séance proposée aujourd\'hui</h3>';
  if (runsToday.length) {
    runsToday.forEach(it => {
      const ty = TYPES[it.c];
      html += '<div class="suggest-card"><div class="suggest-head">' + typeChip(it.c) + "<b>" + esc(it.t) + "</b></div>" +
        '<p class="muted">' + esc(ty.desc || "") + "</p>";
      if (it.dplus) html += '<p class="dplus">Objectif dénivelé : ' + it.dplus + " m D+</p>";
      if (ty.timer) html += '<button class="btn" data-open-timer="' + esc(it.c) + '">Minuteur fractionné (' + esc(ty.label) + ")</button>";
      html += "</div>";
    });
  } else {
    html += '<div class="muted">Pas de séance de course programmée aujourd\'hui (récupération, vélo ou renforcement). Tu peux quand même enregistrer une sortie si tu sors.</div>';
  }
  html += "</div>";

  /* enregistreur GPS */
  html += '<div class="recorder" id="recorder">' +
    '<h3>Enregistrement GPS en direct</h3>' +
    '<div class="rec-stats">' +
    '<div class="rec-stat"><span id="rec-time">00:00:00</span><label>Durée</label></div>' +
    '<div class="rec-stat"><span id="rec-dist">0,00 km</span><label>Distance</label></div>' +
    '<div class="rec-stat"><span id="rec-speed">0,0 km/h</span><label>Vitesse</label></div>' +
    '<div class="rec-stat"><span id="rec-avg">0,0 km/h</span><label>Moy. globale</label></div>' +
    '<div class="rec-stat"><span id="rec-avgm">0,0 km/h</span><label>Moy. en mouvement</label></div>' +
    '<div class="rec-stat"><span id="rec-dplus">0 m</span><label>D+ cumulé</label></div>' +
    '<div class="rec-stat"><span id="rec-ele">—</span><label>Altitude</label></div>' +
    '<div class="rec-stat"><span id="rec-acc">—</span><label>Précision GPS</label></div>' +
    "</div>" +
    '<div class="row-actions"><button class="btn primary" id="rec-start">Démarrer l\'enregistrement</button>' +
    '<button class="btn" id="rec-pause" disabled>Pause</button>' +
    '<button class="btn danger" id="rec-stop" disabled>Terminer et noter la sortie</button>' +
    '<button class="btn" id="rec-cancel" disabled>Annuler</button></div>' +
    '<div class="muted small" id="rec-note">Nécessite l\'autorisation de géolocalisation. La trace est filtrée (anti-dérive, anti-sauts) et l\'enregistrement continue si tu changes d\'onglet ou de page ; en cas de fermeture, il est proposé de le reprendre au retour.</div>' +
    "</div>";

  /* formulaire feedback */
  html += '<div class="run-form"><h3>Ma sortie réelle — feedback</h3>' +
    '<div class="form-grid">' +
    '<label>Date <input type="date" id="rf-date" value="' + isoDate(new Date()) + '"></label>' +
    '<label>Type de séance <select id="rf-code">' +
      RUN_CODES.map(c => '<option value="' + c + '">' + esc(TYPES[c].label) + "</option>").join("") +
      '<option value="AUTRE">Autre</option></select></label>' +
    '<div class="full muted small" id="rf-slcheck" style="display:none"></div>' +
    '<label>Distance (km) <input type="number" id="rf-dist" step="0.01" min="0"></label>' +
    '<label>Durée (min) <input type="number" id="rf-dur" step="1" min="0"></label>' +
    '<label>D+ (m) <input type="number" id="rf-dplus" step="1" min="0"></label>' +
    '<label>Chaussures <select id="rf-shoe"><option value="">— sélectionner —</option>' +
      state.shoes.filter(s => !s.retired).map(s => '<option value="' + s.id + '"' +
        (state.lastShoeId === s.id ? " selected" : "") + '>' + esc(s.name) + "</option>").join("") + "</select></label>" +
    '<label>Type de route <select id="rf-route"><option value="">—</option>' +
      ROUTES.map(r => '<option value="' + r.id + '">' + esc(r.label) + "</option>").join("") + "</select></label>" +
    '<label>Sensations (/10) <input type="number" id="rf-feel" min="1" max="10" placeholder="1-10"></label>' +
    '<label>Douleur essuie-glace (/10) <input type="number" id="rf-knee" min="0" max="10" placeholder="0-10"></label>' +
    '<label>Douleur cheville (/10) <input type="number" id="rf-ankle" min="0" max="10" placeholder="0-10"></label>' +
    "</div>" +
    '<label class="full">Notes (matériel, ravitaillement, météo…) <textarea id="rf-notes" rows="2"></textarea></label>' +
    '<div class="row-actions"><button class="btn primary" id="rf-save">Enregistrer la sortie</button>' +
    '<label class="btn file-btn">Importer un GPX <input type="file" id="rf-gpx" accept=".gpx" multiple></label>' +
    '<input type="hidden" id="rf-points"></div>' +
    '<div class="muted small">Priorité si la semaine est impossible : 1) sortie longue, 2) séance qualité du mercredi, 3) RM-B, 4) le reste. On ne rattrape jamais une séance manquée.</div>' +
    "</div>";

  /* historique */
  html += "<h3>Historique des sorties</h3>";
  const sorted = state.runs.slice().sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  if (!sorted.length) html += '<div class="muted">Aucune sortie enregistrée pour l\'instant.</div>';
  sorted.forEach(r => { html += runCardHTML(r); });

  $("#view-runs").innerHTML = html;
  bindRunsEvents(sorted);
}

function runCardHTML(r) {
  const ty = TYPES[r.code] || { label: r.code };
  const shoe = state.shoes.find(s => s.id === r.shoeId);
  const pace = r.dist > 0 && r.dur > 0 ? r.dur / r.dist : null;
  let html = '<div class="run-card" data-id="' + r.id + '">' +
    '<div class="run-head"><b>' + esc(fmtDateShort(parseDate(r.date))) + "</b> " + typeChip(r.code) +
    (r.planned ? '<span class="muted">(' + esc(r.planned) + ")</span>" : "") +
    '<span class="spacer"></span><button class="mini-btn" data-edit="' + r.id + '">Modifier</button>' +
    '<button class="icon-btn del" data-del="' + r.id + '" title="Supprimer">✕</button></div>' +
    '<div class="run-stats">' +
    stat(r.dist ? r.dist.toFixed(1).replace(".", ",") + " km" : "—", "distance") +
    stat(r.dur ? fmtDur(r.dur * 60) : "—", "durée") +
    stat(r.dplus + " m", "D+") +
    stat(r.dist && r.dur ? (r.dist / (r.dur / 60)).toFixed(1).replace(".", ",") + " km/h" : "—", "vitesse moy.") +
    stat(pace ? Math.floor(pace) + "'" + String(Math.round((pace % 1) * 60)).padStart(2, "0") + '"/km' : "—", "allure") +
    stat(r.route ? esc(routeLabel(r.route)) : "—", "type de route") +
    stat(r.feel ? r.feel + "/10" : "—", "sensations") +
    stat(r.knee != null ? r.knee + "/10" : "—", "essuie-glace") +
    stat(r.ankle != null ? r.ankle + "/10" : "—", "cheville") +
    "</div>" +
    (shoe ? '<div class="muted small">Chaussures : ' + esc(shoe.name) + " · cumul " + shoeKm(shoe).toFixed(1).replace(".", ",") + " km</div>" : "") +
    (r.notes ? '<div class="run-notes">' + esc(r.notes) + "</div>" : "") +
    (r.points && r.points.length > 1 ? Geo.profileSVG(r.points) : "") +
    '<div class="row-actions">' +
    (r.points && r.points.length > 1 ? '<button class="btn" data-export="' + r.id + '">Exporter le GPX</button>' +
      '<button class="btn" data-plots="' + r.id + '">Courbes (altitude · vitesse · FC)</button>' : "") +
    "</div></div>";
  return html;
}
function stat(v, label) { return '<div class="run-stat"><span>' + v + "</span><label>" + label + "</label></div>"; }

function bindRunsEvents(sorted) {
  $("#rec-start").addEventListener("click", startRecording);
  const codeSel = $("#rf-code"), slc = $("#rf-slcheck");
  const updSl = () => {
    if (codeSel && slc && codeSel.value === "SL") {
      slc.style.display = "";
      slc.innerHTML = "<b>Check-list sortie longue (répétition du jour J) :</b> gels et boisson déjà testés à l'entraînement · sac chargé comme en course (eau, ravitaillement, téléphone) · chaussures prévues · avec bâtons dès S25 si tu les utiliseras le jour J · garde chaque emballage et compte glucides/h, sodium et litres (audit du ravito) · rien de nouveau aujourd'hui.";
    } else if (slc) slc.style.display = "none";
  };
  if (codeSel) { codeSel.addEventListener("change", updSl); updSl(); }
  $("#rec-stop").addEventListener("click", stopRecording);
  $("#rec-cancel").addEventListener("click", cancelRecording);
  $("#rec-pause").addEventListener("click", () => {
    if (!Recorder.active) return;
    Recorder.paused ? Recorder.unpause() : Recorder.pause();
    recButtonsState(); paintRecBanner();
    toast(Recorder.paused ? "Enregistrement en pause." : "Enregistrement repris.");
  });
  recButtonsState();
  if (Recorder.active) paintRecorderUI(Recorder.live());
  $("#rf-save").addEventListener("click", saveRunFromForm);
  $$("button[data-open-timer]").forEach(b => b.addEventListener("click", () => {
    const ty = TYPES[b.dataset.openTimer];
    if (ty.timer) openTimer("Séance " + ty.label, ty.timer, { noLog: true });
  }));
  $$("button[data-del]").forEach(b => b.addEventListener("click", () => {
    const id = +b.dataset.del;
    const idx = state.runs.findIndex(r => r.id === id);
    if (idx < 0) return;
    const removed = state.runs[idx];
    state.runs.splice(idx, 1);
    if (removed.trackRef && ServerSync.on) fetch("api/track?id=" + removed.trackRef, { method: "DELETE" }).catch(() => {});
    save(); renderRuns(); updateHeader();
    toast("Sortie supprimée.", { label: "Annuler", fn: () => { state.runs.splice(idx, 0, removed); save(); renderRuns(); updateHeader(); } });
  }));
  $$("button[data-edit]").forEach(b => b.addEventListener("click", () => openEditRun(+b.dataset.edit)));
  $$("button[data-export]").forEach(b => b.addEventListener("click", () => {
    const r = state.runs.find(x => x.id === +b.dataset.export);
    if (r) Geo.download("sortie-" + r.date + ".gpx", Geo.toGpx("Sortie " + r.date, r.points));
  }));
  $$("button[data-plots]").forEach(b => b.addEventListener("click", () => {
    const card = b.closest(".run-card");
    let box = card.querySelector(".run-plots");
    if (box) { box.remove(); b.textContent = "Courbes (altitude · vitesse · FC)"; return; }
    const r = state.runs.find(x => x.id === +b.dataset.plots);
    if (!r) return;
    box = document.createElement("div");
    box.className = "run-plots";
    box.innerHTML = Geo.plotsSVG(r.points);
    card.querySelector(".row-actions").after(box);
    b.textContent = "Masquer les courbes";
  }));
  const gpxInput = $("#rf-gpx");
  gpxInput.addEventListener("change", async () => {
    const files = Array.from(gpxInput.files || []);
    gpxInput.value = "";
    for (const f of files) {
      try {
        const pts = Geo.parseGpx(await f.text());
        const s = Geo.stats(pts);
        const run = {
          id: state.seq++, date: isoDate(new Date()), code: "AUTRE",
          dist: Math.round(s.dist * 100) / 100, dur: Math.round(s.dur / 60),
          dplus: s.dplus, feel: null, knee: null, ankle: null, notes: "Import GPX : " + f.name,
          shoeId: null, points: Geo.compact(pts, 800), planned: null,
          planKey: (function (pe) { return pe ? itemKey(pe.w, pe.d, pe.i) : null; })(plannedRunEntry(isoDate(new Date())))
        };
        state.runs.push(run); save();
        toast("GPX importé : " + s.dist.toFixed(1) + " km, " + s.dplus + " m D+");
      } catch (err) { toast("Erreur GPX : " + err.message); }
    }
    renderRuns();
  });
}

function prefillRunFormFromItem(w, d) {
  const day = effWeek(w).days[d];
  const runItems = day.map(x => x.it).filter(it => RUN_CODES.includes(it.c) && it.c !== "GAM" && it.c !== "LD");
  if (!runItems.length) return;
  const it = runItems[0];
  $("#rf-date").value = isoDate(weekDates(w)[d]);
  $("#rf-code").value = it.c;
  if (it.dplus) $("#rf-dplus").value = it.dplus;
  if (it.m) $("#rf-dur").value = it.m;
  $("#rf-notes").focus();
  toast("Formulaire pré-rempli avec la séance prévue : " + it.t);
}

/* ---- enregistrement GPS : UI indépendante de la vue (banner + carte) ---- */
let recTimerIv = null;
function paintRecorderUI(live) {
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  set("#rec-time", fmtDur(live.dur));
  set("#rec-dist", (live.dist || 0).toFixed(2).replace(".", ",") + " km");
  set("#rec-speed", (live.speed || 0).toFixed(1).replace(".", ",") + " km/h");
  set("#rec-avg", (live.avg || 0).toFixed(1).replace(".", ",") + " km/h");
  set("#rec-avgm", (live.movingAvg || 0).toFixed(1).replace(".", ",") + " km/h");
  set("#rec-dplus", live.dplus + " m");
  set("#rec-ele", live.ele != null ? Math.round(live.ele) + " m" : "—");
  set("#rec-acc", live.acc ? "± " + Math.round(live.acc) + " m" : "—");
  paintRecBanner();
}
function recButtonsState() {
  const b = $("#rec-start"), s = $("#rec-stop"), c = $("#rec-cancel"), p = $("#rec-pause");
  if (!b) return;
  b.disabled = Recorder.active;
  s.disabled = !Recorder.active;
  c.disabled = !Recorder.active;
  p.disabled = !Recorder.active;
  p.textContent = Recorder.paused ? "Reprendre" : "Pause";
  const note = $("#rec-note");
  if (note && Recorder.active) note.textContent = "Enregistrement en cours… Tu peux changer d'onglet ou de page : la trace continue et est sauvegardée.";
}
function startRecTick() {
  clearInterval(recTimerIv);
  recTimerIv = setInterval(() => {
    if (Recorder.active) paintRecorderUI(Recorder.live());
    else { clearInterval(recTimerIv); recTimerIv = null; }
  }, 1000);
}
/* bannière flottante : visible sur toutes les vues pendant l'enregistrement,
   ou pour proposer la reprise d'un enregistrement interrompu */
function paintRecBanner() {
  const b = $("#rec-banner");
  if (!b) return;
  if (Recorder.active) {
    const live = Recorder.live();
    b.classList.remove("hidden", "interrupted");
    b.classList.toggle("paused", Recorder.paused);
    $("#recb-stats").textContent = fmtDur(live.dur) + " · " + (live.dist || 0).toFixed(2).replace(".", ",") + " km" + (live.dplus ? " · " + live.dplus + " m D+" : "");
    $("#recb-title").textContent = Recorder.paused ? "Enregistrement en pause" : "Enregistrement GPS en cours";
    $("#recb-actions").innerHTML =
      '<button class="btn tiny" id="recb-pause">' + (Recorder.paused ? "Reprendre" : "Pause") + "</button>" +
      '<button class="btn primary tiny" id="recb-stop">Terminer</button>' +
      '<button class="btn tiny" id="recb-cancel">Annuler</button>';
  } else {
    const cp = Recorder.hasCheckpoint() ? Recorder.loadCheckpoint() : null;
    if (!cp) { b.classList.add("hidden"); return; }
    const dur = cp.t0 ? Math.max(0, ((cp.pts[cp.pts.length - 1].t || cp.savedAt) - cp.t0 - (cp.pausedMs || 0)) / 1000) : 0;
    b.classList.remove("hidden");
    b.classList.add("interrupted");
    $("#recb-title").textContent = "Enregistrement interrompu";
    $("#recb-stats").textContent = ((cp.dist || 0) / 1000).toFixed(2).replace(".", ",") + " km · " + fmtDur(dur) + " · " + cp.pts.length + " points";
    $("#recb-actions").innerHTML =
      '<button class="btn primary tiny" id="recb-resume">Reprendre</button>' +
      '<button class="btn tiny" id="recb-finish">Terminer</button>' +
      '<button class="btn tiny" id="recb-discard">Supprimer</button>';
  }
}
document.addEventListener("click", e => {
  if (e.target.closest("#recb-pause")) { Recorder.paused ? Recorder.unpause() : Recorder.pause(); recButtonsState(); paintRecBanner(); return; }
  if (e.target.closest("#recb-stop")) { stopRecording(); return; }
  if (e.target.closest("#recb-cancel")) { cancelRecording(); return; }
  if (e.target.closest("#recb-resume")) { resumeRecording(); return; }
  if (e.target.closest("#recb-finish")) { finishCapture(Recorder.loadCheckpoint().pts, Recorder.loadCheckpoint().dist, null); Recorder.abort(); paintRecBanner(); return; }
  if (e.target.closest("#recb-discard")) { if (confirm("Supprimer la trace enregistrée en cours ?")) { Recorder.abort(); paintRecBanner(); toast("Trace supprimée."); } return; }
});
function resumeRecording() {
  Recorder.resume(live => paintRecorderUI(live)).then(() => {
    recButtonsState(); startRecTick(); paintRecBanner();
    if ($("#view-runs").classList.contains("active")) paintRecorderUI(Recorder.live());
    toast("Enregistrement repris — la trace continue.");
  }).catch(err => {
    toast("GPS indisponible (" + err.message + ").");
  });
}
function startRecording() {
  Recorder.start(live => paintRecorderUI(live)).then(() => {
    recButtonsState();
    startRecTick();
    lockScreenOn();
    paintRecBanner();
    toast("Enregistrement GPS démarré — il continue même si tu changes de page ou d'onglet.");
  }).catch(err => {
    if (err && err.code === 1) toast("Localisation refusée. iOS : Réglages > Apps > Safari > Localisation > Autoriser (le site doit être en HTTPS).");
    else toast("GPS indisponible (" + err.message + "). Importe un GPX si nécessaire.");
  });
}
/* transmet la trace capturée au formulaire de sortie (quelle que soit la vue courante) */
function finishCapture(pts, dist, dur) {
  if (!pts || pts.length < 2) { toast("Pas assez de points enregistrés."); return; }
  pendingPoints = Geo.compact(pts, 800);
  const el = Geo.elevation(pendingPoints);
  const km = dist != null ? dist / 1000 : Geo.stats(pendingPoints).dist;
  const minutes = dur != null ? Math.round(dur / 60) : Math.round(Geo.stats(pendingPoints).dur / 60);
  showView("runs");
  $("#rf-date").value = isoDate(new Date());
  $("#rf-dist").value = Math.round(km * 100) / 100;
  $("#rf-dur").value = minutes;
  $("#rf-dplus").value = Math.round(el.up);
  $("#rf-points").value = "captured";
  const shoe = $("#rf-shoe");
  if (shoe) shoe.focus();
  toast("Trace enregistrée (" + km.toFixed(1).replace(".", ",") + " km, " + Math.round(el.up) + " m D+, filtre GPS appliqué). Choisis les chaussures puis valide la sortie.");
}
function stopRecording() {
  if (!Recorder.active) return;
  unlockScreen();
  const r = Recorder.stop();
  clearInterval(recTimerIv); recTimerIv = null;
  recButtonsState();
  const note = $("#rec-note");
  if (note) note.textContent = "Enregistrement arrêté.";
  paintRecBanner();
  finishCapture(r.pts, r.dist, r.dur);
}
function cancelRecording() {
  if (!Recorder.active && !Recorder.hasCheckpoint()) return;
  if (!confirm("Annuler l'enregistrement ? La trace GPS sera perdue.")) return;
  unlockScreen();
  Recorder.abort();
  clearInterval(recTimerIv); recTimerIv = null;
  pendingPoints = null;
  recButtonsState();
  ["rec-time", "rec-dist", "rec-speed", "rec-dplus"].forEach(id => { const el = $("#" + id); if (el) el.textContent = id === "rec-dist" ? "0,00 km" : id === "rec-dplus" ? "0 m" : id === "rec-speed" ? "0,0 km/h" : "00:00:00"; });
  const e1 = $("#rec-ele"), e2 = $("#rec-acc");
  if (e1) e1.textContent = "—";
  if (e2) e2.textContent = "—";
  const note = $("#rec-note");
  if (note) note.textContent = "Enregistrement annulé.";
  paintRecBanner();
  toast("Enregistrement annulé.");
}
/* au démarrage : propose la reprise d'un enregistrement interrompu (onglet fermé, page rechargée) */
function offerResume() { paintRecBanner(); }

/* ---- modification d'une sortie (km, temps, D+, feedback — pas les points GPS) ---- */
let editingRunId = null;
function openEditRun(id) {
  const r = state.runs.find(x => x.id === id); if (!r) return;
  editingRunId = id;
  $("#edit-title").textContent = "Modifier la sortie du " + fmtDateShort(parseDate(r.date));
  if (r.points && r.points.length > 1) {
    const s = Geo.stats(r.points);
    $("#edit-gpshint").innerHTML = '<div class="note">D\'après la trace GPS : ' + s.dist.toFixed(2).replace(".", ",") + " km · " +
      Math.round(s.dur) + " min · " + s.dplus + " m D+. Tu peux corriger les valeurs ci-dessous si le GPS a dérapé (la trace reste intacte).</div>";
  } else $("#edit-gpshint").innerHTML = "";
  const shoeOpts = '<option value="">—</option>' + state.shoes.map(s =>
    '<option value="' + s.id + '"' + (r.shoeId === s.id ? " selected" : "") + ">" + esc(s.name) + "</option>").join("");
  $("#edit-form").innerHTML =
    '<label>Date <input type="date" id="ed-date" value="' + r.date + '"></label>' +
    '<label>Type <select id="ed-code">' + Object.keys(TYPES).map(c => '<option value="' + c + '"' + (r.code === c ? " selected" : "") + ">" + esc(TYPES[c].label) + "</option>").join("") + "</select></label>" +
    '<label>Distance (km) <input type="number" id="ed-dist" step="0.01" min="0" value="' + (r.dist || "") + '"></label>' +
    '<label>Durée (min) <input type="number" id="ed-dur" step="1" min="0" value="' + (r.dur || "") + '"></label>' +
    '<label>D+ (m) <input type="number" id="ed-dplus" step="1" min="0" value="' + (r.dplus || 0) + '"></label>' +
    '<label>Chaussures <select id="ed-shoe">' + shoeOpts + "</select></label>" +
    '<label>Type de route <select id="ed-route"><option value="">—</option>' +
      ROUTES.map(rt => '<option value="' + rt.id + '"' + (r.route === rt.id ? " selected" : "") + ">" + esc(rt.label) + "</option>").join("") + "</select></label>" +
    '<label>Sensations (/10) <input type="number" id="ed-feel" min="1" max="10" value="' + (r.feel || "") + '"></label>' +
    '<label>Douleur essuie-glace (/10) <input type="number" id="ed-knee" min="0" max="10" value="' + (r.knee != null ? r.knee : "") + '"></label>' +
    '<label>Douleur cheville (/10) <input type="number" id="ed-ankle" min="0" max="10" value="' + (r.ankle != null ? r.ankle : "") + '"></label>' +
    '<label class="full">Notes <textarea id="ed-notes" rows="2">' + esc(r.notes || "") + "</textarea></label>";
  $("#edit-modal").classList.remove("hidden");
}
$("#edit-close").addEventListener("click", () => $("#edit-modal").classList.add("hidden"));
$("#edit-save").addEventListener("click", () => {
  const r = state.runs.find(x => x.id === editingRunId); if (!r) return;
  r.date = $("#ed-date").value || r.date;
  r.code = $("#ed-code").value;
  r.dist = parseFloat($("#ed-dist").value) || 0;
  r.dur = parseFloat($("#ed-dur").value) || 0;
  r.dplus = parseInt($("#ed-dplus").value) || 0;
  r.shoeId = $("#ed-shoe").value ? +$("#ed-shoe").value : null;
  r.route = $("#ed-route").value || null;
  r.feel = $("#ed-feel").value ? +$("#ed-feel").value : null;
  r.knee = $("#ed-knee").value !== "" ? +$("#ed-knee").value : null;
  r.ankle = $("#ed-ankle").value !== "" ? +$("#ed-ankle").value : null;
  r.notes = $("#ed-notes").value.trim();
  const pe = plannedRunEntry(r.date);
  r.planKey = pe ? itemKey(pe.w, pe.d, pe.i) : null; // la durée réelle remplace les minutes planifiées
  save();
  $("#edit-modal").classList.add("hidden");
  toast("Sortie corrigée.");
  renderRuns();
});
let pendingPoints = null;

function saveRunFromForm() {
  const date = $("#rf-date").value || isoDate(new Date());
  const dist = parseFloat($("#rf-dist").value) || 0;
  const dur = parseFloat($("#rf-dur").value) || 0;
  if (!dist && !dur && !(pendingPoints && pendingPoints.length > 1)) {
    toast("Indique au moins une distance ou une durée."); return;
  }
  const shoeId = $("#rf-shoe").value ? +$("#rf-shoe").value : null;
  if (!shoeId) {
    if (state.shoes.some(s => !s.retired)) {
      toast("Sélectionne la paire de chaussures utilisée — le cumul de km sera mis à jour.");
      $("#rf-shoe").focus();
      return;
    }
    toast("Astuce : ajoute tes paires dans l'onglet Chaussures pour suivre leur usure.");
  }
  const pe = plannedRunEntry(date);
  const run = {
    id: state.seq++,
    date,
    code: $("#rf-code").value || "AUTRE",
    dist, dur: Math.round(dur),
    dplus: parseInt($("#rf-dplus").value) || 0,
    feel: $("#rf-feel").value ? +$("#rf-feel").value : null,
    knee: $("#rf-knee").value !== "" && $("#rf-knee").value != null ? +$("#rf-knee").value : null,
    ankle: $("#rf-ankle").value !== "" && $("#rf-ankle").value != null ? +$("#rf-ankle").value : null,
    notes: $("#rf-notes").value.trim(),
    shoeId,
    route: $("#rf-route").value || null,
    points: (pendingPoints && pendingPoints.length > 1) ? pendingPoints : null,
    trackRef: null,
    planned: pe ? pe.it.t : null,
    planKey: pe ? (pe.isCustom ? customKey(pe.custom.id) : itemKey(pe.w, pe.d, pe.i)) : null
  };
  state.runs.push(run);
  state.lastShoeId = shoeId;
  save();
  /* trace GPS volumineuse : rangée hors état (R2) quand le serveur le permet */
  if (run.points && run.points.length > 40 && ServerSync.tracks) {
    run.trackRef = run.id;
    fetch("api/track?id=" + run.trackRef, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(run.points)
    }).catch(() => {});
    save(); // renvoie l'état sans les points (déportés)
  }
  const realNoteMsg = pe && run.dur
    ? " Durée réelle comptée : " + run.dur + " min (à la place des " + ((itemOfKey(run.planKey) || {}).m || 0) + " min planifiées)."
    : "";
  pendingPoints = null;
  ["#rf-dist", "#rf-dur", "#rf-dplus", "#rf-feel", "#rf-knee", "#rf-ankle", "#rf-notes"].forEach(s => $(s).value = "");
  $("#rf-route").value = "";
  if (shoeId) {
    const shoe = state.shoes.find(s => s.id === shoeId);
    if (shoe) {
      const km = shoeKm(shoe);
      const pct = Math.min(100, Math.round(100 * km / shoe.maxKm));
      toast("Sortie enregistrée — " + shoe.name + " : " + km.toFixed(1).replace(".", ",") + " km cumulés (" + pct + " % de sa vie estimée)." + realNoteMsg);
    } else toast("Sortie enregistrée. Bien joué !" + realNoteMsg);
  } else toast("Sortie enregistrée. Bien joué !" + realNoteMsg);
  renderRuns();
}
function shoeKm(shoe) {
  return state.runs.filter(r => r.shoeId === shoe.id).reduce((a, r) => a + (r.dist || 0), 0);
}

/* ================= vue : chaussures ================= */
function renderShoes() {
  let html = "<h2>Chaussures — usure cumulée</h2>" +
    '<div class="muted sub">Ajoute tes paires : chaque sortie enregistrée avec une paire cumule ses kilomètres et son dénivelé. ' +
    "Une paire de trail tient en général 600 à 900 km ; garde une marge de sécurité avant le jour J (chaussures rodées de 100 à 200 km).</div>";

  html += '<div class="form-inline"><label>Nom <input id="sh-name" placeholder="Ex : Salomon Speedcross (trail)"></label>' +
    '<label>Neuve le <input type="date" id="sh-born" value="' + isoDate(new Date()) + '"></label>' +
    '<label>Km de vie estimés <input type="number" id="sh-max" value="700" min="100" step="50"></label>' +
    '<button class="btn primary" id="sh-add">Ajouter la paire</button></div>';

  if (!state.shoes.length) html += '<div class="muted">Aucune paire pour l\'instant.</div>';
  state.shoes.forEach(s => {
    const runs = state.runs.filter(r => r.shoeId === s.id);
    const km = runs.reduce((a, r) => a + (r.dist || 0), 0);
    const dp = runs.reduce((a, r) => a + (r.dplus || 0), 0);
    const pct = Math.min(100, Math.round(100 * km / s.maxKm));
    const cls = pct >= 100 ? "dead" : pct >= 85 ? "warn" : "ok";
    html += '<div class="shoe-card ' + (s.retired ? "retired" : "") + '">' +
      '<div class="shoe-head"><b>' + esc(s.name) + "</b>" +
      '<span class="muted">ajoutée le ' + fmtDateShort(parseDate(s.born)) + "</span>" +
      '<span class="spacer"></span>' +
      (s.retired ? '<span class="chip c-rest">retraitée</span>' : "") +
      '<button class="btn tiny" data-retire="' + s.id + '">' + (s.retired ? "Réactiver" : "Retirer") + "</button>" +
      '<button class="icon-btn del" data-shdel="' + s.id + '">✕</button></div>' +
      '<div class="shoe-stats"><div class="run-stat"><span>' + km.toFixed(1).replace(".", ",") + ' km</span><label>cumulés (' + runs.length + ' sorties)</label></div>' +
      '<div class="run-stat"><span>' + dp + ' m</span><label>D+ cumulé</label></div>' +
      '<div class="run-stat"><span>' + Math.max(0, Math.round(s.maxKm - km)) + ' km</span><label>restants (estimation)</label></div></div>' +
      '<div class="shoe-bar"><div class="shoe-fill ' + cls + '" style="width:' + pct + '%"></div></div>' +
      '<div class="muted small">' + pct + " % de la vie estimée (" + s.maxKm + " km)</div>" +
      "</div>";
  });

  html += '<div class="note">Le jour J : une paire rodée de 100 à 200 km, semelles accrochant les feuilles mouillées. Rien de neuf, jamais.</div>';
  $("#view-shoes").innerHTML = html;

  $("#sh-add").addEventListener("click", () => {
    const name = $("#sh-name").value.trim() || "Paire " + (state.shoes.length + 1);
    state.shoes.push({ id: state.seq++, name, born: $("#sh-born").value || isoDate(new Date()), maxKm: +$("#sh-max").value || 700, retired: false });
    save(); renderShoes();
  });
  $$("button[data-shdel]").forEach(b => b.addEventListener("click", () => {
    if (!confirm("Supprimer cette paire ? Les sorties ne seront pas supprimées.")) return;
    state.shoes = state.shoes.filter(s => s.id !== +b.dataset.shdel);
    save(); renderShoes();
  }));
  $$("button[data-retire]").forEach(b => b.addEventListener("click", () => {
    const s = state.shoes.find(x => x.id === +b.dataset.retire);
    s.retired = !s.retired; save(); renderShoes();
  }));
}

/* ================= vue : progression ================= */
function renderProgress() {
  const cw = currentWeek();
  const totalItems = WEEKS.reduce((a, w) => a + allItems(w.n).length, 0);
  const doneItems = Object.keys(state.done).length;
  const planMin = totalPlannedMin(), doneMin = totalRealizedMin();
  const totDays = Math.max(1, daysBetween(state.start, RACE.date));
  const elDays = Math.max(0, Math.min(totDays, daysBetween(state.start, isoDate(new Date()))));
  const km = state.runs.reduce((a, r) => a + (r.dist || 0), 0);
  const dplus = state.runs.reduce((a, r) => a + (r.dplus || 0), 0);

  let html = "<h2>Progression</h2>";

  html += '<div class="stat-cards big-cards">' +
    '<div class="stat"><span>' + Math.round(100 * elDays / totDays) + ' %</span><label>temps écoulé (J' + (elDays - totDays <= 0 ? "−" + (totDays - elDays) : "+" + (elDays - totDays)) + ")</label></div>" +
    '<div class="stat"><span>' + doneItems + " / " + totalItems + '</span><label>séances cochées</label></div>' +
    '<div class="stat"><span>' + fmtHours(doneMin) + " / " + fmtHours(planMin) + ' h</span><label>volume réalisé / planifié (temps réel des sorties' + (totalExtraMin() ? " + " + totalExtraMin() + " min hors programme" : "") + ")</label></div>" +
    '<div class="stat"><span>' + km.toFixed(0) + ' km</span><label>distance courue (sorties enregistrées)</label></div>' +
    '<div class="stat"><span>' + dplus + " / " + RACE.dplus + ' m</span><label>D+ cumulé / D+ de la course</label></div>' +
    "</div>";

  html += '<div class="dplus-race"><div class="dplus-track"><div class="dplus-fill" style="width:' + Math.min(100, 100 * dplus / RACE.dplus) + '%"></div></div>' +
    '<div class="muted small">' + Math.min(100, Math.round(100 * dplus / RACE.dplus)) + " % du dénivelé de la course, cumulé à l'entraînement</div></div>";

  /* graphique volume hebdo : planifié (barre claire) vs réalisé (barre pleine) */
  const maxVol = Math.max.apply(null, WEEKS.map(w => w.vol));
  html += "<h3>Volume hebdomadaire — planifié vs réalisé</h3>";
  html += '<svg class="volchart" viewBox="0 0 950 230" width="100%">';
  for (let i = 0; i < WEEKS.length; i++) {
    const w = WEEKS[i], x = 30 + i * 31;
    const hPlan = (w.vol / maxVol) * 150;
    const dm = realizedMinutes(w.n) / 60;
    const hDone = (dm / maxVol) * 150;
    html += '<rect x="' + x + '" y="' + (180 - hPlan) + '" width="18" height="' + hPlan + '" rx="3" class="vol-plan" style="--c:' + blockOf(w.n).color + '"/>';
    if (hDone > 0) html += '<rect x="' + (x + 2) + '" y="' + (180 - hDone) + '" width="14" height="' + hDone + '" rx="2" class="vol-done"/>';
    html += '<text x="' + (x + 9) + '" y="195" text-anchor="middle" class="vol-label' + (w.n === cw ? " cur" : "") + '">S' + w.n + "</text>";
    if (w.light) html += '<circle cx="' + (x + 9) + '" cy="202" r="2" class="vol-light"/>';
  }
  html += '<line x1="25" y1="180" x2="940" y2="180" class="vol-axis"/></svg>';
  html += '<div class="legend"><span class="lg"><i class="vol-plan" style="--c:#3d6ea5"></i> planifié (h)</span><span class="lg"><i class="vol-done"></i> réalisé (cochages + hors programme, h)</span><span class="lg"><i class="vol-light"></i> semaine allégée</span></div>';

  /* temps d'exercice ajouté hors programme (minuteurs libres, séances guidées sans créneau) */
  if ((state.extra || []).length) {
    html += "<h3>Temps hors programme</h3>";
    html += '<div class="note">Exercices ajoutés en dehors du programme et comptés dans le volume réalisé : ' +
      totalExtraMin() + " min au total. Les sorties enregistrées, elles, comptent pour leur <b>durée réelle</b> " +
      "(à la place des minutes planifiées de la séance correspondante).</div><div class='extra-list'>";
    state.extra.slice().sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id).forEach(e => {
      html += '<div class="extra-item"><span class="muted">' + fmtDateShort(parseDate(e.date)) + "</span>" +
        typeChip(e.code === "EXO" ? "AUTRE" : e.code) + "<span>" + esc(e.label) + "</span>" +
        '<span class="spacer"></span><b>' + e.min + " min</b>" +
        '<button class="icon-btn del" data-exdel="' + e.id + '" title="Supprimer">✕</button></div>';
    });
    html += "</div>";
  }

  /* D+ cumulé des sorties enregistrées, par semaine */
  html += "<h3>Dénivelé cumulé des sorties enregistrées</h3>";
  const dplusByWeek = {};
  state.runs.forEach(r => { const wk = weekOfDate(r.date); dplusByWeek[wk] = (dplusByWeek[wk] || 0) + (r.dplus || 0); });
  const maxDp = Math.max(200, ...Object.values(dplusByWeek));
  html += '<svg class="volchart" viewBox="0 0 950 200" width="100%">';
  for (let i = 0; i < WEEKS.length; i++) {
    const w = WEEKS[i], x = 30 + i * 31;
    const dp = dplusByWeek[w.n] || 0;
    const h = (dp / maxDp) * 130;
    if (dp > 0) html += '<rect x="' + x + '" y="' + (160 - h) + '" width="18" height="' + h + '" rx="3" class="vol-done dp"/>';
    html += '<text x="' + (x + 9) + '" y="175" text-anchor="middle" class="vol-label' + (w.n === cw ? " cur" : "") + '">S' + w.n + "</text>";
  }
  html += '<line x1="25" y1="160" x2="940" y2="160" class="vol-axis"/></svg>';

  /* douleurs */
  const painRuns = state.runs.filter(r => r.knee != null || r.ankle != null);
  html += "<h3>Suivi douleurs (règle : > 3/10 sur deux séances consécutives = alléger)</h3>";
  if (!painRuns.length) html += '<div class="muted">Note tes sensations sur chaque sortie pour voir apparaître la tendance ici.</div>';
  else {
    html += '<svg class="volchart" viewBox="0 0 950 200" width="100%">';
    const n = Math.min(painRuns.length, 30);
    const recent = painRuns.slice(-n);
    recent.forEach((r, i) => {
      const x = 30 + i * (900 / Math.max(1, n - 1));
      const ky = 170 - (r.knee || 0) * 14;
      const ay = 170 - (r.ankle || 0) * 14;
      html += '<circle cx="' + x + '" cy="' + ky + '" r="5" class="pt-knee"/>';
      html += '<circle cx="' + x + '" cy="' + ay + '" r="5" class="pt-ankle"/>';
    });
    html += '<line x1="25" y1="170" x2="940" y2="170" class="vol-axis"/>';
    html += '<line x1="25" y1="128" x2="940" y2="128" class="pain-thresh"/></svg>';
    html += '<div class="legend"><span class="lg"><i class="pt-knee"></i> essuie-glace</span><span class="lg"><i class="pt-ankle"></i> cheville</span><span class="lg"><i class="pain-thresh"></i> seuil 3/10</span></div>';
  }

  /* indicateurs */
  html += "<h3>Indicateurs de réussite avant le départ</h3><ul class='checklist'>";
  const s25sl = isDone(25, 6, 0);
  html += "<li class='" + (s25sl ? "ok" : "") + "'>Sortie longue de S25 (3 h 30 à allure course, bâtons si tu les utiliseras) terminée avec le sourire et les jambes</li>";
  const b4knee = state.runs.filter(r => r.knee != null && weekOfDate(r.date) >= 22 && weekOfDate(r.date) <= 25 && r.knee > 2).length === 0 && state.runs.some(r => weekOfDate(r.date) >= 22);
  html += "<li class='" + (b4knee ? "ok" : "") + "'>Aucune douleur essuie-glace > 2/10 dans le bloc 4 (S22-S25)</li>";
  const preps = isDone(15, 6, 0) && isDone(19, 6, 0);
  html += "<li class='" + (preps ? "ok" : "") + "'>Les deux courses préparatoires courues (S15 et S19) : matériel, ravito et départ contrôlé répétés</li>";
  html += "<li>Règlement des bâtons vérifié avant la fin S24 — et si tu les prends, au moins 4 semaines d'entraînement avec (S25-S28)</li>";
  html += "<li>60-90 g de glucides/heure avalés sans dégoût sur les trois dernières sorties longues (audit des emballages en S23)</li><li>L'envie d'y être déjà.</li></ul>";

  $("#view-progress").innerHTML = html;
  $$("button[data-exdel]").forEach(b => b.addEventListener("click", () => {
    state.extra = state.extra.filter(e => e.id !== +b.dataset.exdel);
    save(); renderProgress(); renderToday(); updateHeader();
  }));
}

/* ================= vue : coach IA (Mistral) ================= */
const COACH_SUGGESTIONS = [
  "Où j'en suis, coach ?",
  "Analyse mes dernières sorties",
  "Je n'ai pas pu faire ma sortie longue, comment j'ajuste ?",
  "Ma douleur essuie-glace revient en descente, que faire ?",
  "Que dois-je tester au ravitaillement sur la prochaine sortie longue ?",
  "Comment je gère mes deux courses préparatoires (S15, S19) ?",
  "Bâtons sur le Trail des Forts : pour ou contre pour moi ?",
  "Comment bien vivre mon affûtage ?"
];

function renderCoach() {
  let html = "<h2>Coach IA — Trail</h2>" +
    '<div class="muted sub">Un coach Mistral AI embarqué, informé en direct de ton programme réalisé, de tes sorties, ' +
    "de tes douleurs et de l'usure de tes chaussures (skill « coach trail »).</div>";
  if (!state.mistral.key) {
    html += '<div class="note">Pour activer le coach, entre ta clé API Mistral dans l\'onglet <b>Réglages</b> ' +
      "(crée une clé sur console.mistral.com — l'offre gratuite suffit). La clé reste dans ce navigateur.</div>";
  }
  html += '<div class="coach-wrap">' +
    '<div class="coach-msgs" id="coach-msgs">' + coachMsgsHTML() + "</div>" +
    '<div class="row-actions coach-sugg">' + COACH_SUGGESTIONS.map(s =>
      '<button class="mini-btn" data-sugg="' + esc(s) + '">' + esc(s) + "</button>").join("") + "</div>" +
    '<div class="coach-input">' +
    '<textarea id="coach-in" rows="2" placeholder="Pose ta question au coach…"></textarea>' +
    '<button class="btn primary" id="coach-send">Envoyer</button>' +
    '<button class="btn" id="coach-clear" title="Effacer la conversation">🗑</button>' +
    "</div></div>";
  $("#view-coach").innerHTML = html;
  $("#coach-send").addEventListener("click", sendCoach);
  $("#coach-in").addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendCoach(); }
  });
  $("#coach-clear").addEventListener("click", () => {
    if (state.chat.length && confirm("Effacer la conversation ?")) { state.chat = []; save(); renderCoach(); }
  });
  $$("button[data-sugg]").forEach(b => b.addEventListener("click", () => {
    $("#coach-in").value = b.dataset.sugg; sendCoach();
  }));
  scrollCoachBottom();
}

function coachMsgsHTML() {
  if (!state.chat.length)
    return '<div class="muted coach-empty">Exemples de questions : clique sur une suggestion ci-dessous.</div>';
  return state.chat.map(m =>
    '<div class="coach-msg ' + (m.role === "user" ? "me" : "ai") + '"><div class="coach-bubble">' +
    m.content.split("\n").map(l => esc(l)).join("<br>") + "</div></div>").join("");
}
function scrollCoachBottom() {
  const box = $("#coach-msgs"); if (box) box.scrollTop = box.scrollHeight;
}

async function sendCoach() {
  const input = $("#coach-in");
  const q = input.value.trim();
  if (!q) return;
  if (!state.mistral.key) {
    toast("Entre ta clé API Mistral dans l'onglet Réglages pour activer le coach.");
    showView("settings"); return;
  }
  input.value = "";
  state.chat.push({ role: "user", content: q });
  if (state.chat.length > 60) state.chat = state.chat.slice(-60);
  save();
  // indicateur « en train d'écrire »
  const box = $("#coach-msgs");
  box.innerHTML = coachMsgsHTML() + '<div class="coach-msg ai"><div class="coach-bubble muted">Le coach réfléchit…</div></div>';
  scrollCoachBottom();
  try {
    const messages = [{ role: "system", content: coachContext() },
      ...state.chat.slice(-20).map(m => ({ role: m.role, content: m.content }))];
    const res = await fetch(state.mistral.url + "/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + state.mistral.key },
      body: JSON.stringify({ model: state.mistral.model || "mistral-small-latest", messages, temperature: 0.6, max_tokens: 800 })
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error("API " + res.status + " — " + err.slice(0, 200));
    }
    const data = await res.json();
    const reply = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!reply) throw new Error("réponse vide de l'API");
    state.chat.push({ role: "assistant", content: reply.trim() });
    save();
  } catch (err) {
    let msg = "Erreur du coach : " + err.message;
    if (String(err).includes("Failed to fetch")) msg = "Impossible de joindre l'API Mistral (réseau, CORS ou clé invalide). Vérifie ta connexion et ta clé dans Réglages.";
    state.chat.push({ role: "assistant", content: msg });
    save();
  }
  renderCoach();
}

function storageNoteHTML() {
  if (ServerSync.on)
    return "<b>Mode dynamique</b> : les données sont enregistrées sur le <b>serveur centralisé</b> " +
      "(fichier <code>server/data/state.json</code>) et partagées entre tous les appareils connectés. " +
      "Le navigateur garde une copie de secours (localStorage) si le serveur est injoignable.";
  return "<b>Mode local</b> : aucune instance de serveur détectée — les données restent dans " +
    "<b>ce navigateur uniquement</b>. Lance <code>node server/server.js</code> pour un stockage " +
    "centralisé et partagé entre appareils, ou utilise la synchronisation des cochages ci-dessous.";
}

/* ================= vue : réglages ================= */
function renderSettings() {
  $("#view-settings").innerHTML =
    "<h2>Réglages</h2>" +
    '<div class="note" id="storage-note">' + storageNoteHTML() + "</div>" +
    "<h3>Programme</h3>" +
    '<div class="form-grid">' +
    '<label>Début du programme (lundi S1) <input type="date" id="st-start" value="' + state.start + '"></label>' +
    "</div>" +
    "<h3>Verrouillage</h3>" +
    '<div class="form-grid">' +
    '<label class="full">Mot de passe d\'accès <input type="text" id="st-pass" value="' + esc(state.password || "") + '" placeholder="vide = pas de verrou"></label>' +
    "</div>" +
    '<div class="muted small">Au chargement, l\'app demande ce mot de passe ; « Se souvenir sur cet appareil » l\'évite ensuite. ' +
    "Verrou simple contre les curieux — le chiffrement des données n'en dépend pas.</div>" +
    '<div class="row-actions"><button class="btn" id="st-locknow">Verrouiller maintenant</button></div>' +
    "<h3>Profil coureur</h3>" +
    '<div class="form-grid">' +
    '<label>FC max (bpm) <input type="number" id="st-fcm" min="100" max="230" placeholder="ex. 185" value="' + (state.profile && state.profile.fcm || "") + '"></label>' +
    '<label>FC repos (bpm) <input type="number" id="st-resthr" min="30" max="110" placeholder="ex. 48" value="' + (state.profile && state.profile.repos != null ? state.profile.repos : "") + '"></label>' +
    '<label>Poids (kg) <input type="number" id="st-weight" min="35" max="150" step="0.1" placeholder="ex. 72,5" value="' + (state.profile && state.profile.poids != null ? state.profile.poids : "") + '"></label>' +
    '<label>VMA (km/h) <input type="number" id="st-vma" min="8" max="25" step="0.1" placeholder="ex. 13,5" value="' + (state.profile && state.profile.vma != null ? state.profile.vma : "") + '"></label>' +
    "</div>" +
    '<div class="muted small">Le profil affine les séances (zones réelles affichées dans les séances qualité) et alimente le coach IA. ' +
    "FC max au choix : test de terrain, ou 208 − 0,7 × âge en première approximation.</div>" +
    (hrZones() ? zonesHTML() : "") +
    "<h3>Apparence</h3>" +
    '<div class="form-grid">' +
    '<label>Thème <select id="st-theme"><option value="dark"' + (state.ui.theme === "dark" ? " selected" : "") + '>Sombre</option><option value="light"' + (state.ui.theme === "light" ? " selected" : "") + '>Clair</option></select></label>' +
    '<label>Taille de police <select id="st-font"><option value="0"' + (!state.ui.font ? " selected" : "") + '>Normale</option><option value="1"' + (state.ui.font === 1 ? " selected" : "") + ">Grande</option></select></label>" +
    "</div>" +
    "<h3>Coach IA — Mistral AI</h3>" +
    '<div class="form-grid">' +
    '<label class="full">Clé API Mistral <input type="password" id="st-key" placeholder="https://console.mistral.com → API keys" value="' + esc(state.mistral.key) + '"></label>' +
    '<label>Modèle <select id="st-model">' +
      ["mistral-small-latest", "mistral-medium-latest", "mistral-large-latest"].map(m =>
        '<option value="' + m + '"' + (state.mistral.model === m ? " selected" : "") + ">" + m + "</option>").join("") +
      "</select></label>" +
    '<label>URL de l\'API <input type="text" id="st-url" value="' + esc(state.mistral.url) + '"></label>' +
    "</div>" +
    '<div class="muted small">La clé est stockée uniquement dans ce navigateur et envoyée directement à api.mistral.ai. ' +
    "Le skill « coach trail » transmet à chaque question : semaine en cours, séances cochées, dernières sorties, douleurs, usure des chaussures.</div>" +
    '<div class="row-actions"><button class="btn primary" id="st-save">Enregistrer</button>' +
    '<button class="btn" id="st-test">Tester la connexion au coach</button>' +
    '<button class="btn" id="st-export">Exporter mes données (JSON)</button>' +
    '<label class="btn file-btn">Importer des données (JSON) <input type="file" id="st-import" accept=".json"></label>' +
    '<button class="btn danger" id="st-reset">Tout effacer</button></div>' +
    '<div class="note">Les données (séances cochées, sorties, GPS, chaussures, conversation, clé API) sont stockées uniquement dans ce navigateur. ' +
    "Pense à exporter régulièrement une sauvegarde.</div>" +
    "<h3>Synchronisation des cochages entre appareils</h3>" +
    '<div class="muted small">Le code ci-dessous contient uniquement les séances cochées (pas les sorties GPS, ni la clé API). ' +
    "Envoie-le à ton autre appareil (message, e-mail, fichier) : à l'import, les cochages sont <b>fusionnés</b> — rien n'est effacé, sur aucun des deux appareils.</div>" +
    '<label class="full">Code de synchronisation <textarea id="sy-code" rows="3" readonly placeholder="Clique sur « Générer le code »…"></textarea></label>' +
    '<div class="row-actions"><button class="btn" id="sy-gen">Générer le code</button>' +
    '<button class="btn" id="sy-copy">Copier le code</button>' +
    '<button class="btn" id="sy-copylink">Copier un lien de synchronisation</button>' +
    '<button class="btn" id="sy-file">Télécharger le fichier de cochages</button></div>' +
    '<label class="full">Code reçu d\'un autre appareil — colle-le ici <textarea id="sy-in" rows="3" placeholder="Colle le code, ou ouvre le fichier .txt reçu…"></textarea></label>' +
    '<div class="row-actions"><button class="btn primary" id="sy-import">Fusionner les cochages</button>' +
    '<label class="btn file-btn">Ouvrir un fichier de cochages <input type="file" id="sy-infile" accept=".txt,.json"></label></div>' +
    '<div class="muted small">Astuce : le lien de synchronisation s\'ouvre directement sur l\'autre appareil et propose la fusion automatique. ' +
    "Pour les sorties GPS et les chaussures, utilise plutôt l'export JSON complet ci-dessus (qui remplace tout).</div>";

  $("#st-save").addEventListener("click", () => {
    state.start = $("#st-start").value || DEFAULT_START;
    state.password = $("#st-pass").value.trim() || null;
    const fcm = +$("#st-fcm").value, repos = +$("#st-resthr").value, poids = +$("#st-weight").value, vma = +$("#st-vma").value;
    state.profile = (fcm || repos || poids || vma)
      ? { fcm: fcm || null, repos: repos || null, poids: poids || null, vma: vma || null }
      : null;
    state.ui.theme = $("#st-theme").value;
    state.ui.font = +$("#st-font").value;
    applyUi();
    state.mistral.key = $("#st-key").value.trim();
    state.mistral.model = $("#st-model").value;
    state.mistral.url = $("#st-url").value.trim() || "https://api.mistral.ai";
    save(); toast("Réglages enregistrés."); updateHeader(); renderToday();
  });
  $("#st-locknow").addEventListener("click", () => {
    localStorage.removeItem(UNLOCK_KEY);
    checkLock();
    toast("Verrouillé — le mot de passe sera demandé au prochain chargement.");
  });
  $("#st-test").addEventListener("click", async () => {
    const key = $("#st-key").value.trim();
    if (!key) { toast("Entre d'abord une clé API."); return; }
    toast("Test en cours…");
    try {
      const res = await fetch(($("#st-url").value.trim() || "https://api.mistral.ai") + "/v1/models", {
        headers: { "Authorization": "Bearer " + key } });
      if (res.ok) toast("Connexion OK — le coach est prêt.");
      else if (res.status === 401) toast("Clé refusée (401). Vérifie la clé sur console.mistral.com.");
      else toast("Réponse API : " + res.status);
    } catch (e) { toast("Impossible de joindre l'API (réseau ou CORS)."); }
  });
  $("#st-export").addEventListener("click", () => {
    Geo.download("trainingtrail-sauvegarde.json", JSON.stringify(state, null, 2), "application/json");
  });
  $("#st-import").addEventListener("change", async e => {
    try {
      const data = JSON.parse(await e.target.files[0].text());
      if (confirm("Remplacer toutes les données actuelles par la sauvegarde ?")) {
        Object.assign(state, data); normalizeState(); save();
        toast("Données importées."); renderSettings(); updateHeader();
      }
    } catch (err) { toast("Import impossible : " + err.message); }
  });
  $("#st-reset").addEventListener("click", () => {
    if (!confirm("Effacer toutes les données (séances cochées, sorties, chaussures, conversation) ? Action irréversible.")) return;
    const keep = state.mistral; // on garde la clé API
    const keepPass = state.password; // et le mot de passe
    const keepUi = state.ui; // et les préférences d'apparence de cet appareil
    state = { start: DEFAULT_START, done: {}, moves: {}, hidden: {}, custom: [], extra: [], runs: [], shoes: [], lastShoeId: null, seq: 1, lastWeekView: null, mistral: keep, password: keepPass, ui: keepUi, chat: [] };
    save(); toast("Données effacées."); renderSettings(); updateHeader();
  });

  /* ---- synchronisation des cochages entre appareils ---- */
  const genCode = () => { $("#sy-code").value = buildSyncCode(); toast("Code généré (" + $("#sy-code").value.length + " caractères) — copie-le ou envoie le fichier."); };
  $("#sy-gen").addEventListener("click", genCode);
  $("#sy-copy").addEventListener("click", () => copyText($("#sy-code").value || buildSyncCode(), "Code copié — colle-le sur l'autre appareil (Réglages → Fusionner)."));
  $("#sy-copylink").addEventListener("click", () => {
    const code = $("#sy-code").value || buildSyncCode();
    const url = location.href.split("#")[0] + "#sync=" + code;
    if (url.length > 2000) { toast("Trop de cochages pour un lien — utilise plutôt le fichier .txt."); return; }
    copyText(url, "Lien copié — ouvre-le sur l'autre appareil (même adresse du site).");
  });
  $("#sy-file").addEventListener("click", () => {
    Geo.download("cochages-" + isoDate(new Date()) + ".txt", $("#sy-code").value || buildSyncCode(), "text/plain");
  });
  const importCode = code => {
    try {
      const r = applySyncCode(code);
      const startWarn = r.start && r.start !== state.start
        ? " Attention : date de début différente (" + r.start + " sur l'autre appareil) — vérifie les dates dans Réglages."
        : "";
      if (r.added === 0) toast("Rien de nouveau à fusionner — cet appareil est déjà à jour (" + r.total + " cochages dans le code)." + startWarn);
      else toast("Fusion terminée : +" + r.added + " cochages (code du " + r.date + ")." + startWarn);
      updateHeader(); renderToday();
      if ($("#view-program").classList.contains("active")) renderProgram();
    } catch (err) { toast("Import impossible : " + err.message); }
  };
  $("#sy-import").addEventListener("click", () => {
    const code = $("#sy-in").value.trim();
    if (!code) { toast("Colle d'abord le code de synchronisation."); return; }
    importCode(code);
  });
  $("#sy-infile").addEventListener("change", async e => {
    try { importCode((await e.target.files[0].text()).trim()); }
    catch (err) { toast("Fichier illisible."); }
    e.target.value = "";
  });
}

/* ================= synchronisation des cochages (fusion, sans compte) ================= */
function buildSyncCode() {
  const payload = { v: 1, type: "cochages", date: isoDate(new Date()), start: state.start, done: state.done };
  // base64 URL-sûr (transférable dans un lien ou un message sans encodage des + /)
  return btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function applySyncCode(code) {
  code = String(code || "").trim();
  if (!code) throw new Error("code vide");
  let payload = null;
  try { payload = JSON.parse(code); } catch (e) { /* pas du JSON brut : on tente le base64 */ }
  if (!payload) {
    try {
      let b = code.replace(/-/g, "+").replace(/_/g, "/");
      while (b.length % 4) b += "=";
      payload = JSON.parse(atob(b));
    } catch (e) { throw new Error("code illisible ou incomplet"); }
  }
  if (!payload || payload.type !== "cochages" || !payload.done || typeof payload.done !== "object")
    throw new Error("ce code n'est pas un code de cochages TrainingTrail");
  let added = 0;
  const valid = /^\d+-\d+-\d+$/;
  Object.keys(payload.done).forEach(k => {
    if (valid.test(k) && !state.done[k]) { state.done[k] = true; added++; }
  });
  save();
  return { added, total: Object.keys(payload.done).length, date: payload.date || "?", start: payload.start || null };
}
function importFromHash() {
  const m = location.hash.match(/#sync=([A-Za-z0-9_-]+)/);
  if (!m) return;
  try {
    const r = applySyncCode(m[1]);
    history.replaceState(null, "", location.pathname + location.search);
    const startWarn = r.start && r.start !== state.start
      ? " Attention : date de début différente (" + r.start + ") — vérifie dans Réglages."
      : "";
    if (r.added === 0) toast("Lien de synchronisation : rien de nouveau à fusionner." + startWarn);
    else toast("Cochages importés depuis le lien : +" + r.added + " (code du " + r.date + ")." + startWarn);
    updateHeader(); renderToday();
    if ($("#view-program").classList.contains("active")) renderProgram();
  } catch (e) {
    toast("Lien de synchronisation invalide.");
  }
}
function copyText(txt, msg) {
  const ok = () => toast(msg || "Copié.");
  const fallback = () => {
    const ta = document.createElement("textarea");
    ta.value = txt; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); ok(); } catch (e) { toast("Copie impossible — sélectionne le texte manuellement."); }
    ta.remove();
  };
  if (navigator.clipboard && navigator.clipboard.writeText)
    navigator.clipboard.writeText(txt).then(ok, fallback);
  else fallback();
}

/* ================= serveur de stockage (site dynamique) ================= */
/* Si le site est servi par server/server.js, les données sont centralisées dans
   data/state.json : tous les appareils partagent le même état. Sans serveur
   (fichier local ou GitHub Pages), tout retombe sur le localStorage du navigateur. */
const ServerSync = {
  on: false,
  tracks: false,   // le serveur stocke-t-il les traces GPS séparément (R2) ?
  pushTimer: null,
  pullTimer: null,
  pushWarned: false,

  /* recharge les traces GPS rangées hors état (R2) dans les runs affichés */
  async loadTracks() {
    if (!this.on || !this.tracks) return;
    const jobs = state.runs.filter(r => r.trackRef && !r.points).map(r =>
      fetch("api/track?id=" + r.trackRef, { cache: "no-store" })
        .then(res => res.ok ? res.text() : null)
        .then(txt => { try { r.points = JSON.parse(txt); } catch (e) { } })
        .catch(() => { })
    );
    if (jobs.length) await Promise.all(jobs);
  },

  async init() {
    try {
      const res = await fetch("api/ping", { cache: "no-store" });
      if (!res.ok) return;
      const ping = await res.json();
      if (!ping || !ping.ok) return;
      this.on = true;
      this.tracks = !!ping.tracks;
      await this.pull(true);
      await this.loadTracks();
      this.pullTimer = setInterval(() => this.pull(false), 60000); // resynchronisation périodique
    } catch (e) { /* pas de serveur : mode local, rien à faire */ }
    updateStorageBadge();
  },

  async pull(adopt) {
    if (!this.on) return;
    try {
      const res = await fetch("api/state", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const remote = data && data.state;
      if (!remote) { this.push(); return; }   // serveur vide : envoyer l'état local
      const merged = mergeStates(state, remote);
      merged.updatedAt = Math.max(state.updatedAt || 0, remote.updatedAt || 0);
      const same = JSON.stringify(sortForCompare(merged)) === JSON.stringify(sortForCompare(state));
      if (!same) {
        state = merged;
        normalizeState();
        save(); // localStorage + renvoi vers le serveur
        checkLock();
        const view = document.querySelector("nav#tabs button.active");
        renderView(view ? view.dataset.view : "today");
      }
      this.loadTracks();
      slimOldTracks();
    } catch (e) { /* serveur momentanément injoignable : on reste en local */ }
  },

  push() {
    if (!this.on) return;
    clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => {
      let payload = state;
      if (this.tracks)
        payload = Object.assign({}, state, {
          runs: state.runs.map(r => (r.trackRef && r.points) ? Object.assign({}, r, { points: null }) : r)
        });
      let body = null;
      try { body = JSON.stringify(payload); } catch (e) { }
      fetch("api/state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: body
      }).then(res => {
        if (!res.ok && !this.pushWarned) {
          this.pushWarned = true;
          toast("Synchronisation impossible (état trop volumineux ?) — les données restent sur cet appareil.");
        }
      }).catch(() => {});
    }, 800);
  }
};

/* fusion de deux états sans perte : cochages = union, sorties/chaussures = par id
   (l'état le plus récent gagne pour un même enregistrement). Chaque champ requis
   garde une valeur de repli : un état partiel (ancienne version, édition manuelle)
   ne doit jamais produire un état incomplet. */
function mergeStates(a, b) {
  const ta = a.updatedAt || 0, tb = b.updatedAt || 0;
  const newer = tb >= ta ? b : a;
  const older = newer === b ? a : b;
  const out = {
    start: newer.start || older.start || DEFAULT_START,
    mistral: newer.mistral || older.mistral || { key: "", model: "mistral-small-latest", url: "https://api.mistral.ai" },
    password: newer.password !== undefined ? newer.password : older.password,
    lastShoeId: newer.lastShoeId != null ? newer.lastShoeId : (older.lastShoeId != null ? older.lastShoeId : null),
    lastWeekView: newer.lastWeekView != null ? newer.lastWeekView : older.lastWeekView,
    updatedAt: Math.max(ta, tb)
  };
  out.done = {};
  Object.keys(a.done || {}).forEach(k => { out.done[k] = true; });
  Object.keys(b.done || {}).forEach(k => { out.done[k] = true; });
  out.hidden = {};
  Object.keys(a.hidden || {}).forEach(k => { if (a.hidden[k]) out.hidden[k] = true; });
  Object.keys(b.hidden || {}).forEach(k => { if (b.hidden[k]) out.hidden[k] = true; });
  out.runs = mergeById(a.runs, b.runs, newer === b);
  out.shoes = mergeById(a.shoes, b.shoes, newer === b);
  out.extra = mergeById(a.extra, b.extra, newer === b);
  out.custom = mergeById(a.custom, b.custom, newer === b);
  out.timers = Object.assign({}, older.timers || {}, newer.timers || {});
  out.profile = newer.profile || older.profile || null;
  out.ui = newer.ui || older.ui || { theme: "dark", font: 0 };
  out.loads = mergeByKey(a.loads, b.loads, newer === b);
  out.notes = mergeByKey(a.notes, b.notes, newer === b);
  out.moves = Object.assign({}, older.moves || {}, newer.moves || {});
  out.daily = {};
  const allDays = new Set([].concat(Object.keys(a.daily || {}), Object.keys(b.daily || {})));
  allDays.forEach(d => {
    const o = {};
    Object.keys((a.daily || {})[d] || {}).forEach(k => { if ((a.daily || {})[d][k]) o[k] = true; });
    Object.keys((b.daily || {})[d] || {}).forEach(k => { if ((b.daily || {})[d][k]) o[k] = true; });
    if (Object.keys(o).length) out.daily[d] = o;
  });
  out.seq = Math.max(a.seq || 1, b.seq || 1);
  out.chat = (newer.chat || []).slice(-60);
  return out;
}
function mergeById(listA, listB, bWins) {
  const map = new Map();
  (listA || []).forEach(x => map.set(x.id, { rec: x, fromB: false }));
  (listB || []).forEach(x => {
    const prev = map.get(x.id);
    if (!prev) map.set(x.id, { rec: x, fromB: true });
    else if (bWins) map.set(x.id, { rec: x, fromB: true });
  });
  return Array.from(map.values()).map(v => v.rec).sort((x, y) => x.id - y.id);
}
/* fusion clé/valeur sans perte : la valeur la plus récente (état b si plus récent) gagne par clé */
function mergeByKey(objA, objB, bWins) {
  const out = {};
  Object.keys(objA || {}).forEach(k => { out[k] = objA[k]; });
  Object.keys(objB || {}).forEach(k => { if (bWins || !(k in out)) out[k] = objB[k]; });
  return out;
}
function sortForCompare(st) {
  const c = Object.assign({}, st);
  c.done = {};
  Object.keys(st.done || {}).sort().forEach(k => { c.done[k] = true; });
  c.hidden = {};
  Object.keys(st.hidden || {}).sort().forEach(k => { c.hidden[k] = st.hidden[k]; });
  c.moves = {};
  Object.keys(st.moves || {}).sort().forEach(k => { c.moves[k] = st.moves[k]; });
  c.runs = (st.runs || []).slice().sort((x, y) => x.id - y.id);
  c.shoes = (st.shoes || []).slice().sort((x, y) => x.id - y.id);
  c.extra = (st.extra || []).slice().sort((x, y) => x.id - y.id);
  c.custom = (st.custom || []).slice().sort((x, y) => x.id - y.id);
  c.timers = {};
  Object.keys(st.timers || {}).sort().forEach(k => { c.timers[k] = st.timers[k]; });
  c.daily = {};
  Object.keys(st.daily || {}).sort().forEach(k => {
    const o = {};
    Object.keys(st.daily[k]).sort().forEach(x => { o[x] = st.daily[k][x]; });
    c.daily[k] = o;
  });
  c.loads = {};
  Object.keys(st.loads || {}).sort().forEach(k => { c.loads[k] = st.loads[k]; });
  c.notes = {};
  Object.keys(st.notes || {}).sort().forEach(k => { c.notes[k] = st.notes[k]; });
  c.chat = st.chat || [];
  return c;
}
function updateStorageBadge() {
  const el = $("#storage-mode");
  if (el) el.textContent = ServerSync.on
    ? "Stockage : serveur centralisé — partagé entre appareils"
    : "Stockage : ce navigateur uniquement (localStorage)";
}

/* ================= onglets : flèche masquer/afficher ================= */
const NAV_KEY = "trainingtrail_nav_collapsed";
function applyNav() {
  const c = localStorage.getItem(NAV_KEY) === "1";
  const nav = $("nav#tabs"), btn = $("#nav-toggle");
  if (nav) nav.classList.toggle("collapsed", c);
  if (btn) { btn.textContent = c ? "\u25B8" : "\u25BE"; btn.title = c ? "Afficher les onglets" : "Masquer les onglets"; }
}
$("#nav-toggle").addEventListener("click", () => {
  localStorage.setItem(NAV_KEY, localStorage.getItem(NAV_KEY) === "1" ? "0" : "1");
  applyNav();
});

/* ================= verrouillage ================= */
const UNLOCK_KEY = "trainingtrail_unlock";
function checkLock() {
  const ov = $("#lock-modal");
  if (!ov) return;
  if (!state.password || localStorage.getItem(UNLOCK_KEY) === "1") { ov.classList.add("hidden"); return; }
  ov.classList.remove("hidden");
  setTimeout(() => { const p = $("#lock-pass"); if (p) p.focus(); }, 60);
}
function tryUnlock() {
  const p = $("#lock-pass");
  if (!p || p.value !== state.password) { toast("Mot de passe incorrect."); return; }
  if ($("#lock-remember").checked) localStorage.setItem(UNLOCK_KEY, "1");
  p.value = "";
  $("#lock-modal").classList.add("hidden");
}
$("#lock-go").addEventListener("click", tryUnlock);
$("#lock-pass").addEventListener("keydown", e => { if (e.key === "Enter") tryUnlock(); });

/* ================= démarrage ================= */
renderToday();
updateHeader();
importFromHash();
ServerSync.init();
offerResume();
checkLock();
slimOldTracks();
applyNav();
/* application installable + démarrage hors ligne (PWA) */
if ("serviceWorker" in navigator && (location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname)))
  navigator.serviceWorker.register("sw.js").catch(() => {});
