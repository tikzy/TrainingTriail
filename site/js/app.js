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
  profile: null, // profil coureur : { fcm, repos, poids, vma, vo2 } — alimente zones et coach
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
  polar: { connected: false, lastSync: null }, // montre Polar : connectée au worker (jeton côté serveur)
  polarNights: {}, // nuits Polar : { "YYYY-MM-DD": { slp:{score,dur,deep,rem,cont}, rec:{ans,hrv,br,hr,st}, load:{v,str,tol,st} } }
  convs: [],      // conversations du coach : [{ id, title, created, msgs: [{id, ts, role, content, display?}] }]
  convId: null    // conversation affichée (navigation ◀ ▶)
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
  if (!state.polar) state.polar = { connected: false, lastSync: null };
  if (!state.polarNights) state.polarNights = {};
  /* conversations du coach : chaque message reçoit un id (les anciens sans id
     gardent leur ordre en tête via des id négatifs) — la fusion inter-appareils
     se fait par id, une conversation n'est jamais écrasée par un autre appareil */
  if (!Array.isArray(state.convs)) state.convs = [];
  /* migration unique de l'ancien state.chat -> conversation « Ancienne conversation »
     (state.chat est ensuite supprimé : la migration ne se rejoue pas) */
  const legacy = normalizeMsgs(Array.isArray(state.chat) ? state.chat : []);
  if (legacy.length && !state.convs.some(c => c.id === 0))
    state.convs.push({ id: 0, title: "Ancienne conversation", created: 0, msgs: legacy });
  delete state.chat;
  state.convs.forEach(c => {
    if (!c || typeof c !== "object") return;
    c.title = c.title || "Conversation";
    c.created = c.created || 0;
    c.msgs = normalizeMsgs(Array.isArray(c.msgs) ? c.msgs : []);
  });
  state.convs = state.convs.filter(c => c && typeof c === "object").sort((x, y) => x.id - y.id);
  if (!state.convs.some(c => c.id === state.convId))
    state.convId = state.convs.length ? state.convs[state.convs.length - 1].id : null;
}
/* normalise une liste de messages : objets, id (négatifs pour les anciens,
   ordre conservé), ts. Utilisé par normalizeState et la fusion. */
function normalizeMsgs(msgs) {
  msgs.forEach((m, i) => {
    if (!m || typeof m !== "object") msgs[i] = { role: "user", content: String(m) };
    if (msgs[i].id == null) msgs[i].id = -(msgs.length - i);
    if (msgs[i].ts == null) msgs[i].ts = 0;
  });
  return msgs;
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

/* ================= navigation : onglets groupés + sous-onglets ================= */
const NAV = {
  today: { label: "Accueil", subs: [["today", "Aujourd'hui"]] },
  sessions: { label: "Sessions", subs: [["new", "Nouveau"], ["sessions", "Séances"], ["traces", "Traces"], ["stats", "Résumé"]] },
  "program-group": { label: "Programme", subs: [["summary", "Résumé"], ["semaine", "Semaine"], ["program", "Plan 29 semaines"], ["progress", "Progression"]] },
  aide: { label: "Aide", subs: [["food", "Nutrition"], ["recipes", "Recettes"], ["exercises", "Exercices"], ["conseil", "Conseils"], ["coach", "Coach IA"]] },
  params: { label: "Paramètres", subs: [["shoes", "Chaussures"], ["settings", "Réglages"]] }
};
const VIEW_GROUP = {};
Object.keys(NAV).forEach(g => NAV[g].subs.forEach(s => { VIEW_GROUP[s[0]] = g; }));
let curView = "today";
const NAV_LAST_SUB = {}; // dernier sous-onglet visité de chaque groupe
function activateView(name) {
  if (!$("#view-" + name)) name = "today";
  curView = name;
  NAV_LAST_SUB[VIEW_GROUP[name] || "today"] = name;
  const group = VIEW_GROUP[name] || "today";
  $$("nav#tabs button").forEach(b => b.classList.toggle("active", b.dataset.view === group));
  /* barre de sous-onglets (uniquement pour les groupes à plusieurs vues) */
  const st = $("#subtabs");
  if (st) {
    const subs = NAV[group].subs;
    if (subs.length > 1) {
      st.style.display = "";
      st.innerHTML = subs.map(s => '<button data-sub="' + s[0] + '"' + (s[0] === name ? ' class="active"' : "") + ">" + esc(s[1]) + "</button>").join("");
      $$("#subtabs button").forEach(b => b.addEventListener("click", () => activateView(b.dataset.sub)));
    } else { st.style.display = "none"; st.innerHTML = ""; }
  }
  $$(".view").forEach(v => v.classList.remove("active"));
  $("#view-" + name).classList.add("active");
  renderView(name);
  window.scrollTo(0, 0);
}
function showView(name) { activateView(VIEW_GROUP[name] ? name : "today"); }
/* clic sur un onglet principal : ouvre le dernier sous-onglet visité du groupe */
$$("nav#tabs button").forEach(btn => {
  btn.addEventListener("click", () => {
    const g = btn.dataset.view;
    activateView(NAV_LAST_SUB[g] || NAV[g].subs[0][0]);
  });
});


function renderView(name) {
  if (name === "today") renderToday();
  else if (name === "summary") renderSummary();
  else if (name === "semaine") renderSemaine();
  else if (name === "program") renderProgram();
  else if (name === "food") renderFood();
  else if (name === "recipes") renderRecipes();
  else if (name === "exercises") renderExercises();
  else if (name === "new") renderNew();
  else if (name === "sessions") renderSessions();
  else if (name === "traces") renderTraces();
  else if (name === "stats") renderStats();
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
    (focus.length ? '<div class="note">Bloc actuel : ' + esc(blk.name) + " — les catégories utiles maintenant sont ouvertes et marquées ci-dessous.</div>" : "");
  if (isPrepWeek(w)) html += '<div class="note plan-warnings">Semaine de course préparatoire : pars volontairement prudent (l\'allure à tenir doit sembler lente), répète exactement le matériel et le ravito du jour J, et repars de chaque ravito en moins de 2 minutes.</div>';
  TIPS.forEach(cat => {
    const hot = focus.includes(cat.cat);
    html += '<details class="shutter"' + (hot ? " open" : "") + '>' +
      '<summary>' + esc(cat.cat) + (hot ? ' <span class="badge light">utile maintenant</span>' : "") + "</summary>" +
      '<div class="tip-list">' + cat.tips.map(t => '<div class="tip">' + esc(t) + "</div>").join("") + "</div></details>";
  });
  $("#view-conseil").innerHTML = html;
}

/* ================= vue : programme — résumé ================= */
function renderSummary() {
  const w = currentWeek(), blk = blockOf(w);
  const j = Math.max(0, daysBetween(isoDate(new Date()), RACE.date));
  let html = "<h2>Programme — résumé</h2>" +
    '<div class="hero"><div><div class="hero-date">' + esc(RACE.name) + " — " + RACE.dist + " km · " + RACE.dplus + " m D+</div>" +
    "<h2>J−" + j + " · Semaine " + w + " — " + esc(blk.name) + "</h2>" +
    '<div class="muted">' + esc(RACE.date + " · " + RACE.city) + " · 29 semaines · 5 blocs · " + esc(RACE.note) + "</div></div>" +
    '<div class="hero-weekbar">' + weekBar(w) + "</div></div>";
  /* avance globale */
  const plan = totalPlannedMin(), done = totalRealizedMin();
  const km = state.runs.reduce((s, r) => s + (r.dist || 0), 0);
  const dp = state.runs.reduce((s, r) => s + (r.dplus || 0), 0);
  html += '<div class="stat-cards">' +
    '<div class="stat"><span>' + Math.round(100 * done / Math.max(1, plan)) + ' %</span><label>programme réalisé (' + fmtHours(done) + " / " + fmtHours(plan) + " h)</label></div>" +
    '<div class="stat"><span>' + km.toFixed(0).replace(".", ",") + '</span><label>km enregistrés</label></div>' +
    '<div class="stat"><span>' + dp + '</span><label>m D+ enregistrés</label></div>' +
    '<div class="stat"><span>' + state.runs.length + '</span><label>sorties</label></div>' +
    "</div>";
  /* les 5 blocs */
  html += "<h3>Les 5 blocs du plan</h3><div class='day-card'>";
  BLOCKS.forEach(b => {
    const weeks = WEEKS.filter(wk => blockOf(wk.n).name === b.name);
    if (!weeks.length) return;
    const nums = weeks.map(wk => wk.n);
    const inBlock = w >= nums[0] && w <= nums[nums.length - 1];
    const bDone = weeks.reduce((s, wk) => s + doneMinutes(wk.n), 0);
    const bPlan = weeks.reduce((s, wk) => s + plannedMinutes(wk.n), 0);
    html += '<div class="block-row' + (inBlock ? " cur" : "") + '">' +
      '<span class="block-dot" style="background:' + b.color + '"></span>' +
      '<div><b>' + esc(b.name) + "</b> — S" + nums[0] + " à S" + nums[nums.length - 1] +
      ' <span class="muted">· ' + fmtHours(bPlan) + " h planifiées · " + Math.round(100 * bDone / Math.max(1, bPlan)) + " % réalisés</span>" +
      (inBlock ? ' <span class="badge light">en cours</span>' : "") +
      (b.desc ? '<div class="muted small">' + esc(b.desc) + "</div>" : "") +
      "</div></div>";
  });
  html += "</div>";
  html += '<div class="note">' + esc("Progression 3+1 : les semaines allégées sont S4, S8, S12, S16, S20, S24 — on ne les charge jamais. Affûtage S26-S29 (affûtage rapide de Koop) : jamais de charge non plus.") + "</div>";
  $("#view-summary").innerHTML = html;
}

/* ================= vue : nutrition (feuille manger / éviter) ================= */
function renderFood() {
  let html = "<h2>Nutrition — quoi manger, quoi éviter</h2>" +
    '<div class="muted small">Synthèse pratique pour la préparation trail : récupération, acidité musculaire, crampes, tendons. Régime majoritairement végétarien et sobre en carbone. Les recettes prêtes à cuisiner sont dans le sous-onglet Recettes.</div>';
  FOOD_SHEET.forEach(sec => {
    html += '<div class="food-sheet"><h3>' + esc(sec.cat) + "</h3>" +
      '<div class="food-cols">' +
      '<div class="food-col good"><h4>✓ À privilégier</h4><ul>' + sec.good.map(x => "<li>" + esc(x) + "</li>").join("") + "</ul></div>" +
      '<div class="food-col bad"><h4>✕ À limiter / éviter</h4><ul>' + sec.bad.map(x => "<li>" + esc(x) + "</li>").join("") + "</ul></div>" +
      "</div>" +
      '<div class="food-why">' + esc(sec.why) + "</div></div>";
  });
  html += "<h3>Les 5 règles d'or</h3><div class='tip-list'>" +
    NUTRITION_TIPS.map(t => '<div class="tip">' + esc(t) + "</div>").join("") + "</div>";
  $("#view-food").innerHTML = html;
}

/* ================= vue : recettes ================= */
let recipeCat = "renfort";
function renderRecipes() {
  let html = "<h2>Recettes du coureur trail</h2>" +
    '<div class="muted small">Végétariennes et sobres en carbone : légumineuses, céréales complètes, fruits de saison et séchés. Chaque recette indique quand la manger et ce qu\'elle apporte. Règle d\'or : tout doit être testé à l\'entraînement, rien de nouveau le jour J.</div>' +
    '<div class="muted small">Sources des recettes de terrain : <a href="https://www.nicolas-aubineau.com/compote-energetique-sport/" target="_blank" rel="noopener">Nicolas Aubineau</a> (diététicien) · <a href="https://mulebar.com/blogs/news/compote-energetique-salee-maison" target="_blank" rel="noopener">Mulebar</a> · <a href="https://raidlight.com/en/blogs/conseils-guides-plans-entrainement/nutrition-sportive-en-trail-fait-maison" target="_blank" rel="noopener">Raidlight</a> · <a href="https://reference-trail.fr/barre-energetique-maison-pour-le-trail-ma-recette-delicieuse/" target="_blank" rel="noopener">reference-trail.fr</a> · <a href="https://www2.u-trail.com/barre-energetique26/" target="_blank" rel="noopener">u-trail</a> · <a href="https://www2.u-trail.com/faire-du-trail-quand-on-est-vegetarien-nos-conseils-pratiques/" target="_blank" rel="noopener">u-trail végétarien</a> · <a href="https://menu-vegetarien.com/sport-alimentation/epreuve-endurance-repas-timing-vegetarien-vegan/" target="_blank" rel="noopener">menu-vegetarien.com</a>.</div>';
  html += '<div class="recipe-cats">' + RECIPE_CATS.map(c =>
    '<button class="chip' + (c.id === recipeCat ? " active" : "") + '" data-rcat="' + c.id + '">' + esc(c.label) + "</button>").join("") + "</div>";
  const cat = RECIPE_CATS.find(c => c.id === recipeCat) || RECIPE_CATS[0];
  html += '<div class="muted small">' + esc(cat.label + " — " + cat.when) + "</div>";
  RECIPES.filter(r => r.cat === cat.id).forEach(r => {
    html += '<details class="recipe-card shutter">' +
      '<summary><b>' + esc(r.title) + "</b>" +
      '<span><span class="badge light">' + esc(r.time) + "</span>" +
      (r.src && r.src !== "—" ? ' <span class="badge light">Source : ' + esc(r.src) + "</span>" : "") + "</span></summary>" +
      '<div class="muted small">' + esc(r.when) + "</div>" +
      '<div class="recipe-cols">' +
      '<div class="recipe-ing"><b>Ingrédients</b><ul>' + r.ing.map(x => "<li>" + esc(x) + "</li>").join("") + "</ul></div>" +
      '<div class="recipe-steps"><b>Préparation</b><ol>' + r.steps.map(x => "<li>" + esc(x) + "</li>").join("") + "</ol></div>" +
      "</div>" +
      '<div class="tip">' + esc(r.note) + "</div>" +
      "</details>";
  });
  $("#view-recipes").innerHTML = html;
  $$("button[data-rcat]").forEach(b => b.addEventListener("click", () => { recipeCat = b.dataset.rcat; renderRecipes(); }));
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
    showView("new");
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
  renderView(curView);
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
/* ---- récupération Polar : libellés et carte (sommeil, recharge ANS/VFC, charge) ---- */
function frNum(x, dec) {
  return x == null ? "—" : (dec ? x.toFixed(dec) : String(Math.round(x))).replace(".", ",");
}
function polarRechargeLabel(st) {
  if (st == null) return null;
  return st >= 5 ? "bien récupéré" : st >= 4 ? "récupération correcte"
    : st >= 3 ? "récupération moyenne" : "récupération compromise";
}
function polarLoadLabel(st) {
  if (!st) return "—";
  if (st.indexOf("STRAINED") >= 0) return "en surcharge";
  if (st.indexOf("BALANCED") >= 0) return "équilibrée";
  if (st.indexOf("RECOVERY") >= 0) return "en dessous de la moyenne";
  return "—";
}
function polarRecoveryHTML() {
  const nights = state.polarNights || {};
  const dates = Object.keys(nights).sort();
  if (!dates.length) return "";
  const last = dates[dates.length - 1];
  const n = nights[last];
  const rec = n.rec, slp = n.slp;
  const yesterday = Object.keys(nights).filter(d => d < last && nights[d].load).pop();
  const yLoad = yesterday ? nights[yesterday].load : null;
  let html = '<div class="day-card polar-card">' +
    '<div class="day-head"><span>Récupération — nuit du ' + fmtDateShort(parseDate(last)) + "</span>" +
    (state.polar.connected ? "" : ' <span class="badge light">Polar déconnectée</span>') + "</div>";
  if (rec && rec.st != null) {
    const good = rec.st >= 4;
    html += '<div class="polar-charge ' + (rec.st >= 5 ? "ok" : rec.st >= 3 ? "mid" : "low") + '">' +
      (good ? "Bien récupéré" : rec.st >= 3 ? "Récupération moyenne" : "Récupération compromise") +
      (rec.ans != null ? " · recharge ANS " + (rec.ans >= 0 ? "+" : "") + frNum(rec.ans, 1) : "") + "</div>";
  }
  html += '<div class="stat-cards polar-stats">' +
    (slp && (slp.dur || slp.score != null)
      ? '<div class="stat"><span>' + (slp.dur ? fmtHours(slp.dur) + " h" : "—") + (slp.score ? " · " + slp.score + "/100" : "") + '</span><label>sommeil' +
        (slp.deep != null ? " (profond " + fmtHours(slp.deep) + " h" + (slp.rem != null ? ", REM " + fmtHours(slp.rem) + " h" : "") + ")" : "") + "</label></div>"
      : "") +
    (rec && (rec.hrv != null || rec.br != null)
      ? '<div class="stat"><span>' + (rec.hrv != null ? frNum(rec.hrv) + " ms" : "—") + (rec.br != null ? " · " + frNum(rec.br, 1) + "/min" : "") +
        '</span><label>VFC RMSSD nocturne · respiration' + (rec.hr != null ? " · FC " + rec.hr + " bpm" : "") + "</label></div>"
      : "") +
    (yLoad
      ? '<div class="stat"><span>' + frNum(yLoad.v) + ' · ' + polarLoadLabel(yLoad.st) + "</span><label>charge cardio du " +
        fmtDateShort(parseDate(yesterday)) + (yLoad.str != null && yLoad.tol != null ? " (strain " + frNum(yLoad.str) + " / tolérance " + frNum(yLoad.tol) + ")" : "") + "</label></div>"
      : "") +
    "</div>";
  /* mini-tendance : 7 dernières nuits (barre = recharge ANS, texte = sommeil) */
  const last7 = dates.slice(-7);
  if (last7.length >= 3) {
    html += '<div class="polar-trend">';
    last7.forEach(d => {
      const nn = nights[d], ans = nn.rec && nn.rec.ans != null ? nn.rec.ans : null;
      const h = ans == null ? 0 : Math.round(Math.min(100, Math.max(4, 50 + ans * 5)));
      const cls = ans == null ? "na" : ans >= 0 ? "ok" : ans >= -3 ? "mid" : "low";
      html += '<div class="polar-day"><div class="polar-bar ' + cls + '" style="height:' + h + '%"></div>' +
        '<label>' + fmtDateShort(parseDate(d)).split("/")[0] + (nn.slp && nn.slp.score ? "<br>" + nn.slp.score : "") + "</label></div>";
    });
    html += "</div>";
  }
  html += '<div class="muted small">Polar : recharge ANS (vert = positive) · sous chaque barre : jour et score de sommeil. ' +
    "Une récupération compromise deux nuits de suite = privilégier les séances faciles, un repos non prévu reste un bon choix.</div>";
  return html + "</div>";
}

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

  const recHTML = polarRecoveryHTML();
  if (recHTML) html += recHTML;

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
  if (rec) rec.addEventListener("click", () => { showView("traces"); setTimeout(startRecording, 80); });
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
  html += '<div class="week-grid big hscroll">';
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
/* zones ciblées : filtre les exercices par objectif (tendon d'Achille,
   essuie-glace, cheville…). Le rapprochement se fait sur les muscles cités. */
const EXO_ZONES = [
  { id: "achille", label: "Mollets · tendon d'Achille", kw: ["mollet", "achille", "sural", "talon"] },
  { id: "essuie", label: "Fessiers · essuie-glace (TFL)", kw: ["fessier", "essuie-glace", "tfl", "gluteus", "fess"] },
  { id: "cheville", label: "Cheville · proprioception", kw: ["cheville", "proprio", "entorse", "stabilisateur", "appuis"] },
  { id: "tronc", label: "Tronc · gainage", kw: ["gainage", "abdomin", "tronc", "oblique", "lombaire", "sangle", "pelvien"] },
  { id: "jambe", label: "Jambes · chaîne postérieure", kw: ["quadriceps", "ischio", "jambe", "postérieur", "genou", "cuisse", "psoas", "hanche", "mollets"] },
  { id: "plio", label: "Pliométrie · puissance", kw: ["pliom", "puissance", "saut", "explosiv", "détente", "réactivité"] }
];
let exoZone = "tout";
function exoMatchesZone(ex, zoneId) {
  if (zoneId === "tout") return true;
  const z = EXO_ZONES.find(x => x.id === zoneId);
  if (!z) return true;
  const hay = ((ex.muscles || "") + " " + (ex.name || "")).toLowerCase();
  return z.kw.some(k => hay.indexOf(k) >= 0);
}
function renderExercises() {
  const sections = [
    { r: "A", title: "RM-A — Jambes et chaîne postérieure (lundi matin, 30-35')",
      subtitle: "Fais chaque répétition lentement : quelques répétitions propres valent mieux qu'une série bâclée. Lestez en bloc 2 quand 20 répétitions sont faciles." },
    { r: "B", title: "RM-B — Tronc, fessiers et cheville (jeudi matin, 25-30')",
      subtitle: "La routine anti-essuie-glace et anti-entorse. À faire deux fois par semaine, sans exception, toute l'année." },
    { r: "S", title: "Corde à sauter — pliométrie douce, cheville et coordination (10-15')",
      subtitle: "Règle ta corde : poignées à hauteur d'aisselles en marchant sur le milieu de la corde. Sur sol souple, toujours sur l'avant-pied, genoux souples." }
  ];
  let html = "<h2>Exercices</h2>" +
    '<div class="recipe-cats">' +
    '<button class="chip' + (exoZone === "tout" ? " active" : "") + '" data-exozone="tout">Tous</button>' +
    EXO_ZONES.map(z => '<button class="chip' + (exoZone === z.id ? " active" : "") + '" data-exozone="' + z.id + '">' + esc(z.label) + "</button>").join("") +
    "</div>";
  if (exoZone !== "tout") {
    const n = EXERCISES.filter(e => exoMatchesZone(e, exoZone)).length;
    html += '<div class="muted small">' + n + " exercice" + (n > 1 ? "s" : "") + " pour : " + esc((EXO_ZONES.find(z => z.id === exoZone) || {}).label || "") + ".</div>";
  }
  sections.forEach(sec => {
    const list = EXERCISES.filter(e => e.routine === sec.r && exoMatchesZone(e, exoZone));
    if (!list.length) return; // section sans exercice correspondant au filtre
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
  html += '<details class="shutter"><summary>RM-C — Pliométrie et gammes (S10, S14, 20\' après 10\' d\'échauffement)</summary>' +
    '<div class="note">' + RM_C_DRILLS.map(esc).join("<br>") + "<br>Progressif, sur herbe ou sol souple — jamais sur sol dur si vous pesez plus de 85 kg ou si la cheville parle.</div></details>";
  html += '<details class="shutter"><summary>Gammes de course (1-2 fois par semaine)</summary>' +
    '<div class="note">Après 10\' d\'échauffement, 2 à 3 fois 20\'\' de chaque : montées de genoux, talons-fesses, foulées bondissantes, puis 3-4 lignes droites progressives. Elles économisent la cheville et le tendon.</div></details>';
  html += '<details class="shutter"><summary>Nutrition de l\'effort</summary>' +
    '<div class="note">' + NUTRITION_TIPS.map(esc).join("<br>") + "</div></details>";
  $("#view-exercises").innerHTML = html;

  $$("button[data-exo]").forEach(btn => btn.addEventListener("click", () => openExo(btn.dataset.exo)));
  $$("button[data-exozone]").forEach(btn => btn.addEventListener("click", () => { exoZone = btn.dataset.exozone; renderExercises(); }));
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
    '<div class="postexo-grid">' +
    '<div class="postexo-sec"><h4>Tout de suite</h4><ul>' + POSTEXO.now.map(x => "<li>" + esc(x) + "</li>").join("") + "</ul></div>" +
    '<div class="postexo-sec"><h4>Étirements & automassage</h4><ul>' + POSTEXO.stretch.map(x => "<li>" + esc(x) + "</li>").join("") + "</ul></div>" +
    '<div class="postexo-sec"><h4>Manger : quoi et quand</h4><ul>' + POSTEXO.food.map(x => "<li>" + esc(x) + "</li>").join("") + "</ul></div>" +
    "</div>" +
    '<div class="note plan-warnings">' + esc(POSTEXO.warn) + "</div></div>";
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
    /* après un effort : repos entre répétitions, puis repos entre séries, puis terminé */
    if (Timer.rep < c.reps) {
      Timer.rep++;
      if (c.rest > 0) startPhase("rest", c.rest); else startPhase("work", c.work);
    } else if (Timer.set < c.sets) {
      Timer.set++; Timer.rep = 1;
      const sr = c.setrest || c.rest;
      if (sr > 0) startPhase("rest", sr); else startPhase("work", c.work);
    } else finishTimer();
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
  showPostExoTips(Timer.label);
}
/* ---- popup conseils post-exercice : récupération, étirements, alimentation ---- */
const POSTEXO_MUTE_KEY = "trainingtrail_postexo_mute";
function showPostExoTips(label) {
  if (localStorage.getItem(POSTEXO_MUTE_KEY) === "1") return;
  $("#postexo-title").textContent = (label ? label + " — terminé !" : "Exercice terminé — bien joué !");
  $("#postexo-body").innerHTML =
    '<div class="postexo-grid">' +
    '<div class="postexo-sec"><h4>Tout de suite</h4><ul>' + POSTEXO.now.map(x => "<li>" + esc(x) + "</li>").join("") + "</ul></div>" +
    '<div class="postexo-sec"><h4>Étirements & automassage</h4><ul>' + POSTEXO.stretch.map(x => "<li>" + esc(x) + "</li>").join("") + "</ul></div>" +
    '<div class="postexo-sec"><h4>Manger : quoi et quand</h4><ul>' + POSTEXO.food.map(x => "<li>" + esc(x) + "</li>").join("") + "</ul></div>" +
    "</div>" +
    '<div class="note plan-warnings">' + esc(POSTEXO.warn) + "</div>";
  $("#postexo-mute").checked = false;
  $("#postexo-modal").classList.remove("hidden");
}
function closePostExo() {
  if ($("#postexo-mute").checked) localStorage.setItem(POSTEXO_MUTE_KEY, "1");
  $("#postexo-modal").classList.add("hidden");
}
$("#postexo-close").addEventListener("click", closePostExo);
$("#postexo-ok").addEventListener("click", closePostExo);
function paintTimer(phase, remain, round) {
  if (phase) $("#timer-phase").textContent = phase;
  if (round) $("#timer-round").textContent = round;
  $("#timer-clock").textContent = fmtDur(remain);
  $("#timer-clock").className = "timer-clock " + (Timer.phase === "work" ? "t-work" : Timer.phase === "rest" ? "t-rest" : "");
}
function paintTimerPhase() {
  const names = { work: "Effort", prep: "Préparation", idle: "Prêt", chrono: "Série en cours — chrono", ready: "Série suivante : ▶ pour la démarrer, ou « Série faite »", over: "Terminé" };
  names.rest = Timer.mode === "interval" && Timer.rep > 1 ? "Récupération (entre répétitions)" : "Récupération (entre séries)";
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

/* ================= vue : sessions (onglet Sessions) =================
   Quatre sous-onglets : Nouveau (créer une séance), Séances (l'historique,
   filtrable par type), Traces (enregistrement GPS en direct), Résumé (FC,
   km, VO2max). */
let stoppedTrace = null;     // trace arrêtée en attente (après « Stop »)
let sessionFilter = "tout";  // filtre par type de la liste des séances

/* codes de séance créables à la main : course + renforcement + autres */
const SESSION_CODES = RUN_CODES.concat(["RMA", "RMB", "RMC", "GAING", "CORDE", "PROP", "MAS", "NAT", "YOGA", "V"]);

/* ---- Nouveau : créer une séance (course, renforcement, vélo…) ---- */
function renderNew() {
  const w = currentWeek(), idx = todayIdx(), week = effWeek(w);
  const runsToday = week.days[idx].filter(x => RUN_CODES.includes(x.it.c)).map(x => x.it);
  let html = "<h2>Nouvelle séance</h2>";

  /* partir direct : enregistrer une trace GPS en direct, ou noter à la main */
  html += '<div class="rec-launch"><div class="row-actions">';
  if (Recorder.active || stoppedTrace)
    html += '<button class="btn" id="new-rec-view">' + (Recorder.active ? "Enregistrement GPS en cours — voir" : "Trace GPS prête — la noter") + "</button>";
  else {
    html += '<button class="btn primary" id="new-rec-start">Démarrer l\'enregistrement GPS</button>';
  }
  html += "</div>" +
    '<div class="muted small">L\'enregistrement GPS trace la sortie en direct (carte, allure, D+), continue si tu changes d\'onglet, puis pré-remplit le formulaire ci-dessous. Sans GPS : note la séance à la main ou importe un fichier GPX.</div></div>';

  /* séance proposée aujourd'hui (rappel du programme) */
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
    html += '<div class="muted">Pas de course programmée aujourd\'hui (récupération, vélo ou renforcement).</div>';
  }
  html += "</div>";

  /* séances guidées de renforcement : créent et cochent la séance */
  html += '<h3>Séance guidée de renforcement</h3>' +
    '<div class="row-actions strength-launch">' +
    '<button class="btn" data-routine="A">RM-A · Jambes & chaîne post. (30-35\')</button>' +
    '<button class="btn" data-routine="B">RM-B · Tronc, fessiers & cheville (25-30\')</button>' +
    '<button class="btn" data-routine="C">RM-C · Pliométrie (20\')</button>' +
    '<button class="btn" data-routine="S">Corde à sauter (10-15\')</button>' +
    '<button class="btn" data-routine="G">Gainage léger</button></div>' +
    '<div class="muted small" style="margin-top:-6px">La séance se déroule exercice par exercice, puis est cochée dans le programme (premier créneau libre de la semaine).</div>';

  /* formulaire manuel : tout type de séance */
  html += '<div class="row-actions">' +
    '<label class="btn file-btn">Importer un GPX <input type="file" id="rf-gpx" accept=".gpx" multiple></label></div>';
  html += '<div class="run-form" id="rf-box">' +
    '<h3>Séance manuelle</h3>' +
    '<div class="form-grid">' +
    '<label>Date <input type="date" id="rf-date" value="' + isoDate(new Date()) + '"></label>' +
    '<label>Type de séance <select id="rf-code">' +
      SESSION_CODES.map(c => '<option value="' + c + '">' + esc(TYPES[c].label) + "</option>").join("") +
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
    '<div class="row-actions"><button class="btn primary" id="rf-save">Enregistrer la séance</button>' +
    '<input type="hidden" id="rf-points"></div>' +
    '<div class="muted small">Rappel : on ne rattrape jamais une séance manquée. Priorité si la semaine est impossible : 1) sortie longue, 2) qualité du mercredi, 3) RM-B, 4) le reste.</div>' +
    "</div>";

  $("#view-new").innerHTML = html;
  bindNewEvents();
}

/* ---- Séances : l'historique complet, filtrable par type ---- */
function sessionTypes() {
  const codes = {};
  state.runs.forEach(r => { codes[r.code] = (codes[r.code] || 0) + 1; });
  return Object.keys(codes).sort((a, b) => codes[b] - codes[a]);
}
function renderSessions() {
  let html = "<h2>Mes séances</h2>";
  const types = sessionTypes();
  const all = state.runs.slice().sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  /* filtre par type de séance (course, renforcement, corde, vélo…) */
  html += '<div class="recipe-cats">' +
    '<button class="chip' + (sessionFilter === "tout" ? " active" : "") + '" data-sfilter="tout">Tous (' + all.length + ")</button>" +
    types.map(c => '<button class="chip' + (sessionFilter === c ? " active" : "") + '" data-sfilter="' + c + '">' +
      esc((TYPES[c] || { label: c }).label) + " (" + state.runs.filter(r => r.code === c).length + ")</button>").join("") +
    "</div>";
  const sorted = sessionFilter === "tout" ? all : all.filter(r => r.code === sessionFilter);
  if (!sorted.length) {
    html += '<div class="muted">Aucune séance enregistrée pour l\'instant. Crée-la dans « Nouveau », ou laisse la montre Polar la synchroniser (elle apparaît alors ici automatiquement).</div>';
  } else {
    const km = sorted.reduce((s, r) => s + (r.dist || 0), 0);
    const dur = sorted.reduce((s, r) => s + (r.dur || 0), 0);
    const dp = sorted.reduce((s, r) => s + (r.dplus || 0), 0);
    html += '<div class="run-sheet-total muted small">' + sorted.length + " séance" + (sorted.length > 1 ? "s" : "") + " · " +
      km.toFixed(1).replace(".", ",") + " km · " + fmtHours(dur) + " h · " + dp + " m D+</div>";
    html += '<div class="table-wrap"><table class="run-sheet"><thead><tr>' +
      "<th>Date</th><th>Type</th><th>km</th><th>Durée</th><th>D+</th><th>Allure</th><th>Sensations</th><th></th>" +
      "</tr></thead><tbody>";
    sorted.forEach(r => {
      const pace = r.dist > 0 && r.dur > 0 ? Math.floor(r.dur / r.dist) + "'" + String(Math.round((r.dur / r.dist % 1) * 60)).padStart(2, "0") + '"' : "—";
      html += '<tr class="run-row" data-focus-run="' + r.id + '" title="Ouvrir la fiche de la séance">' +
        "<td>" + esc(fmtDateShort(parseDate(r.date))) + "</td>" +
        "<td>" + typeChip(r.code) + "</td>" +
        "<td>" + (r.dist ? r.dist.toFixed(1).replace(".", ",") : "—") + "</td>" +
        "<td>" + (r.dur ? fmtDur(r.dur * 60) : "—") + "</td>" +
        "<td>" + (r.dplus || 0) + "</td>" +
        "<td>" + pace + "</td>" +
        "<td>" + (r.feel ? r.feel + "/10" : "—") + "</td>" +
        '<td><button class="mini-btn" data-details="' + r.id + '">Détails</button> <button class="mini-btn" data-edit="' + r.id + '">Modifier</button></td>' +
        "</tr>";
    });
    html += "</tbody></table></div>";
  }
  html += "<h3>Détail</h3>";
  /* une fiche illisible ne doit jamais vider tout l'onglet Séances :
     chaque carte est rendue indépendamment, en repli minimal si erreur */
  sorted.forEach(r => {
    try { html += runCardHTML(r); }
    catch (e) {
      console.warn("Fiche séance " + r.id + " non affichée :", e);
      html += '<div class="run-card"><div class="run-head"><b>' + esc(fmtDateShort(parseDate(r.date))) +
        "</b> " + typeChip(r.code) + '<span class="muted small">Fiche partielle (donnée inattendue).</span></div></div>';
    }
  });
  $("#view-sessions").innerHTML = html;
  bindSessionsEvents(sorted);
}

/* ---- Traces : enregistrement GPS en direct + visionneuse (carte + courbes) ---- */
function renderTraces() {
  /* une trace est ouverte : la visionneuse remplace la liste (et l'enregistreur,
     dont la bannière flottante reste disponible sur toutes les vues) */
  if (openTraceId) { renderTraceViewer(openTraceId); return; }
  let html = "<h2>Traces GPS</h2>";
  html += '<div class="recorder" id="recorder">';
  if (Recorder.active) {
    html += '<h3 id="rec-state">Enregistrement GPS en cours</h3>' +
      '<div class="rec-stats">' +
      '<div class="rec-stat"><span id="rec-time">00:00:00</span><label>Durée</label></div>' +
      '<div class="rec-stat"><span id="rec-dist">0,00 km</span><label>Distance</label></div>' +
      '<div class="rec-stat"><span id="rec-speed">0,0 km/h</span><label>Vitesse</label></div>' +
      '<div class="rec-stat"><span id="rec-avgm">0,0 km/h</span><label>Moy. en mouvement</label></div>' +
      '<div class="rec-stat"><span id="rec-dplus">0 m</span><label>D+ cumulé</label></div>' +
      '<div class="rec-stat"><span id="rec-ele">—</span><label>Altitude</label></div>' +
      '<div class="rec-stat"><span id="rec-acc">—</span><label>Précision GPS</label></div>' +
      "</div>" +
      '<div class="row-actions"><button class="btn" id="rec-cancel">Annuler</button>' +
      '<button class="btn" id="rec-pause">' + (Recorder.paused ? "Reprendre" : "Pause") + '</button>' +
      '<button class="btn danger" id="rec-stop">Stop</button></div>' +
      '<div class="muted small" id="rec-note">Enregistrement en cours… Tu peux changer d\'onglet ou de page : la trace continue et est sauvegardée.</div>';
  } else if (stoppedTrace) {
    const stp = stoppedTrace, sstats = Geo.stats(stp.pts), el = Geo.elevation(stp.pts);
    html += '<h3 id="rec-state">Trace enregistrée — à noter ou supprimer</h3>' +
      '<div class="rec-stats">' +
      stat(sstats.dist.toFixed(2).replace(".", ",") + " km", "distance") +
      stat(fmtDur(sstats.dur), "durée") +
      stat(Math.round(el.up) + " m", "D+") +
      stat(String(stp.pts.length), "points GPS") +
      "</div>" +
      '<div class="row-actions"><button class="btn primary" id="rec-finish">Terminer et noter la séance</button>' +
      '<button class="btn danger" id="rec-discard">Supprimer la séance</button></div>' +
      '<div class="muted small" id="rec-note">La trace est prête : « Terminer et noter la séance » pré-remplit le formulaire de l\'onglet Nouveau (chaussures, douleurs, sensations) ; « Supprimer » jette la trace.</div>';
  } else {
    html += '<div class="row-actions"><button class="btn primary" id="rec-start">Démarrer l\'enregistrement</button></div>' +
      '<div class="muted small" id="rec-note">Nécessite l\'autorisation de géolocalisation. La trace est filtrée (anti-dérive, anti-sauts) et l\'enregistrement continue si tu changes d\'onglet ou de page ; en cas de fermeture, il est proposé de le reprendre au retour.</div>';
  }
  html += "</div>";
  html += tracesListHTML();
  $("#view-traces").innerHTML = html;
  bindTracesEvents();
}

/* liste des traces enregistrées (points dans l'état ou rangés dans R2) */
function tracesListHTML() {
  const traces = state.runs
    .filter(r => (r.points && r.points.length > 1) || r.trackRef)
    .sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.id - a.id);
  let html = '<h3 id="traces-list-title">Mes traces</h3>';
  if (!traces.length) {
    html += '<div class="muted">Aucune trace pour l\'instant. Démarre l\'enregistrement ci-dessus ou enregistre une séance avec la montre Polar : la trace apparaîtra ici, visualisable sur carte et en courbes.</div>';
  } else {
  html += '<div class="trace-list">';
  traces.forEach(r => {
    const s = r.points && r.points.length > 1 ? Geo.stats(r.points) : null;
    const dist = r.dist != null ? r.dist : (s ? s.dist : null);
    const dur = r.dur != null ? r.dur : (s ? s.dur / 60 : null);
    const dplus = r.dplus != null ? r.dplus : (s ? s.dplus : null);
    html += '<button class="trace-item" data-trace="' + r.id + '">' +
      '<span class="trace-date">' + esc(fmtDateShort(parseDate(r.date))) + "</span>" +
      typeChip(r.code) +
      '<span class="trace-meta">' +
      (dist != null ? dist.toFixed(1).replace(".", ",") + " km" : "—") + " · " +
      (dur != null ? fmtDur(dur * 60) : "—") +
      (dplus ? " · " + dplus + " m D+" : "") +
      " · " + (r.points ? r.points.length + " pts" : "R2") +
      "</span>" +
      '<span class="trace-open">Voir la trace</span></button>';
  });
  html += "</div>";
  }
  return html;
}

/* ================= visionneuse de trace =================
   Carte (fond IGN, sinon OpenStreetMap ou satellite) + courbes altitude /
   distance / vitesse, reliées par un réticule : toucher une courbe plante
   une ligne verticale et montre le point correspondant sur la carte. */
let openTraceId = null;     // id de la séance affichée dans la visionneuse
let traceMap = null;        // carte Leaflet active
let traceBase = null;       // couche de fond courante
let traceMarker = null;     // réticule sur la carte
let tracePlots = [];        // courbes [{ setIndex, clear }]
let leafletPromise = null;
const IGN_TILES = "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0" +
  "&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}" +
  "&STYLE=normal&FORMAT=image/png";

function loadLeaflet() {
  if (window.L) return Promise.resolve();
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    document.head.appendChild(css);
    const s = document.createElement("script");
    s.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    s.onload = () => resolve();
    s.onerror = () => { leafletPromise = null; reject(new Error("carte Leaflet non chargée (hors ligne ?)")); };
    document.head.appendChild(s);
  });
  return leafletPromise;
}
function destroyTraceMap() {
  if (traceMap) { try { traceMap.remove(); } catch (e) { } traceMap = null; }
  traceBase = null; traceMarker = null;
}

async function renderTraceViewer(id) {
  const run = state.runs.find(r => r.id === id);
  if (!run) { openTraceId = null; renderTraces(); return; }
  /* déjà affichée (resynchronisation, changement d'onglet) : ne pas reconstruire la carte */
  if ($("#trace-viewer") && $("#trace-map") && traceMap) return;

  let pts = run.points && run.points.length > 1 ? run.points : null;
  let loadingR2 = false;
  if (!pts && run.trackRef && ServerSync.on) {
    loadingR2 = true;
    $("#view-traces").innerHTML = '<h2>Traces GPS</h2><div class="muted">Chargement de la trace du ' +
      esc(fmtDateShort(parseDate(run.date))) + "…</div>";
    try {
      const res = await fetch("api/track?id=" + run.trackRef, { cache: "no-store" });
      if (res.ok) { run.points = JSON.parse(await res.text()); pts = run.points; }
    } catch (e) { /* reste en mode dégradé : courbes seules */ }
  }
  if (!pts) {
    $("#view-traces").innerHTML = "<h2>Traces GPS</h2>" +
      '<div class="muted">Trace indisponible (hors ligne ou supprimée du serveur).</div>' +
      '<div class="row-actions"><button class="btn" id="trace-back">← Retour aux traces</button></div>';
    bindTraceViewerEvents(run, null);
    return;
  }

  const s = Geo.stats(pts);
  let html = '<div id="trace-viewer">' +
    '<div class="row-actions trace-head"><button class="btn" id="trace-back">← Retour aux traces</button>' +
    '<b>' + esc(fmtDateShort(parseDate(run.date))) + "</b> " + typeChip(run.code) +
    (run.planned ? '<span class="muted small">' + esc(run.planned) + "</span>" : "") + "</div>" +
    '<div class="rec-stats">' +
    stat(s.dist.toFixed(2).replace(".", ","), "distance (km)") +
    stat(fmtDur(s.dur), "durée") +
    stat(Math.round(s.dplus) + " m", "D+") +
    stat(s.minEle !== Infinity && s.minEle != null ? Math.round(s.minEle) + " / " + Math.round(s.maxEle) + " m" : "—", "altitudes min / max") +
    stat(String(pts.length), "points GPS") +
    "</div>" +
    '<div class="layer-switch" id="trace-layers">' +
    '<button class="chip active" data-baselayer="ign">Carte IGN</button>' +
    '<button class="chip" data-baselayer="osm">OpenStreetMap</button>' +
    '<button class="chip" data-baselayer="sat">Satellite</button>' +
    "</div>" +
    '<div id="trace-map"><div class="muted small">Chargement de la carte…</div></div>' +
    '<div id="trace-readout" class="trace-readout muted">Touche une courbe : une ligne apparaît et le point correspondant s\'affiche sur la carte.</div>' +
    '<div id="trace-plots"></div>' +
    '<div class="row-actions"><button class="btn" id="trace-export">Exporter le GPX</button></div>' +
    "</div>";
  $("#view-traces").innerHTML = html;

  /* carte : fond IGN par défaut, repli OpenStreetMap si les tuiles ne répondent pas */
  loadLeaflet().then(() => {
    if (!$("#trace-map") || openTraceId !== run.id) return; // l'utilisateur est reparti entre-temps
    destroyTraceMap();
    const L = window.L;
    const map = L.map("trace-map", { zoomControl: true, scrollWheelZoom: false });
    const layers = {
      ign: L.tileLayer(IGN_TILES, { maxZoom: 19, attribution: "IGN · Géoplateforme" }),
      osm: L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap contributeurs" }),
      sat: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        { maxZoom: 19, attribution: "Esri · World Imagery" })
    };
    let ignErrors = 0;
    layers.ign.on("tileerror", () => {
      if (openTraceId !== run.id || ++ignErrors < 3) return;
      toast("Tuiles IGN indisponibles — fond OpenStreetMap utilisé.");
      switchBase("osm");
    });
    traceMap = map;
    function switchBase(name) {
      if (!traceMap) return;
      Object.entries(layers).forEach(([k, ly]) => { if (k === name) { if (traceBase !== ly) ly.addTo(map); } else map.removeLayer(ly); });
      traceBase = layers[name];
      $$("#trace-layers .chip").forEach(b => b.classList.toggle("active", b.dataset.baselayer === name));
    }
    traceMap.switchBase = switchBase;
    traceMap.layers = layers;
    switchBase("ign");
    const line = L.polyline(pts.map(p => [p.lat, p.lon]), { color: "#ff6b57", weight: 3, opacity: 0.9 }).addTo(map);
    L.circleMarker([pts[0].lat, pts[0].lon], { radius: 6, color: "#fff", weight: 2, fillColor: "#3fbf7f", fillOpacity: 1 })
      .addTo(map).bindTooltip("Départ");
    const last = pts[pts.length - 1];
    L.circleMarker([last.lat, last.lon], { radius: 6, color: "#fff", weight: 2, fillColor: "#e05252", fillOpacity: 1 })
      .addTo(map).bindTooltip("Arrivée");
    traceMarker = L.circleMarker([pts[0].lat, pts[0].lon],
      { radius: 8, color: "#fff", weight: 2, fillColor: "#ffd166", fillOpacity: 1, interactive: false }).addTo(map);
    map.fitBounds(line.getBounds().pad(0.15));
  }).catch(() => {
    const el = $("#trace-map");
    if (el) el.innerHTML = '<div class="muted small">Carte indisponible (Leaflet non chargé — connexion ?). Les courbes restent utilisables.</div>';
  });

  /* courbes avec réticule */
  buildTracePlots(pts, run);
  bindTraceViewerEvents(run, pts);
}

/* construit les échantillons des courbes : distance cumulée, altitude, vitesse */
function traceSamples(pts) {
  let d = 0;
  const dist = [0];
  for (let i = 1; i < pts.length; i++) {
    d += Geo.haversine(pts[i - 1], pts[i]);
    dist.push(d);
  }
  const t0 = pts[0].t != null ? pts[0].t : null;
  const timedIdx = [];
  pts.forEach((p, i) => { if (p.t != null && t0 != null) timedIdx.push(i); });
  const alt = [], kmTime = [], speed = [];
  pts.forEach((p, i) => {
    if (p.ele != null) alt.push({ x: dist[i] / 1000, y: p.ele, i });
  });
  if (t0 != null) {
    timedIdx.forEach(i => {
      kmTime.push({ x: (pts[i].t - t0) / 1000, y: dist[i] / 1000, i });
    });
    const spd = Geo.speedSeries(timedIdx.map(i => pts[i]));
    spd.forEach((s, j) => { speed.push({ x: (s.t - t0) / 1000, y: s.v, i: timedIdx[j] }); });
  }
  return { alt, kmTime, speed, dist };
}

/* une courbe interactives : aire + ligne + réticule, x horizontal en unité quelconque */
function xPlot(title, samples, opts) {
  const W = 560, H = 130, L0 = 46, R0 = 10, T0 = 16, B0 = 22;
  const div = document.createElement("div");
  div.className = "plot-block";
  if (!samples || samples.length < 2) {
    div.innerHTML = '<div class="plot-title">' + esc(title) + '</div><div class="muted small">' +
      esc(opts.empty || "Pas assez de points.") + "</div>";
    return { el: div, setIndex() { }, clear() { } };
  }
  const x0 = samples[0].x, x1 = Math.max(samples[samples.length - 1].x, x0 + 1e-6);
  let y0 = Infinity, y1 = -Infinity;
  samples.forEach(s => { y0 = Math.min(y0, s.y); y1 = Math.max(y1, s.y); });
  if (y1 - y0 < 1e-6) { y1 += 1; y0 -= 1; }
  const pad = (y1 - y0) * 0.08;
  y0 -= pad; y1 += pad;
  const X = v => L0 + (v - x0) / (x1 - x0) * (W - L0 - R0);
  const Y = v => H - B0 - (v - y0) / (y1 - y0) * (H - T0 - B0);
  const color = opts.color || "#4a90d9";
  let path = "M" + X(samples[0].x).toFixed(1) + "," + Y(samples[0].y).toFixed(1);
  for (let i = 1; i < samples.length; i++) path += " L" + X(samples[i].x).toFixed(1) + "," + Y(samples[i].y).toFixed(1);
  const area = path + " L" + X(x1).toFixed(1) + "," + (H - B0) + " L" + X(x0).toFixed(1) + "," + (H - B0) + " Z";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 " + W + " " + H);
  svg.setAttribute("width", "100%");
  svg.setAttribute("class", "xplot");
  svg.innerHTML =
    '<path d="' + area + '" fill="' + color + '" opacity="0.13"/>' +
    '<path d="' + path + '" fill="none" stroke="' + color + '" stroke-width="1.6"/>' +
    '<text x="' + L0 + '" y="11" class="prof-label">' + esc(opts.yFmt(y1)) + "</text>" +
    '<text x="' + L0 + '" y="' + (H - 7) + '" class="prof-label">' + esc(opts.yFmt(y0)) + "</text>" +
    '<text x="' + (W - R0) + '" y="' + (H - 7) + '" class="prof-label" text-anchor="end">' + esc(opts.xFmt(x1)) + "</text>" +
    '<line class="xhair-line" x1="0" x2="0" y1="' + T0 + '" y2="' + (H - B0) + '" style="display:none"/>' +
    '<circle class="xhair-dot" r="4.5" cx="0" cy="0" style="display:none"/>';
  div.innerHTML = '<div class="plot-title">' + esc(title) + "</div>";
  div.appendChild(svg);
  const line = svg.querySelector(".xhair-line"), dot = svg.querySelector(".xhair-dot");
  /* réticule : la ligne se cale sur l'échantillon le plus proche du doigt/curseur */
  const setIndex = idx => {
    const s = samples[idx];
    if (!s) return;
    const px = X(s.x);
    line.setAttribute("x1", px); line.setAttribute("x2", px); line.style.display = "";
    dot.setAttribute("cx", px); dot.setAttribute("cy", Y(s.y)); dot.style.display = "";
  };
  const clear = () => { line.style.display = "none"; dot.style.display = "none"; };
  const pick = ev => {
    ev.preventDefault();
    const rect = svg.getBoundingClientRect();
    const px = ((ev.clientX - rect.left) / rect.width) * W;
    if (px < L0 - 4 || px > W - R0 + 4) return;
    /* recherche du plus proche : les x sont croissants (temps ou distance) */
    let best = 0, bestD = Infinity;
    for (let i = 0; i < samples.length; i++) {
      const dd = Math.abs(X(samples[i].x) - px);
      if (dd < bestD) { bestD = dd; best = i; }
    }
    opts.onPick(best, samples[best]);
  };
  svg.addEventListener("pointermove", pick);
  svg.addEventListener("pointerdown", pick);
  svg.addEventListener("pointerleave", () => opts.onPick(null, null));
  return { el: div, setIndex, clear };
}

function buildTracePlots(pts, run) {
  const box = $("#trace-plots");
  if (!box) return;
  box.innerHTML = "";
  tracePlots = [];
  const S = traceSamples(pts);
  const t0 = pts[0].t;
  const timeFmt = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60; return h ? h + "h" + String(m).padStart(2, "0") : m + "'" + String(ss).padStart(2, "0") + '"'; };
  const onPick = (idxInPlot, sample, allPlots) => {
    /* synchronise toutes les courbes + la carte sur le point choisi */
    const ptIndex = sample ? sample.i : null;
    tracePlots.forEach(p => { if (sample) p.setByPt(ptIndex); else p.clear(); });
    const ro = $("#trace-readout");
    if (sample && ro) {
      const p = pts[ptIndex];
      let txt = S.dist[ptIndex] != null ? (S.dist[ptIndex] / 1000).toFixed(2).replace(".", ",") + " km" : "";
      if (p.ele != null) txt += " · " + Math.round(p.ele) + " m";
      if (p.t != null && t0 != null) txt += " · " + timeFmt((p.t - t0) / 1000);
      const near = S.speedByPt[ptIndex];
      if (near != null) txt += " · " + near.toFixed(1).replace(".", ",") + " km/h";
      if (p.hr != null) txt += " · " + Math.round(p.hr) + " bpm";
      ro.textContent = txt;
    }
    if (sample && traceMarker && traceMap && pts[ptIndex]) {
      traceMarker.setLatLng([pts[ptIndex].lat, pts[ptIndex].lon]);
    }
  };
  /* index de vitesse par point : fenêtre 30 s autour du point */
  S.speedByPt = [];
  if (S.speed.length) {
    S.speed.forEach(s => { S.speedByPt[s.i] = s.y; });
  }
  const mk = (title, samples, opts) => {
    const plot = xPlot(title, samples, Object.assign({ onPick: (idx, s) => onPick(idx, s) }, opts));
    /* index par numéro de point (les échantillons n'ont pas tous les points) */
    const byPt = {};
    samples.forEach((s, i) => { if (!(s.i in byPt)) byPt[s.i] = i; });
    plot.setByPt = ptIdx => { if (ptIdx in byPt) plot.setIndex(byPt[ptIdx]); else plot.clear(); };
    box.appendChild(plot.el);
    tracePlots.push(plot);
  };
  mk("Altitude (m) — en fonction de la distance", S.alt,
    { yFmt: v => Math.round(v) + " m", xFmt: v => v.toFixed(1).replace(".", ",") + " km", color: "#2fa860", empty: "Pas de données d'altitude dans cette trace." });
  mk("Distance (km) — en fonction du temps", S.kmTime,
    { yFmt: v => v.toFixed(1).replace(".", ",") + " km", xFmt: timeFmt, color: "#4a90d9", empty: "Pas d'horodatage dans cette trace." });
  mk("Vitesse lissée (km/h) — en fonction du temps", S.speed,
    { yFmt: v => v.toFixed(1).replace(".", ",") + " km/h", xFmt: timeFmt, color: "#c78a1d", empty: "Pas d'horodatage dans cette trace." });
}

function bindTraceViewerEvents(run, pts) {
  const back = $("#trace-back");
  if (back) back.addEventListener("click", () => {
    openTraceId = null;
    destroyTraceMap();
    tracePlots = [];
    renderTraces();
  });
  $$("#trace-layers .chip").forEach(b => b.addEventListener("click", () => {
    if (traceMap && traceMap.switchBase) traceMap.switchBase(b.dataset.baselayer);
    else toast("Carte pas encore chargée.");
  }));
  const exp = $("#trace-export");
  if (exp && pts) exp.addEventListener("click", () => {
    Geo.download("sortie-" + run.date + ".gpx", Geo.toGpx("Sortie " + run.date, pts));
  });
}

/* ---- Résumé : FC, km, VO2max ---- */
function renderStats() {
  const runs = state.runs;
  const km = runs.reduce((s, r) => s + (r.dist || 0), 0);
  const dur = runs.reduce((s, r) => s + (r.dur || 0), 0);
  const dp = runs.reduce((s, r) => s + (r.dplus || 0), 0);
  /* FC : profil + moyennes/maxima des séances Polar */
  const withHr = runs.filter(r => r.polar && r.polar.hr && r.polar.hr.average);
  const hrAvg = withHr.length ? Math.round(withHr.reduce((s, r) => s + r.polar.hr.average, 0) / withHr.length) : null;
  const hrMax = withHr.length ? Math.max(...withHr.map(r => r.polar.hr.maximum || 0)) : null;
  const p = state.profile || {};
  let html = "<h2>Résumé</h2>" +
    '<div class="stat-cards">' +
    '<div class="stat"><span>' + km.toFixed(1).replace(".", ",") + '</span><label>km au total</label></div>' +
    '<div class="stat"><span>' + fmtHours(dur) + ' h</span><label>durée totale</label></div>' +
    '<div class="stat"><span>' + dp + '</span><label>m D+ au total</label></div>' +
    '<div class="stat"><span>' + runs.length + '</span><label>séances enregistrées</label></div>' +
    "</div>";
  html += '<div class="stat-cards">' +
    '<div class="stat"><span>' + (p.fcm || "—") + '</span><label>FC max (profil)</label></div>' +
    '<div class="stat"><span>' + (p.repos != null ? p.repos : "—") + '</span><label>FC de repos</label></div>' +
    '<div class="stat"><span>' + (hrAvg || "—") + '</span><label>FC moy. des séances Polar</label></div>' +
    '<div class="stat"><span>' + (hrMax || "—") + '</span><label>FC max atteinte (Polar)</label></div>' +
    "</div>";
  html += '<div class="stat-cards">' +
    '<div class="stat"><span>' + (p.vo2 || "—") + '</span><label>VO2max (ml/kg/min)</label></div>' +
    '<div class="stat"><span>' + (p.vma || "—") + '</span><label>VMA (km/h)</label></div>' +
    '<div class="stat"><span>' + (p.poids || "—") + '</span><label>poids (kg)</label></div>' +
    "</div>";
  if (!p.fcm && !p.vo2) html += '<div class="muted small">FC max, FC de repos, poids et VO2max viennent du profil Polar : connecte la montre puis « Actualiser le profil » (Paramètres > Réglages).</div>';
  /* répartition par type de séance */
  const types = sessionTypes();
  if (types.length) {
    html += "<h3>Par type de séance</h3>";
    html += '<div class="table-wrap"><table class="run-sheet"><thead><tr>' +
      "<th>Type</th><th>Séances</th><th>km</th><th>Durée</th><th>D+</th></tr></thead><tbody>";
    types.forEach(c => {
      const rs = runs.filter(r => r.code === c);
      const tkm = rs.reduce((s, r) => s + (r.dist || 0), 0);
      const tdur = rs.reduce((s, r) => s + (r.dur || 0), 0);
      const tdp = rs.reduce((s, r) => s + (r.dplus || 0), 0);
      html += "<tr><td>" + typeChip(c) + "</td><td>" + rs.length + "</td><td>" +
        tkm.toFixed(1).replace(".", ",") + "</td><td>" + fmtHours(tdur) + " h</td><td>" + tdp + "</td></tr>";
    });
    html += "</tbody></table></div>";
  }
  /* répartition du temps par zone de FC (sessions Polar enrichies) */
  const zRuns = runs.filter(r => r.polar && r.polar.zones && r.polar.zones.some(z => z.min != null));
  if (zRuns.length) {
    const nZ = 5;
    const tot = new Array(nZ).fill(0);
    zRuns.forEach(r => r.polar.zones.forEach((z, i) => { if (i < nZ) tot[i] += z.min || 0; }));
    const sum = tot.reduce((a, b) => a + b, 0) || 1;
    html += "<h3>Temps par zone de FC</h3>" +
      '<div class="hr-zones"><div class="hr-zones-bar">' +
      tot.map((m, i) => '<div class="hr-zone-seg" style="width:' + Math.max(100 * m / sum, 1) + "%;background:" + HR_ZONE_COLORS[i] + '"></div>').join("") +
      "</div>" +
      '<div class="hr-zones-legend">' + tot.map((m, i) =>
        '<span><i style="background:' + HR_ZONE_COLORS[i] + '"></i>Z' + (i + 1) + " · " + fmtHours(m) + " h (" + Math.round(100 * m / sum) + " %)</span>").join("") + "</div></div>" +
      '<div class="muted small">Z1-Z2 = charge légère (récupération, endurance fondamentale) · Z3 = modérée (endurance active) · Z4 = lourde (seuil) · Z5 = très lourde (VMA). Le plan est ~80/20 : l\'essentiel du temps doit être en Z1-Z3.</div>';
  }
  $("#view-stats").innerHTML = html;
}

function runCardHTML(r) {
  const ty = TYPES[r.code] || { label: r.code };
  const shoe = state.shoes.find(s => s.id === r.shoeId);
  const pace = r.dist > 0 && r.dur > 0 ? r.dur / r.dist : null;
  const phr = r.polar && r.polar.hr;
  let html = '<div class="run-card" data-id="' + r.id + '" id="run-card-' + r.id + '">' +
    '<div class="run-head"><b>' + esc(fmtDateShort(parseDate(r.date))) + "</b> " + typeChip(r.code) +
    (r.planned ? '<span class="muted">(' + esc(r.planned) + ")</span>" : "") +
    hrLoadBadgeHTML(r) +
    '<span class="spacer"></span><button class="mini-btn" data-edit="' + r.id + '">Modifier</button>' +
    '<button class="icon-btn del" data-del="' + r.id + '" title="Supprimer">✕</button></div>' +
    '<div class="run-stats">' +
    stat(r.dist ? r.dist.toFixed(1).replace(".", ",") + " km" : "—", "distance") +
    stat(r.dur ? fmtDur(r.dur * 60) : "—", "durée") +
    stat(r.dplus + " m", "D+") +
    stat(r.dist && r.dur ? (r.dist / (r.dur / 60)).toFixed(1).replace(".", ",") + " km/h" : "—", "vitesse moy.") +
    stat(pace ? Math.floor(pace) + "'" + String(Math.round((pace % 1) * 60)).padStart(2, "0") + '"/km' : "—", "allure") +
    stat(phr && phr.average != null ? phr.average + " / " + phr.maximum : "—", "FC moy / max (bpm)") +
    stat(r.polar && r.polar.calories != null ? r.polar.calories + " kcal" : "—", "calories") +
    stat(r.route ? esc(routeLabel(r.route)) : "—", "type de route") +
    stat(r.feel ? r.feel + "/10" : "—", "sensations") +
    stat(r.knee != null ? r.knee + "/10" : "—", "essuie-glace") +
    stat(r.ankle != null ? r.ankle + "/10" : "—", "cheville") +
    "</div>" +
    hrZonesHTML(r) +
    (shoe ? '<div class="muted small">Chaussures : ' + esc(shoe.name) + " · cumul " + shoeKm(shoe).toFixed(1).replace(".", ",") + " km</div>" : "") +
    (r.notes ? '<div class="run-notes">' + esc(r.notes) + "</div>" : "") +
    (r.points && r.points.length > 1 ? Geo.profileSVG(r.points) : "") +
    hrChartSVG(r) +
    '<div class="row-actions">' +
    '<button class="btn" data-details="' + r.id + '">Détails</button>' +
    (r.points && r.points.length > 1 ? '<button class="btn" data-goto-trace="' + r.id + '">Voir la trace</button>' +
      '<button class="btn" data-export="' + r.id + '">Exporter le GPX</button>' +
      '<button class="btn" data-plots="' + r.id + '">Courbes (altitude · vitesse · FC)</button>' : "") +
    "</div></div>";
  return html;
}
function stat(v, label) { return '<div class="run-stat"><span>' + v + "</span><label>" + label + "</label></div>"; }

/* ---- zones de FC Polar : barre par zone + badge de charge + courbe de FC ---- */
const HR_ZONE_COLORS = ["#9aa7b8", "#4a90d9", "#3fbf7f", "#e6c229", "#e05252"];
function hrLoadBadgeHTML(r) {
  const p = r.polar;
  if (!p || !p.load || !p.zone) return ""; // tant que les zones ne sont pas importées, pas de badge
  const cls = p.zone <= 2 ? "lo" : p.zone === 3 ? "mid" : "hi";
  const cl = p.cardioLoad != null ? " · charge cardio " + Math.round(p.cardioLoad * 10) / 10 : "";
  return ' <span class="badge hr-load-' + cls + '">Charge ' + esc(p.load) + " · zone " + p.zone + "/5" + cl + "</span>";
}
function hrZonesHTML(r) {
  const z = r.polar && r.polar.zones;
  if (!Array.isArray(z) || !z.length) return "";
  let html = '<div class="hr-zones">';
  if (z.some(x => x.pct != null)) {
    html += '<div class="hr-zones-bar">' + z.map((zz, i) =>
      '<div class="hr-zone-seg" style="width:' + Math.max(zz.pct || 0, 1) + "%;background:" + HR_ZONE_COLORS[i] + '"></div>').join("") + "</div>";
  }
  html += '<div class="hr-zones-legend">' + z.map((zz, i) =>
    '<span><i style="background:' + HR_ZONE_COLORS[i] + '"></i>Z' + (i + 1) + " " + zz.lo + "-" + zz.hi +
    (zz.min != null ? " · " + zz.min + "'" : "") + (zz.pct != null ? " · " + zz.pct + " %" : "") + "</span>").join("") + "</div>";
  html += "</div>";
  return html;
}
/* courbe de FC de la fiche : bandes de zones + échelle des limites de zones */
function hrChartSVG(r) {
  /* la série vit dans polar.hrS (polar.hr est le résumé {average, maximum}) */
  const hr = r.polar && (r.polar.hrS || (Array.isArray(r.polar.hr) ? r.polar.hr : null));
  if (!Array.isArray(hr) || hr.length < 5) return "";
  const z = (r.polar.zones || []).length ? r.polar.zones : null;
  const W = 640, H = 130, pad = 5;
  /* l'échelle couvre toujours l'échelle complète des zones */
  let lo = Math.min(...hr), hi = Math.max(...hr);
  if (z) z.forEach(zz => { lo = Math.min(lo, zz.lo); hi = Math.max(hi, zz.hi); });
  if (hi - lo < 2) hi = lo + 2;
  const y = v => H - pad - (v - lo) / (hi - lo) * (H - 2 * pad);
  let bands = "", gridSvg = "";
  if (z) {
    z.forEach((zz, i) => {
      const y1 = y(Math.min(zz.hi, hi)), y2 = y(Math.max(zz.lo, lo));
      bands += '<rect x="0" y="' + Math.max(y1, pad) + '" width="' + W + '" height="' + Math.max(0, Math.min(y2, H - pad) - Math.max(y1, pad)) +
        '" fill="' + HR_ZONE_COLORS[i] + '" opacity="0.15"/>';
      const gy = y(zz.lo);
      gridSvg += '<line x1="0" x2="' + W + '" y1="' + gy + '" y2="' + gy + '" stroke="rgba(255,255,255,0.10)" stroke-width="1"/>';
    });
    const gy = y(z[z.length - 1].hi);
    gridSvg += '<line x1="0" x2="' + W + '" y1="' + gy + '" y2="' + gy + '" stroke="rgba(255,255,255,0.10)" stroke-width="1"/>';
  }
  const pts = hr.map((v, i) => (i / (hr.length - 1) * W).toFixed(1) + "," + y(v).toFixed(1)).join(" ");
  /* étiquettes d'échelle : limites de zones (HTML, non déformé par le SVG) */
  let yLbl = "";
  if (z) {
    const seen = {};
    z.forEach(zz => { if (!seen[zz.lo]) { seen[zz.lo] = true; yLbl += '<span style="top:' + (y(zz.lo) / H * 100).toFixed(1) + '%">' + zz.lo + "</span>"; } });
    const khi = z[z.length - 1].hi;
    yLbl += '<span style="top:' + (y(khi) / H * 100).toFixed(1) + '%">' + khi + "</span>";
  }
  return '<div class="plot mini">' +
    '<div class="plot-y">' + yLbl + "</div>" +
    '<svg class="plot-svg" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" role="img" aria-label="Courbe de fréquence cardiaque">' +
    bands + gridSvg + '<polyline points="' + pts + '" fill="none" stroke="#ff7d6e" stroke-width="1.5"/>' +
    "</svg></div>";
}

/* ---- tracés interactifs configurables du modal « Détails » ----
   Réticule synchronisé : appuyer sur un tracé plante la ligne verticale et
   la valeur sur TOUS les tracés en même temps. Chaque tracé se règle :
   bornes de l'échelle Y, zoom X, taille, superposition d'une seconde série
   avec sa propre échelle (gauche/droite), plein écran et mode paysage.
   Axes légendés : « Temps [min] » en X, grandeur et unité en Y. */
let detailCharts = [];
const PLOT_W = 640, PLOT_H = 130, PLOT_PAD = 5;
/* étiquette d'axe temporel : minutes (« 12' ») sous une heure, sinon « 1h05 » */
function fmtAxisTime(sec) {
  if (sec == null || isNaN(sec)) return "";
  if (sec < 3600) return Math.round(sec / 60) + "'";
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h + "h" + String(m).padStart(2, "0");
}
/* catalogue des séries disponibles pour la séance ouverte */
function chartCatalog(r) {
  const p = r.polar || {};
  const durSec = (r.dur || 0) * 60;
  const hrSeries = Array.isArray(p.hrS) ? p.hrS : (Array.isArray(p.hr) ? p.hr : null);
  const defs = [];
  if (hrSeries) defs.push({ key: "hr", series: hrSeries, color: "#ff7d6e", unit: "bpm", label: "Fréquence cardiaque [bpm]", short: "FC", decimals: 0, invert: false, durSec, zones: p.zones || null });
  if (Array.isArray(p.cad)) defs.push({ key: "cad", series: p.cad, color: "#7dc4e8", unit: "pas/min", label: "Cadence [pas/min]", short: "Cadence", decimals: 0, invert: false, durSec });
  if (Array.isArray(p.pace)) defs.push({ key: "pace", series: p.pace, color: "#8fd3a9", unit: "min/km", label: "Allure [min/km]", short: "Allure", decimals: 1, invert: true, durSec });
  if (Array.isArray(p.alt)) defs.push({ key: "alt", series: p.alt, color: "#c9a86a", unit: "m", label: "Altitude [m]", short: "Altitude", decimals: 0, invert: false, durSec });
  return defs;
}
/* fenêtre de zoom (indices) d'un tracé */
function chartWindow(ch) {
  const n = ch.def.series.length;
  return [ch.i0 || 0, ch.i1 != null ? ch.i1 : n - 1];
}
function chartRangeFor(def, i0, i1, spanZones, ylim) {
  const sub = def.series.slice(i0, i1 + 1).filter(v => v != null && isFinite(v));
  let lo = sub.length ? Math.min(...sub) : 0, hi = sub.length ? Math.max(...sub) : 1;
  if (hi - lo < 2) hi = lo + 2;
  if (spanZones && def.zones) def.zones.forEach(z => { lo = Math.min(lo, z.lo); hi = Math.max(hi, z.hi); });
  if (ylim) {
    if (ylim[0] != null && isFinite(ylim[0])) lo = ylim[0];
    if (ylim[1] != null && isFinite(ylim[1])) hi = ylim[1];
    if (hi - lo < 0.5) hi = lo + 1;
  }
  return [lo, hi];
}
function chartYVal(lo, hi, invert, v) {
  return invert
    ? PLOT_PAD + (v - lo) / Math.max(1e-9, hi - lo) * (PLOT_H - 2 * PLOT_PAD)
    : PLOT_H - PLOT_PAD - (v - lo) / Math.max(1e-9, hi - lo) * (PLOT_H - 2 * PLOT_PAD);
}
/* lignes de grille + étiquettes d'une colonne d'échelle */
function chartScaleCol(lo, hi, invert, gridVals, decimals) {
  const y = v => chartYVal(lo, hi, invert, v);
  const seen = {};
  const vals = gridVals.filter(v => v >= lo && v <= hi && (function (k) { if (seen[k]) return false; seen[k] = true; return true; })(Math.round(v * 10) / 10));
  let svg = "", lbl = "";
  vals.forEach(v => {
    const yy = y(v).toFixed(1);
    svg += '<line x1="0" x2="' + PLOT_W + '" y1="' + yy + '" y2="' + yy + '" stroke="rgba(255,255,255,0.10)" stroke-width="1"/>';
    lbl += '<span style="top:' + (y(v) / PLOT_H * 100).toFixed(1) + '%">' + (decimals ? v.toFixed(decimals) : Math.round(v)) + "</span>";
  });
  return { svg, lbl };
}
/* bloc complet d'un tracé : titre, réglages, courbe(s), axes, réticule */
function chartHTML(ch) {
  const def = ch.def;
  const [i0, i1] = chartWindow(ch);
  const primLeft = ch.scaleSide !== "right";
  const [lo, hi] = chartRangeFor(def, i0, i1, !ch.ylim, ch.ylim);
  /* grille : limites de zones (FC) ou lo/milieu/hi */
  let gridVals = def.zones && !ch.ylim ? def.zones.map(z => z.lo).concat(def.zones[def.zones.length - 1].hi) : null;
  if (!gridVals) gridVals = [hi, (lo + hi) / 2, lo];
  const prim = chartScaleCol(lo, hi, def.invert, gridVals, def.decimals);
  /* superposition éventuelle : échelle propre, côté opposé */
  let ov = null;
  if (ch.overlay) {
    const [olo, ohi] = chartRangeFor(ch.overlay, i0, i1, false, null);
    ov = { def: ch.overlay, lo: olo, hi: ohi, col: chartScaleCol(olo, ohi, ch.overlay.invert, [ohi, (olo + ohi) / 2, olo], ch.overlay.decimals) };
  }
  let bands = "";
  if (def.zones && !ch.ylim) {
    bands = def.zones.map((z, i) => {
      const y1 = chartYVal(lo, hi, def.invert, Math.min(z.hi, hi)), y2 = chartYVal(lo, hi, def.invert, Math.max(z.lo, lo));
      const top = Math.min(y1, y2), bot = Math.max(y1, y2);
      if (bot - top < 0.5) return "";
      return '<rect x="0" y="' + top.toFixed(1) + '" width="' + PLOT_W + '" height="' + (bot - top).toFixed(1) + '" fill="' + HR_ZONE_COLORS[i] + '" opacity="0.13"/>';
    }).join("");
  }
  /* courbes : la fenêtre [i0, i1] occupe toute la largeur */
  const line = (series, lo2, hi2, invert) => series.slice(i0, i1 + 1).map((v, k) => {
    if (v == null || !isFinite(v)) return null;
    return (k / Math.max(1, i1 - i0) * PLOT_W).toFixed(1) + "," + chartYVal(lo2, hi2, invert, v).toFixed(1);
  }).filter(Boolean).join(" ");
  const line1 = line(def.series, lo, hi, def.invert);
  const line2 = ov ? line(ov.def.series, ov.lo, ov.hi, ov.def.invert) : "";
  /* graduations X sur la fenêtre + légende des axes */
  const n = def.series.length;
  const tAt = f => fmtAxisTime(Math.round((def.durSec || 0) * (i0 + f * (i1 - i0)) / Math.max(1, n - 1)));
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map(f =>
    '<span style="left:' + (f * 100) + '%"' + (f === 0 ? ' data-end="l"' : f === 1 ? ' data-end="r"' : "") + ">" + tAt(f) + "</span>").join("");
  const sizeCls = ch.size === "big" ? " plot-big" : ch.size === "small" ? " plot-sm" : "";
  let html = '<div class="chart-block" data-chart="' + def.key + '">' +
    '<div class="chart-title-row"><div class="chart-title">' + esc(def.label) + (ov ? ' <span class="muted small">+ ' + esc(ov.def.short) + '</span>' : "") + '</div>' +
    '<span><button class="mini-btn" data-cfg="' + def.key + '">Réglages</button>' +
    '<button class="mini-btn" data-fs="' + def.key + '">Plein écran</button>' +
    '<button class="mini-btn" data-fsland="' + def.key + '">Paysage</button></span></div>' +
    '<div class="plot' + sizeCls + '" data-pid="' + def.key + '">';
  const ycol1 = '<div class="plot-y ' + (primLeft ? "yl" : "yr") + '">' + prim.lbl + "</div>";
  const ycol2 = ov ? '<div class="plot-y ' + (primLeft ? "yr" : "yl") + '" style="color:' + ov.def.color + '">' + ov.col.lbl + "</div>" : "";
  html += (primLeft ? ycol1 + ycol2 : ycol2 + ycol1);
  html += '<svg class="plot-svg" viewBox="0 0 ' + PLOT_W + " " + PLOT_H + '" preserveAspectRatio="none">' +
    bands + prim.svg +
    '<polyline points="' + line1 + '" fill="none" stroke="' + def.color + '" stroke-width="1.5"/>' +
    (line2 ? '<polyline points="' + line2 + '" fill="none" stroke="' + ov.def.color + '" stroke-width="1.5"/>' : "") +
    '<line class="plot-xline" x1="0" x2="0" y1="0" y2="' + PLOT_H + '" stroke="#fff" stroke-width="1" stroke-dasharray="3 3" style="display:none"/>' +
    '<circle class="plot-dot" r="3.5" fill="#fff" stroke="' + def.color + '" stroke-width="2" style="display:none"/>' +
    (ov ? '<circle class="plot-dot2" r="3.5" fill="#fff" stroke="' + ov.def.color + '" stroke-width="2" style="display:none"/>' : "") +
    "</svg>" +
    '<div class="plot-x">' + xTicks + "</div>" +
    '<div class="plot-xlabel">Temps [min]</div>' +
    '<div class="plot-read hidden"></div>' +
    "</div>";
  /* panneau de réglages */
  if (ch.cfgOpen) {
    const others = chartCatalog(ch.run).filter(d => d.key !== def.key && d.series.length > 4);
    html += '<div class="chart-cfg">' +
      '<div class="cfg-row"><label>Y min <input type="number" step="any" data-ymin value="' + (ch.ylim && ch.ylim[0] != null ? ch.ylim[0] : "") + '" placeholder="' + Math.round(lo) + '"></label>' +
      '<label>Y max <input type="number" step="any" data-ymax value="' + (ch.ylim && ch.ylim[1] != null ? ch.ylim[1] : "") + '" placeholder="' + Math.round(hi) + '"></label>' +
      '<button class="mini-btn" data-yauto>Auto</button></div>' +
      '<div class="cfg-row"><label>Zoom de <input type="number" step="1" min="0" data-z0 value="' + (ch.zmin != null ? ch.zmin : "") + '" placeholder="0"> min</label>' +
      '<label>à <input type="number" step="1" min="0" data-z1 value="' + (ch.zmax != null ? ch.zmax : "") + '" placeholder="' + Math.round((def.durSec || 0) / 60) + '"> min</label>' +
      '<button class="mini-btn" data-zreset>Tout</button></div>' +
      '<div class="cfg-row"><label>Superposer <select data-ovl><option value="">—</option>' +
      others.map(d => '<option value="' + d.key + '"' + (ch.overlay && ch.overlay.key === d.key ? " selected" : "") + ">" + esc(d.short) + "</option>").join("") +
      '</select></label>' +
      '<label>Échelle principale <select data-side><option value="left"' + (primLeft ? " selected" : "") + '>à gauche</option><option value="right"' + (!primLeft ? " selected" : "") + '>à droite</option></select></label></div>' +
      '<div class="cfg-row">Taille <button class="mini-btn' + (ch.size === "small" ? " on" : "") + '" data-size="small">Compacte</button>' +
      '<button class="mini-btn' + (!ch.size || ch.size === "normal" ? " on" : "") + '" data-size="normal">Normale</button>' +
      '<button class="mini-btn' + (ch.size === "big" ? " on" : "") + '" data-size="big">Grande</button></div>' +
      "</div>";
  }
  html += "</div>";
  return html;
}
/* repeint un tracé après un réglage */
function renderChart(ch, container) {
  const box = (container || document).querySelector('.chart-block[data-chart="' + ch.def.key + '"]');
  if (!box) return;
  const tmp = document.createElement("div");
  tmp.innerHTML = chartHTML(ch);
  box.replaceWith(tmp.firstChild);
  bindChartControls(ch, container);
}
/* réticule synchronisé : la fraction (0..1) s'applique à tous les tracés */
function setDetailCrosshair(container, frac) {
  detailCharts.forEach(ch => {
    const box = (container || document).querySelector('.plot[data-pid="' + ch.def.key + '"]');
    if (!box) return;
    const line = box.querySelector(".plot-xline"), dot = box.querySelector(".plot-dot"), dot2 = box.querySelector(".plot-dot2"), read = box.querySelector(".plot-read");
    const [i0, i1] = chartWindow(ch);
    const idx = Math.max(i0, Math.min(i1, Math.round(i0 + frac * (i1 - i0))));
    const px = ((idx - i0) / Math.max(1, i1 - i0) * PLOT_W).toFixed(1);
    if (line) { line.setAttribute("x1", px); line.setAttribute("x2", px); line.style.display = ""; }
    const v = ch.def.series[idx];
    if (v == null || !isFinite(v)) return;
    const [lo, hi] = chartRangeFor(ch.def, i0, i1, !ch.ylim, ch.ylim);
    if (dot) { dot.setAttribute("cx", px); dot.setAttribute("cy", chartYVal(lo, hi, ch.def.invert, v).toFixed(1)); dot.style.display = ""; }
    let txt = fmtAxisTime(Math.round((ch.def.durSec || 0) * idx / Math.max(1, ch.def.series.length - 1))) + " · " + (ch.def.decimals ? v.toFixed(ch.def.decimals) : Math.round(v)) + " " + ch.def.unit;
    if (ch.overlay) {
      const v2 = ch.overlay.series[idx];
      if (v2 != null && isFinite(v2)) {
        const [olo, ohi] = chartRangeFor(ch.overlay, i0, i1, false, null);
        if (dot2) { dot2.setAttribute("cx", px); dot2.setAttribute("cy", chartYVal(olo, ohi, ch.overlay.invert, v2).toFixed(1)); dot2.style.display = ""; }
        txt += " · " + (ch.overlay.decimals ? v2.toFixed(ch.overlay.decimals) : Math.round(v2)) + " " + ch.overlay.unit;
      }
    }
    if (read) { read.textContent = txt; read.classList.remove("hidden"); }
  });
}
/* events pointeur d'un tracé : appui/glisser → réticule sur tous les tracés */
function bindChartCrosshair(ch, container) {
  const box = (container || document).querySelector('.plot[data-pid="' + ch.def.key + '"]');
  if (!box) return;
  const svg = box.querySelector("svg");
  if (!svg || svg.dataset.bound) return;
  svg.dataset.bound = "1";
  const fracOf = e => {
    const r = svg.getBoundingClientRect();
    if (!r.width && !r.height) return null;
    /* en mode paysage (pivot 90°), l'axe X du tracé suit l'axe Y de l'écran */
    const rotated = !!box.closest("[data-rotated]");
    return rotated
      ? Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
      : Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  };
  const move = e => { const f = fracOf(e); if (f != null) setDetailCrosshair(container, f); };
  svg.addEventListener("pointerdown", move);
  svg.addEventListener("pointermove", e => { if (e.buttons || e.pointerType === "touch") move(e); });
  svg.addEventListener("pointerleave", () => {
    (container || document).querySelectorAll(".plot-xline, .plot-dot, .plot-dot2").forEach(el => { el.style.display = "none"; });
    (container || document).querySelectorAll(".plot-read").forEach(el => { el.classList.add("hidden"); });
  });
}
function bindDetailPlots() {
  detailCharts.forEach(ch => { bindChartCrosshair(ch, $("#detail-body")); bindChartControls(ch, $("#detail-body")); });
}
/* boutons et champs de réglage d'un tracé */
function bindChartControls(ch, container) {
  const box = (container || document).querySelector('.chart-block[data-chart="' + ch.def.key + '"]');
  if (!box) return;
  const rerender = () => { renderChart(ch, container); };
  const onNum = (sel, fn) => {
    const el = box.querySelector(sel);
    if (el) el.addEventListener("change", () => { fn(parseFloat(el.value)); rerender(); });
  };
  onNum("[data-ymin]", v => { ch.ylim = [v, ch.ylim ? ch.ylim[1] : null]; });
  onNum("[data-ymax]", v => { ch.ylim = [ch.ylim ? ch.ylim[0] : null, v]; });
  const yauto = box.querySelector("[data-yauto]");
  if (yauto) yauto.addEventListener("click", () => { ch.ylim = null; rerender(); });
  onNum("[data-z0]", v => { ch.zmin = v; applyZoom(ch); rerender(); });
  onNum("[data-z1]", v => { ch.zmax = v; applyZoom(ch); rerender(); });
  const zr = box.querySelector("[data-zreset]");
  if (zr) zr.addEventListener("click", () => { ch.zmin = null; ch.zmax = null; ch.i0 = 0; ch.i1 = null; rerender(); });
  const ovl = box.querySelector("[data-ovl]");
  if (ovl) ovl.addEventListener("change", () => {
    ch.overlay = chartCatalog(ch.run).find(x => x.key === ovl.value) || null;
    rerender();
  });
  const side = box.querySelector("[data-side]");
  if (side) side.addEventListener("change", () => { ch.scaleSide = side.value; rerender(); });
  box.querySelectorAll("[data-size]").forEach(b => b.addEventListener("click", () => { ch.size = b.dataset.size; rerender(); }));
  const cfg = box.querySelector("[data-cfg]");
  if (cfg) cfg.addEventListener("click", () => { ch.cfgOpen = !ch.cfgOpen; rerender(); });
  const fs = box.querySelector("[data-fs]");
  if (fs) fs.addEventListener("click", () => openChartFS(ch, false));
  const fsland = box.querySelector("[data-fsland]");
  if (fsland) fsland.addEventListener("click", () => openChartFS(ch, true));
}
function applyZoom(ch) {
  const n = ch.def.series.length;
  const durSec = ch.def.durSec || 0;
  const idxOfMin = m => Math.max(0, Math.min(n - 1, Math.round((m || 0) * 60 / Math.max(1, durSec) * (n - 1))));
  ch.i0 = ch.zmin != null ? idxOfMin(ch.zmin) : 0;
  ch.i1 = ch.zmax != null ? idxOfMin(ch.zmax) : (n - 1);
  if (ch.i1 <= ch.i0) ch.i1 = Math.min(n - 1, ch.i0 + 4);
}
/* plein écran (mode paysage : le tracé pivoté à 90° pour occuper la largeur) */
function openChartFS(ch, landscape) {
  const fs = $("#fs-plot");
  if (!fs) return;
  $("#fs-title").textContent = ch.def.label;
  const body = $("#fs-body");
  if (landscape) body.setAttribute("data-rotated", "1");
  else body.removeAttribute("data-rotated");
  body.innerHTML = chartHTML(ch);
  fs.classList.remove("hidden");
  fs.classList.toggle("landscape", !!landscape);
  bindChartCrosshair(ch, body);
  bindChartControls(ch, body);
}
/* (l'ancien réticule individuel est remplacé par le réticule synchronisé) */

/* ---- modal « Détails » d'une séance : FC, zones, cadence, allure, altitude ---- */
function openSessionDetails(id) {
  const r = state.runs.find(x => x.id === id);
  if (!r) return;
  $("#detail-title").textContent = "Détails — " + fmtDateShort(parseDate(r.date)) + " · " + (TYPES[r.code] || { label: r.code }).label;
  const p = r.polar || {};
  let html = '<div class="run-stats">' +
    stat(r.dist ? r.dist.toFixed(1).replace(".", ",") + " km" : "—", "distance") +
    stat(r.dur ? fmtDur(r.dur * 60) : "—", "durée") +
    stat(r.dplus + " m", "D+") +
    stat(r.dist && r.dur ? (r.dist / (r.dur / 60)).toFixed(1).replace(".", ",") + " km/h" : "—", "vitesse moy.") +
    stat(p.hr && p.hr.average ? p.hr.average + " / " + p.hr.maximum : "—", "FC moy / max (bpm)") +
    stat(p.calories != null ? p.calories + " kcal" : "—", "calories") +
    stat(p.cadAvg ? p.cadAvg + " pas/min" : "—", "cadence (fréquence de foulée)") +
    stat(p.cardioLoad != null ? Math.round(p.cardioLoad * 10) / 10 : "—", "charge cardio") +
    "</div>";
  if (p.zones && p.zones.length) {
    html += "<h4>Répartition par zone de FC</h4>" + hrZonesHTML(r) +
      '<div class="muted small">Z1-Z2 charge légère · Z3 modérée · Z4 lourde (seuil) · Z5 très lourde (VMA).</div>';
  }
  detailCharts = []; /* reconstruits à chaque ouverture du modal */
  chartCatalog(r).forEach(def => {
    const ch = { def: def, run: r, ylim: null, zmin: null, zmax: null, i0: 0, i1: null, size: "normal", overlay: null, scaleSide: "left", cfgOpen: false };
    detailCharts.push(ch);
    html += chartHTML(ch);
  });
  if (!chartCatalog(r).length && !r.points) html += '<div class="muted">Pas de données détaillées pour cette séance (séance manuelle ou sans série Polar).</div>';
  $("#detail-body").innerHTML = html;
  bindDetailPlots();
  $("#detail-actions").innerHTML =
    (r.points && r.points.length > 1 ? '<button class="btn" id="dt-trace">Voir la trace (onglet Traces)</button>' : "") +
    '<button class="btn primary" id="dt-close">Fermer</button>';
  const t = $("#dt-trace");
  if (t) t.addEventListener("click", () => { $("#detail-modal").classList.add("hidden"); openTraceId = r.id; showView("traces"); });
  $("#dt-close").addEventListener("click", () => $("#detail-modal").classList.add("hidden"));
  $("#detail-modal").classList.remove("hidden");
}
$("#detail-close").addEventListener("click", () => $("#detail-modal").classList.add("hidden"));
$("#fs-close").addEventListener("click", () => { $("#fs-plot").classList.add("hidden"); $("#fs-body").innerHTML = ""; });

function bindNewEvents() {
  /* démarrer / suivre l'enregistrement GPS depuis « Nouveau » */
  const recStart = $("#new-rec-start");
  if (recStart) recStart.addEventListener("click", () => {
    startRecording();
    activateView("traces");
  });
  const recView = $("#new-rec-view");
  if (recView) recView.addEventListener("click", () => activateView("traces"));
  /* formulaire manuel : check-list sortie longue + sauvegarde */
  const codeSel = $("#rf-code"), slc = $("#rf-slcheck");
  const updSl = () => {
    if (codeSel && slc && codeSel.value === "SL") {
      slc.style.display = "";
      slc.innerHTML = "<b>Check-list sortie longue (répétition du jour J) :</b> gels et boisson déjà testés à l'entraînement · sac chargé comme en course (eau, ravitaillement, téléphone) · chaussures prévues · avec bâtons dès S25 si tu les utiliseras le jour J · garde chaque emballage et compte glucides/h, sodium et litres (audit du ravito) · rien de nouveau aujourd'hui.";
    } else if (slc) slc.style.display = "none";
  };
  if (codeSel) { codeSel.addEventListener("change", updSl); updSl(); }
  const rfSave = $("#rf-save");
  if (rfSave) rfSave.addEventListener("click", saveRunFromForm);
  /* minuteur fractionné de la séance proposée */
  $$("button[data-open-timer]").forEach(b => b.addEventListener("click", () => {
    const ty = TYPES[b.dataset.openTimer];
    if (ty.timer) openTimer("Séance " + ty.label, ty.timer, { noLog: true });
  }));
  /* import GPX */
  const gpxInput = $("#rf-gpx");
  if (gpxInput) gpxInput.addEventListener("change", async () => {
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
        toast("GPX importé : " + s.dist.toFixed(1) + " km, " + s.dplus + " m D+.");
      } catch (err) { toast("Erreur GPX : " + err.message); }
    }
    showView("sessions");
  });
}

function bindSessionsEvents(sorted) {
  /* filtres par type */
  $$("button[data-sfilter]").forEach(b => b.addEventListener("click", () => { sessionFilter = b.dataset.sfilter; renderSessions(); }));
  /* lignes du résumé : hyperlien vers la fiche détaillée */
  $$("tr[data-focus-run]").forEach(tr => tr.addEventListener("click", e => {
    if (e.target.closest("button")) return; // les boutons de la ligne ont leur propre action
    focusRunCard(+tr.dataset.focusRun);
  }));
  $$("button[data-del]").forEach(b => b.addEventListener("click", () => {
    const id = +b.dataset.del;
    const idx = state.runs.findIndex(r => r.id === id);
    if (idx < 0) return;
    const removed = state.runs[idx];
    state.runs.splice(idx, 1);
    if (removed.trackRef && ServerSync.on) fetch("api/track?id=" + removed.trackRef, { method: "DELETE" }).catch(() => {});
    save(); renderSessions(); updateHeader();
    toast("Séance supprimée.", { label: "Annuler", fn: () => { state.runs.splice(idx, 0, removed); save(); renderSessions(); updateHeader(); } });
  }));
  $$("button[data-details]").forEach(b => b.addEventListener("click", () => openSessionDetails(+b.dataset.details)));
  $$("button[data-goto-trace]").forEach(b => b.addEventListener("click", () => { openTraceId = +b.dataset.gotoTrace; showView("traces"); }));
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
}

function bindTracesEvents() {
  /* boutons de l'enregistreur : présents selon l'état (repos / en cours / arrêté) */
  const onStart = $("#rec-start");
  if (onStart) onStart.addEventListener("click", startRecording);
  const onStop = $("#rec-stop");
  if (onStop) onStop.addEventListener("click", stopRecording);
  const onCancel = $("#rec-cancel");
  if (onCancel) onCancel.addEventListener("click", cancelRecording);
  const onPause = $("#rec-pause");
  if (onPause) onPause.addEventListener("click", () => {
    if (!Recorder.active) return;
    Recorder.paused ? Recorder.unpause() : Recorder.pause();
    renderTraces();
    paintRecBanner();
    toast(Recorder.paused ? "Enregistrement en pause." : "Enregistrement repris.");
  });
  const onFinish = $("#rec-finish");
  if (onFinish) onFinish.addEventListener("click", () => finishStoppedTrace());
  const onDiscard = $("#rec-discard");
  if (onDiscard) onDiscard.addEventListener("click", () => discardStoppedTrace());
  /* liste des traces : ouvrir la visionneuse */
  $$("button[data-trace]").forEach(b => b.addEventListener("click", () => {
    openTraceId = +b.dataset.trace;
    renderTraces();
  }));
  /* boutons « Détails » de la liste (séances sans trace) */
  $$("button[data-details]").forEach(b => b.addEventListener("click", () => openSessionDetails(+b.dataset.details)));
  if (Recorder.active) { startRecTick(); paintRecorderUI(Recorder.live()); }
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
  /* repeint la boîte enregistreur de l'onglet Traces selon l'état courant */
  if ($("#view-traces").classList.contains("active")) renderTraces();
  paintRecBanner();
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
      '<button class="btn primary tiny" id="recb-stop">Stop</button>' +
      '<button class="btn tiny" id="recb-cancel">Annuler</button>';
  } else if (stoppedTrace) {
    /* trace arrêtée, en attente de « Terminer et noter » ou « Supprimer » */
    const sstats = Geo.stats(stoppedTrace.pts);
    b.classList.remove("hidden", "interrupted", "paused");
    $("#recb-title").textContent = "Trace prête à être notée";
    $("#recb-stats").textContent = sstats.dist.toFixed(2).replace(".", ",") + " km · " + fmtDur(sstats.dur);
    $("#recb-actions").innerHTML =
      '<button class="btn primary tiny" id="recb-finish2">Terminer et noter la sortie</button>' +
      '<button class="btn tiny" id="recb-discard2">Supprimer la sortie</button>';
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
  if (e.target.closest("#recb-pause")) { Recorder.paused ? Recorder.unpause() : Recorder.pause(); recButtonsState(); return; }
  if (e.target.closest("#recb-stop")) { stopRecording(); return; }
  if (e.target.closest("#recb-cancel")) { cancelRecording(); return; }
  if (e.target.closest("#recb-resume")) { resumeRecording(); return; }
  if (e.target.closest("#recb-finish2")) { finishStoppedTrace(); return; }
  if (e.target.closest("#recb-discard2")) { discardStoppedTrace(); return; }
  if (e.target.closest("#recb-finish")) { finishCapture(Recorder.loadCheckpoint().pts, Recorder.loadCheckpoint().dist, null); Recorder.abort(); paintRecBanner(); return; }
  if (e.target.closest("#recb-discard")) { if (confirm("Supprimer la trace enregistrée en cours ?")) { Recorder.abort(); paintRecBanner(); toast("Trace supprimée."); } return; }
});
function resumeRecording() {
  Recorder.resume(live => paintRecorderUI(live)).then(() => {
    recButtonsState(); startRecTick(); paintRecBanner();
    if ($("#view-traces").classList.contains("active")) paintRecorderUI(Recorder.live());
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
  showView("new");
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
  if (r.pts && r.pts.length >= 2) {
    stoppedTrace = r; // en attente : « Terminer et noter la sortie » ou « Supprimer la sortie »
    toast("Enregistrement arrêté — note la sortie ou supprime la trace.");
  } else {
    stoppedTrace = null;
    toast("Pas assez de points enregistrés.");
  }
  recButtonsState();
}
/* « Terminer et noter la sortie » : la trace arrêtée part dans le formulaire */
function finishStoppedTrace() {
  if (!stoppedTrace) return;
  const r = stoppedTrace;
  stoppedTrace = null;
  finishCapture(r.pts, r.dist, r.dur);
  recButtonsState();
}
/* « Supprimer la sortie » : jette la trace arrêtée */
function discardStoppedTrace() {
  if (!stoppedTrace) return;
  if (!confirm("Supprimer la sortie enregistrée ? La trace GPS sera perdue.")) return;
  stoppedTrace = null;
  pendingPoints = null;
  recButtonsState();
  toast("Sortie supprimée.");
}
/* depuis le résumé des sorties : ouvre la fiche détaillée (défilement + surbrillance) */
function focusRunCard(id) {
  const card = document.getElementById("run-card-" + id);
  if (!card) return;
  card.scrollIntoView({ behavior: "smooth", block: "center" });
  card.classList.add("flash");
  setTimeout(() => card.classList.remove("flash"), 1600);
}
function cancelRecording() {
  if (!Recorder.active && !Recorder.hasCheckpoint()) return;
  if (!confirm("Annuler l'enregistrement ? La trace GPS sera perdue.")) return;
  unlockScreen();
  Recorder.abort();
  clearInterval(recTimerIv); recTimerIv = null;
  pendingPoints = null;
  stoppedTrace = null;
  recButtonsState();
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
  toast("Séance corrigée.");
  renderSessions(); updateHeader();
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
  const isRunCode = RUN_CODES.includes($("#rf-code").value || "AUTRE");
  if (!shoeId && isRunCode) {
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
  } else toast("Séance enregistrée. Bien joué !" + realNoteMsg);
  showView("sessions");
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

/* contexte joint à la question du coach : sorties (résumé ou données brutes) + fichiers GPX */
let coachAttach = { runs: {}, gpx: [] };
function attachCount() {
  return Object.keys(coachAttach.runs).length + coachAttach.gpx.length;
}
/* ---- conversations : active, navigation, création ---- */
function activeConv() {
  let c = state.convs.find(x => x.id === state.convId);
  if (!c) { c = state.convs[state.convs.length - 1] || null; if (c) state.convId = c.id; }
  return c;
}
function newConv() {
  const c = { id: ++state.seq, title: "Nouvelle conversation", created: Date.now(), msgs: [] };
  state.convs.push(c);
  state.convId = c.id;
  return c;
}
function convBarHTML() {
  const cur = activeConv();
  if (!cur) return "";
  const n = state.convs.length;
  const idx = state.convs.findIndex(c => c.id === cur.id);
  return '<div class="conv-bar">' +
    '<button class="icon-btn" id="conv-prev" title="Conversation précédente"' + (idx > 0 ? "" : " disabled") + ">◀</button>" +
    '<div class="conv-title" title="' + esc(cur.title) + '"><span>' + esc(cur.title) + "</span>" +
    (n > 1 ? ' <span class="muted small">' + (idx + 1) + "/" + n + "</span>" : "") + "</div>" +
    '<button class="icon-btn" id="conv-next" title="Conversation suivante"' + (idx < n - 1 ? "" : " disabled") + ">▶</button>" +
    '<button class="btn tiny" id="conv-new" title="Démarrer une nouvelle conversation">+ Nouvelle</button>' +
    '<button class="btn tiny" id="conv-del" title="Supprimer cette conversation">🗑</button>' +
    "</div>";
}
/* ---- pièces jointes : barre GPX toujours visible + liste des sorties repliable ---- */
function coachAttachBarHTML() {
  return '<div class="attach-gpx">' +
    '<label class="btn file-btn">Joindre un GPX<input type="file" id="coach-gpx-file" accept=".gpx,application/gpx+xml,text/xml" multiple></label>' +
    '<span id="attach-gpx-list">' + coachGpxChipsHTML() + "</span></div>";
}
function coachAttachRunsHTML() {
  const runs = state.runs.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 15);
  let html = '<details class="coach-attach" id="coach-attach"' + (Object.keys(coachAttach.runs).length ? " open" : "") + ">" +
    '<summary>Joindre des sorties <span class="badge light" id="attach-count">' + Object.keys(coachAttach.runs).length + " joint" + (Object.keys(coachAttach.runs).length > 1 ? "s" : "") + "</span></summary>" +
    '<div class="attach-zone">';
  if (!runs.length) {
    html += '<div class="muted small">Aucune sortie enregistrée pour l\'instant — enregistre une sortie (onglet Sorties) ou joins un fichier GPX.</div>';
  } else {
    html += '<div class="muted small">Coches les sorties à joindre : « résumé » (bilan) ou « données brutes » (points GPS échantillonnés).</div><div class="attach-runs">';
    runs.forEach(r => {
      const on = coachAttach.runs[r.id] != null;
      const mode = coachAttach.runs[r.id] || "resume";
      const label = (TYPES[r.code] || { label: r.code }).label;
      html += '<div class="attach-run">' +
        '<label class="item-l"><input type="checkbox" data-attach="' + r.id + '"' + (on ? " checked" : "") + ">" +
        typeChip(r.code) + "<span>" + esc(r.date + " · " + label +
          (r.dist ? " · " + Number(r.dist).toFixed(1).replace(".", ",") + " km" : "") +
          (r.dur ? " · " + Math.round(r.dur) + " min" : "")) + "</span></label>" +
        '<select data-attachmode="' + r.id + '"' + (on ? "" : " disabled") + ">" +
        '<option value="resume"' + (mode === "resume" ? " selected" : "") + ">résumé</option>" +
        '<option value="brut"' + (mode === "brut" ? " selected" : "") + ">données brutes</option></select>" +
        "</div>";
    });
    html += "</div>";
  }
  return html + "</div></details>";
}
function coachGpxChipsHTML() {
  return coachAttach.gpx.map((g, i) =>
    '<span class="gpx-chip">' + esc(g.name) + " · " + g.pts.length + " pts" +
    ' <button type="button" data-gpxdel="' + i + '" title="Retirer">×</button></span>').join("") || "";
}
/* lecture d'un fichier : API moderne si dispo, sinon FileReader */
function readFile(f) {
  if (f.text) return f.text();
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = () => rej(new Error("lecture impossible"));
    fr.readAsText(f);
  });
}

function renderCoach() {
  if (!state.convs.length) newConv();   // au moins une conversation (barre ◀ ▶ toujours présente)
  let html = "<h2>Coach IA — Trail</h2>" +
    '<div class="muted sub">Un coach Mistral AI embarqué, informé en direct de ton programme réalisé, de tes sorties, ' +
    "de tes douleurs et de l'usure de tes chaussures (skill « coach trail »). " +
    "Les conversations sont conservées et synchronisées entre appareils — navigue avec les flèches ◀ ▶.</div>";
  if (!state.mistral.key) {
    html += '<div class="note">Pour activer le coach, entre ta clé API Mistral dans l\'onglet <b>Réglages</b> ' +
      "(crée une clé sur console.mistral.com — l'offre gratuite suffit). La clé reste dans ce navigateur.</div>";
  }
  html += '<div class="coach-wrap">' +
    convBarHTML() +
    '<div class="coach-msgs" id="coach-msgs">' + coachMsgsHTML() + "</div>" +
    coachAttachBarHTML() +
    coachAttachRunsHTML() +
    '<details class="coach-sugg-det" id="coach-sugg-det">' +
    '<summary>Idées de questions <span class="muted small">— clique pour dérouler</span></summary>' +
    '<div class="row-actions coach-sugg">' + COACH_SUGGESTIONS.map(s =>
      '<button class="mini-btn" data-sugg="' + esc(s) + '">' + esc(s) + "</button>").join("") + "</div></details>" +
    '<div class="coach-input">' +
    '<textarea id="coach-in" rows="2" placeholder="Pose ta question au coach… (les éléments joints ci-dessus seront inclus)"></textarea>' +
    '<button class="btn primary" id="coach-send">Envoyer</button>' +
    "</div></div>";
  $("#view-coach").innerHTML = html;
  $("#coach-send").addEventListener("click", sendCoach);
  $("#coach-in").addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendCoach(); }
  });
  /* navigation entre conversations (◀ ▶) */
  const idx = () => state.convs.findIndex(c => c.id === state.convId);
  const nav = d => {
    const i = idx() + d;
    if (i >= 0 && i < state.convs.length) { state.convId = state.convs[i].id; save(); renderCoach(); }
  };
  const prev = $("#conv-prev"); if (prev) prev.addEventListener("click", () => nav(-1));
  const next = $("#conv-next"); if (next) next.addEventListener("click", () => nav(1));
  const newBtn = $("#conv-new");
  if (newBtn) newBtn.addEventListener("click", () => {
    const cur = activeConv();
    if (cur && !cur.msgs.length) { toast("Tu es déjà dans une conversation vide."); return; }
    newConv(); save(); renderCoach();
  });
  const del = $("#conv-del");
  if (del) del.addEventListener("click", () => {
    const cur = activeConv();
    if (!cur || !cur.msgs.length) { toast("Rien à supprimer dans cette conversation."); return; }
    if (!confirm("Supprimer cette conversation ?")) return;
    const i = idx();
    state.convs = state.convs.filter(c => c.id !== state.convId);
    if (!state.convs.length) newConv();
    else state.convId = state.convs[Math.min(i, state.convs.length - 1)].id;
    save(); renderCoach();
  });
  $$("button[data-sugg]").forEach(b => b.addEventListener("click", () => {
    $("#coach-in").value = b.dataset.sugg; sendCoach();
  }));
  /* pièces jointes : cochages, mode résumé/brut, GPX */
  $$("input[data-attach]").forEach(cb => cb.addEventListener("change", () => {
    const id = cb.dataset.attach;
    const sel = $('select[data-attachmode="' + id + '"]');
    if (cb.checked) { if (coachAttach.runs[id] == null) coachAttach.runs[id] = "resume"; if (sel) sel.disabled = false; }
    else { delete coachAttach.runs[id]; if (sel) sel.disabled = true; }
    updateAttachCount();
  }));
  $$("select[data-attachmode]").forEach(sel => sel.addEventListener("change", () => {
    coachAttach.runs[sel.dataset.attachmode] = sel.value;
  }));
  $("#coach-gpx-file").addEventListener("change", async e => {
    for (const f of Array.from(e.target.files || [])) {
      try {
        const txt = await readFile(f);
        const pts = Geo.parseGpx(txt);
        coachAttach.gpx.push({ name: f.name, pts });
        toast("GPX joint : " + f.name + " (" + pts.length + " points).");
      } catch (err) {
        toast("GPX illisible (" + f.name + ") : " + err.message);
      }
    }
    e.target.value = "";
    $("#attach-gpx-list").innerHTML = coachGpxChipsHTML();
    bindGpxDel();
  });
  bindGpxDel();
  scrollCoachBottom();
}
function bindGpxDel() {
  $$("button[data-gpxdel]").forEach(b => b.addEventListener("click", () => {
    coachAttach.gpx.splice(+b.dataset.gpxdel, 1);
    $("#attach-gpx-list").innerHTML = coachGpxChipsHTML();
    bindGpxDel();
    updateAttachCount();
  }));
}
function updateAttachCount() {
  const el = $("#attach-count"), n = Object.keys(coachAttach.runs).length;
  if (el) { el.textContent = n + " joint" + (n > 1 ? "s" : ""); }
  const det = $("#coach-attach");
  if (det && n) det.open = true;
}

/* petit lecteur Markdown (sans dépendance) pour les réponses du coach :
   titres, listes, gras/italique, code, citations, liens, tableaux, règles. */
function mdToHTML(src) {
  const lines = String(src || "").replace(/\r/g, "").split("\n");
  let html = "", list = null, para = [], inCode = false, inTable = false;
  const inline = s => esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|[\s(«])\*([^*\n]+)\*/g, "$1<i>$2</i>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const closePara = () => { if (para.length) { html += "<p>" + para.join("<br>") + "</p>"; para = []; } };
  const closeList = () => { if (list) { html += "</" + list + ">"; list = null; } };
  const closeTable = () => { if (inTable) { html += "</tbody></table>"; inTable = false; } };
  const flushAll = () => { closePara(); closeList(); closeTable(); };
  for (const line of lines) {
    if (inCode) {
      if (/^\s*```/.test(line)) { html += "</code></pre>"; inCode = false; }
      else html += esc(line) + "\n";
      continue;
    }
    if (/^\s*```/.test(line)) { flushAll(); html += '<pre class="md-pre"><code>'; inCode = true; continue; }
    if (line.indexOf("|") !== -1 && line.trim().length > 2) {
      const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim());
      if (cells.every(c => /^:?-{2,}:?$/.test(c))) continue;   // ligne séparatrice
      if (!inTable) { flushAll(); html += '<table class="md-table"><tbody>'; inTable = true; }
      html += "<tr>" + cells.map(c => "<td>" + inline(c) + "</td>").join("") + "</tr>";
      continue;
    }
    if (inTable) closeTable();
    const h = line.match(/^#{1,6}\s+(.*)$/);
    if (h) { flushAll(); html += "<h5>" + inline(h[1]) + "</h5>"; continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { flushAll(); html += "<hr>"; continue; }
    const bq = line.match(/^\s*>\s?(.*)$/);
    if (bq) { flushAll(); html += "<blockquote>" + inline(bq[1]) + "</blockquote>"; continue; }
    const ul = line.match(/^\s*[-*•]\s+(.*)$/);
    if (ul) { closePara(); closeTable(); if (list !== "ul") { closeList(); html += "<ul>"; list = "ul"; } html += "<li>" + inline(ul[1]) + "</li>"; continue; }
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ol) { closePara(); closeTable(); if (list !== "ol") { closeList(); html += "<ol>"; list = "ol"; } html += "<li>" + inline(ol[1]) + "</li>"; continue; }
    if (!line.trim()) { flushAll(); continue; }
    para.push(inline(line.trim()));
  }
  if (inCode) html += "</code></pre>";
  flushAll();
  return html;
}

function coachMsgsHTML() {
  const conv = activeConv();
  const msgs = conv ? conv.msgs : [];
  if (!msgs.length)
    return '<div class="muted coach-empty">Exemples de questions : clique sur une suggestion ci-dessous.</div>';
  return msgs.map(m => {
    const isAI = m.role !== "user";
    return '<div class="coach-msg ' + (isAI ? "ai" : "me") + '"><div class="coach-bubble">' +
      (isAI ? mdToHTML(m.content) :
        esc(m.display != null ? m.display : m.content).split("\n").join("<br>")) +
      "</div></div>";
  }).join("");
}
function scrollCoachBottom() {
  const box = $("#coach-msgs"); if (box) box.scrollTop = box.scrollHeight;
}

/* construction du bloc [CONTEXTE JOINT] ajouté à la question */
function ptsToRaw(pts, max) {
  if (!pts || pts.length < 2) return "(pas de points GPS)";
  const d = Geo.decimate(pts, max || 120);
  const t0 = d[0].t || 0;
  return d.map(x => Math.round((x.t - t0) / 1000) + " " + x.lat.toFixed(5) + " " + x.lon.toFixed(5) +
    " " + (x.ele == null ? "-" : Math.round(x.ele)) + (x.hr != null ? " " + Math.round(x.hr) : "")).join("\n   ");
}
function buildCoachAttachments() {
  const parts = [];
  Object.keys(coachAttach.runs).forEach(k => {
    const r = state.runs.find(x => x.id === +k);
    if (!r) return;
    const bits = [];
    if (r.dist) bits.push("distance " + Number(r.dist).toFixed(2).replace(".", ",") + " km");
    if (r.dur) bits.push("durée " + Math.round(r.dur) + " min");
    if (r.dplus) bits.push("D+ " + r.dplus + " m");
    if (r.route) bits.push("terrain " + routeLabel(r.route));
    if (r.feel != null) bits.push("sensations " + r.feel + "/10");
    if (r.knee != null) bits.push("douleur essuie-glace " + r.knee + "/10");
    if (r.ankle != null) bits.push("douleur cheville " + r.ankle + "/10");
    if (r.notes) bits.push('notes "' + r.notes + '"');
    let p = "-- Sortie du " + r.date + " (" + ((TYPES[r.code] || { label: r.code }).label) + ") :\n   " + (bits.join(" · ") || "données incomplètes");
    if (coachAttach.runs[k] === "brut") {
      p += "\n   données brutes, colonnes t (s) lat lon élévation" + (r.points && r.points.some(x => x.hr != null) ? " FC" : "") + " :";
      p += "\n   " + ptsToRaw(r.points, 120);
    }
    parts.push(p);
  });
  coachAttach.gpx.forEach(g => {
    const st = Geo.stats(g.pts);
    parts.push('-- GPX "' + g.name + '" : ' +
      st.dist.toFixed(2).replace(".", ",") + " km, " + Math.round(st.dur / 60) + " min, " +
      st.dplus + " m D+ / " + st.dminus + " m D-" +
      (isFinite(st.minEle) && isFinite(st.maxEle) ? ", altitude " + Math.round(st.minEle) + "–" + Math.round(st.maxEle) + " m" : "") +
      "\n   points, colonnes t (s) lat lon élévation" + (g.pts.some(x => x.hr != null) ? " FC" : "") + " :" +
      "\n   " + ptsToRaw(g.pts, 120));
  });
  return parts.length ? "[CONTEXTE JOINT PAR LE COUREUR]\n" + parts.join("\n") : "";
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
  const conv = activeConv() || newConv();
  const attach = buildCoachAttachments();
  const full = attach ? q + "\n\n" + attach : q;
  if (!conv.msgs.length) conv.title = q.slice(0, 42) + (q.length > 42 ? "…" : "");
  conv.msgs.push({ id: ++state.seq, ts: Date.now(), role: "user", content: full, display: q });
  if (conv.msgs.length > 200) conv.msgs = conv.msgs.slice(-200);
  save();
  // indicateur « en train d'écrire »
  const box = $("#coach-msgs");
  box.innerHTML = coachMsgsHTML() + '<div class="coach-msg ai"><div class="coach-bubble muted">Le coach réfléchit…</div></div>';
  scrollCoachBottom();
  try {
    const messages = [{ role: "system", content: coachContext() },
      ...conv.msgs.slice(-30).map(m => ({ role: m.role, content: m.content }))];
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
    conv.msgs.push({ id: ++state.seq, ts: Date.now(), role: "assistant", content: reply.trim() });
    save();
  } catch (err) {
    let msg = "Erreur du coach : " + err.message;
    if (String(err).includes("Failed to fetch")) msg = "Impossible de joindre l'API Mistral (réseau, CORS ou clé invalide). Vérifie ta connexion et ta clé dans Réglages.";
    conv.msgs.push({ id: ++state.seq, ts: Date.now(), role: "assistant", content: msg });
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
    '<label>VO2max (ml/kg/min) <input type="number" id="st-vo2" min="20" max="80" step="0.1" placeholder="ex. 52" value="' + (state.profile && state.profile.vo2 != null ? state.profile.vo2 : "") + '"></label>' +
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
    "<h3>Montre Polar (Vantage M3)</h3>" +
    '<div id="polar-box"></div>' +
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
    const fcm = +$("#st-fcm").value, repos = +$("#st-resthr").value, poids = +$("#st-weight").value, vma = +$("#st-vma").value, vo2 = +$("#st-vo2").value;
    state.profile = (fcm || repos || poids || vma || vo2)
      ? { fcm: fcm || null, repos: repos || null, poids: poids || null, vma: vma || null, vo2: vo2 || null }
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
    const keepPolar = state.polar; // et l'état de la montre Polar (jeton réel côté serveur)
    state = { start: DEFAULT_START, done: {}, moves: {}, hidden: {}, custom: [], extra: [], runs: [], shoes: [], lastShoeId: null, seq: 1, lastWeekView: null, mistral: keep, polar: keepPolar, password: keepPass, ui: keepUi, chat: [] };
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

  /* ---- montre Polar : statut + boutons (rempli asynchronement) ---- */
  PolarSync.renderBox();
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
      this.polarTimer = setInterval(() => PolarSync.auto(), 300000); // sorties + récupération Polar toutes les 5 min
    } catch (e) { /* pas de serveur : mode local, rien à faire */ }
    updateStorageBadge();
    PolarSync.auto(); // import silencieux des sorties de la montre si connectée
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
        renderView(curView);
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

/* ================= montre Polar (Vantage M3, API AccessLink via le worker) =================
   Le worker porte l'OAuth et le jeton ; l'app ne fait que convertir les exercices
   Polar en sorties TrainingTrail (déduplication par polarId — jamais écrasées).
   Polar ne fournit que les 30 derniers jours, et uniquement les exercices
   téléversés APRÈS la connexion de la montre. */
function polarDurationMin(iso) {
  /* Polar renvoie des durées ISO 8601, parfois avec des secondes décimales
     (ex. "PT1379.748S") : le motif doit accepter les décimales. */
  const p = String(iso || "").match(/PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?/);
  if (!p) return 0;
  return Math.round((parseFloat(p[1]) || 0) * 60 + (parseFloat(p[2]) || 0) + (parseFloat(p[3]) || 0) / 60);
}
function polarCode(sport, detailed) {
  const s = String(sport || "").toUpperCase();
  const d = String(detailed || "").toUpperCase();
  if (s === "RUNNING" || s.indexOf("RUN") >= 0 || d.indexOf("RUNNING") >= 0 || d.indexOf("TRAIL") >= 0) return "CAP";
  if (s.indexOf("CYCL") >= 0 || s.indexOf("BIKE") >= 0) return "V";
  if (s.indexOf("SWIM") >= 0) return "NAT";
  if (s.indexOf("YOGA") >= 0) return "YOGA";
  return "AUTRE";
}
const PolarSync = {
  busy: false,

  async status() {
    try {
      const res = await fetch("api/polar/status", { cache: "no-store" });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) { return null; }
  },
  async exercises() {
    const res = await fetch("api/polar/exercises", { cache: "no-store" });
    let data = null;
    try { data = await res.json(); } catch (e) { }
    if (!res.ok || !data || !data.ok) throw new Error((data && data.error) || ("HTTP " + res.status));
    return data.exercises || [];
  },
  async gpx(id) {
    const res = await fetch("api/polar/gpx?id=" + encodeURIComponent(id), { cache: "no-store" });
    if (!res.ok) throw new Error("GPX indisponible (" + res.status + ")");
    return await res.text();
  },
  /* détail d'un exercice : zones de FC + séries (samples) en ligne */
  async detail(id) {
    const res = await fetch("api/polar/exercise?id=" + encodeURIComponent(id), { cache: "no-store" });
    let data = null;
    try { data = await res.json(); } catch (e) { }
    if (!res.ok || !data || !data.ok) throw new Error((data && data.error) || ("HTTP " + res.status));
    return data.exercise || null;
  },

  /* ---- zones de fréquence cardiaque Polar (5 zones) + charge de la séance ----
     Zones par défaut (coureur, montre Vantage M3) : 94-112 / 112-131 / 131-150 /
     150-168 / 168+. Les vraies limites viennent de l'API quand elles sont
     disponibles (samples=true&zones=true) ; le temps passé par zone se calcule
     proportionnellement depuis la série de FC. */
  async enrichRunFromDetail(run, ex) {
    if (!run.polar) run.polar = {};
    /* trace GPS : Polar peut livrer la route APRÈS l'import (has_route bascule
       à true une fois la trace traitée) — on la récupère alors ici */
    if (ex && ex.has_route && !(run.points && run.points.length > 1)) {
      try {
        const pts = Geo.parseGpx(await this.gpx(run.polarId));
        if (pts && pts.length > 1) {
          const s = Geo.stats(pts);
          run.points = Geo.compact(pts, 800);
          if (!run.dplus) run.dplus = s.dplus;
          if (!run.dist) run.dist = Math.round(s.dist * 100) / 100;
          if (run.points.length > 40 && ServerSync.tracks) {
            run.trackRef = run.id;
            fetch("api/track?id=" + run.trackRef, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(run.points)
            }).catch(() => {});
            run.points = null;
          }
        }
      } catch (e) { /* GPX pas encore disponible : on garde le résumé Polar */ }
    }
    const num = (x) => typeof x === "number" ? x : parseFloat(x);
    /* durée ISO 8601 -> secondes ("PT2M15S" -> 135) */
    const durSec = (iso) => {
      const p = String(iso || "").match(/PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?/);
      if (!p) return 0;
      return Math.round((parseFloat(p[1]) || 0) * 3600 + (parseFloat(p[2]) || 0) * 60 + (parseFloat(p[3]) || 0));
    };
    /* une série d'échantillons Polar : "76,76,77,…" -> [76,76,77,…] */
    const seriesOf = (typeId) => {
      if (!ex || !Array.isArray(ex.samples)) return null;
      const s = ex.samples.find(x => x && (x.sample_type === typeId || String(x.type).indexOf("heart") >= 0 && typeId === 0));
      if (!s) return null;
      const d = s.data;
      if (Array.isArray(d)) return d.map(Number).filter(isFinite);
      if (typeof d === "string") return d.split(/[,\s]+/).map(parseFloat).filter(v => isFinite(v));
      return null;
    };
    const compactSeries = (arr, max) => {
      if (!arr || arr.length < 2) return null;
      const step = Math.max(1, Math.ceil(arr.length / (max || 240)));
      const out = [];
      for (let i = 0; i < arr.length; i += step) out.push(Math.round(arr[i] * 10) / 10);
      return out;
    };
    /* zones de FC : limites + temps par zone (in_zone) données par l'API */
    const zraw = ex && (ex.heart_rate_zones || ex["heart-rate-zones"] || ex.heartRateZones || ex.zones);
    let limits = null, zoneSec = null;
    if (Array.isArray(zraw) && zraw.length >= 2) {
      const sorted = zraw.slice().sort((a, b) => num(a.index) - num(b.index));
      limits = sorted.map(z => [num(z.lower_limit != null ? z.lower_limit : z.lowerlimit), num(z.upper_limit != null ? z.upper_limit : z.upperlimit)]);
      zoneSec = sorted.map(z => durSec(z.in_zone || z["in-zone"] || z.inZone));
    }
    if (!limits) {
      const fcm = (state.profile && state.profile.fcm) || 190;
      limits = [[94, 112], [112, 131], [131, 150], [150, 168], [168, fcm]];
      zoneSec = null;
    }
    /* séries : FC (0), distance cumulée (1), cadence (2), altitude (3) */
    const hr = seriesOf(0);
    const dist = seriesOf(1);
    const cad = seriesOf(2);
    const alt = seriesOf(3);
    /* cadence : Polar donne des pas/min par jambe ; allure depuis la distance */
    if (cad && cad.length) {
      const moving = cad.filter(v => v > 5);
      run.polar.cadAvg = moving.length ? Math.round(2 * moving.reduce((a, b) => a + b, 0) / moving.length) : null;
      run.polar.cad = compactSeries(cad);
    }
    if (dist && dist.length > 4 && run.dur) {
      /* vitesse instantanée lissée -> allure min/km */
      const step = Math.max(1, Math.floor(dist.length / 240));
      const pace = [];
      for (let i = step; i < dist.length; i += step) {
        const dd = dist[i] - dist[i - step];
        const tt = run.dur * 60 * step / dist.length;
        pace.push(tt > 0 && dd > 0 ? Math.round(1000 / (dd / tt) / 60 * 10) / 10 : null);
      }
      const clean = pace.filter(v => v != null && isFinite(v) && v < 20);
      if (clean.length > 3) run.polar.pace = clean;
    }
    if (alt && alt.length > 4) run.polar.alt = compactSeries(alt);
    /* zones : temps par zone (API prioritaire, sinon calculé depuis la FC) */
    let zSec = zoneSec;
    if ((!zSec || !zSec.some(s => s > 0)) && hr && hr.length > 4) {
      const durS = (run.dur || 0) * 60 || hr.length;
      const counts = new Array(limits.length).fill(0);
      hr.forEach(v => {
        for (let i = 0; i < limits.length; i++) {
          if ((v <= limits[i][1] || i === limits.length - 1) && (v >= limits[i][0] || i === 0)) { counts[i]++; break; }
        }
      });
      const total = counts.reduce((a, b) => a + b, 0) || 1;
      zSec = counts.map(c => Math.round(c / total * durS));
    }
    if (zSec && zSec.some(s => s > 0)) {
      const tot = zSec.reduce((a, b) => a + b, 0) || 1;
      run.polar.zones = limits.map((l, i) => ({
        lo: Math.round(l[0]), hi: Math.round(l[1]),
        min: Math.round((zSec[i] || 0) / 60), pct: Math.round(100 * (zSec[i] || 0) / tot)
      }));
      let domi = 0;
      run.polar.zones.forEach((z, i) => { if (z.pct > run.polar.zones[domi].pct) domi = i; });
      run.polar.load = domi <= 1 ? "légère" : domi === 2 ? "modérée" : domi === 3 ? "lourde" : "très lourde";
      run.polar.zone = domi + 1;
    } else {
      run.polar.zones = limits.map(l => ({ lo: Math.round(l[0]), hi: Math.round(l[1]), min: null, pct: null }));
    }
    /* la série de FC vit dans polar.hrS : polar.hr reste le RÉSUMÉ
       {average, maximum} (utilisé par la fiche, le résumé et le coach) */
    if (hr && hr.length > 4) run.polar.hrS = compactSeries(hr);
    /* répare les séances enrichies avant la séparation des deux champs */
    if (Array.isArray(run.polar.hr)) {
      if (ex && ex.heart_rate) run.polar.hr = { average: ex.heart_rate.average, maximum: ex.heart_rate.maximum };
      else delete run.polar.hr;
    }
    /* charge cardio : les anciennes séances la stockaient dans polar.load */
    if (run.polar.cardioLoad == null && ex && ex.training_load_pro && ex.training_load_pro["cardio-load"] != null)
      run.polar.cardioLoad = ex.training_load_pro["cardio-load"];
    return run;
  },
  /* enrichit (ou rattrape) les sorties Polar sans zones complètes : quelques-unes par cycle */
  async enrichMissing(limit) {
    if (!ServerSync.on) return;
    const todo = state.runs.filter(r => r.polarId && (!r.polar || !r.polar.zones || !r.polar.zones.some(z => z.pct != null) || Array.isArray(r.polar.hr))).slice(0, limit || 3);
    let changed = false;
    for (const run of todo) {
      try {
        const ex = await this.detail(run.polarId);
        if (ex) { await this.enrichRunFromDetail(run, ex); changed = true; }
      } catch (e) { /* détail indisponible pour cette séance : on garde le résumé */ }
    }
    if (changed) {
      save();
      if ($("#view-sessions") && $("#view-sessions").classList.contains("active")) renderSessions();
      if ($("#view-today") && $("#view-today").classList.contains("active")) renderToday();
    }
    return todo.length;
  },

  /* exercice Polar -> sortie TrainingTrail (null si données inexploitables) */
  async toRun(ex) {
    if (!ex || !ex.id) return null;
    /* Polar envoie les champs en snake_case (start_time, has_route…), la doc
       les écrit avec des tirets : on accepte les deux. */
    const f = (n) => ex[n] != null ? ex[n] : ex[n.replace(/-/g, "_")];
    const t0 = Date.parse(f("start-time") || "");
    if (isNaN(t0)) return null;
    const date = new Date(t0 + (f("start-time-utc-offset") || 0) * 60000).toISOString().slice(0, 10);
    let points = null, dplus = 0, gDist = 0, gDur = 0;
    if (f("has-route")) {
      try {
        const pts = Geo.parseGpx(await this.gpx(ex.id));
        if (pts && pts.length > 1) {
          const s = Geo.stats(pts);
          points = Geo.compact(pts, 800);
          dplus = s.dplus; gDist = Math.round(s.dist * 100) / 100; gDur = Math.round(s.dur / 60);
        }
      } catch (e) { /* pas de trace récupérable : on garde le résumé Polar */ }
    }
    const pe = plannedRunEntry(date);
    const run = {
      id: state.seq++,
      date,
      code: polarCode(ex.sport, f("detailed-sport-info")),
      dist: ex.distance != null ? Math.round(ex.distance / 10) / 100 : gDist,
      dur: polarDurationMin(ex.duration) || gDur,
      dplus,
      feel: null, knee: null, ankle: null,
      notes: "Importé depuis Polar" + (ex.device ? " (" + ex.device + ")" : "") +
        (f("running-index") != null ? " · Running Index " + f("running-index") : ""),
      shoeId: null, route: null,
      points, trackRef: null,
      polarId: ex.id,
      polar: {
        sport: ex.sport || null,
        detailed: f("detailed-sport-info") || null,
        hr: f("heart-rate") || null,
        ri: f("running-index") != null ? f("running-index") : null,
        calories: ex.calories != null ? ex.calories : null,
        cardioLoad: (ex["training-load"] != null ? ex["training-load"] : (ex.training_load_pro && ex.training_load_pro["cardio-load"] != null ? ex.training_load_pro["cardio-load"] : null))
      },
      planned: pe ? pe.it.t : null,
      planKey: pe ? (pe.isCustom ? customKey(pe.custom.id) : itemKey(pe.w, pe.d, pe.i)) : null
    };
    /* trace GPS volumineuse : rangée hors état (R2) quand le serveur le permet */
    if (run.points && run.points.length > 40 && ServerSync.tracks) {
      run.trackRef = run.id;
      fetch("api/track?id=" + run.trackRef, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(run.points)
      }).catch(() => {});
      run.points = null;
    }
    return run;
  },

  /* importe toutes les sorties Polar non déjà présentes ; manuel = feedback visible */
  async import(manual) {
    if (this.busy || !ServerSync.on) { if (manual && !ServerSync.on) toast("Import Polar : serveur centralisé requis (deploy/worker)."); return; }
    this.busy = true;
    try {
      const list = await this.exercises();
      let added = 0, km = 0;
      for (const ex of list) {
        if (state.runs.some(r => r.polarId === ex.id)) continue;
        const run = await this.toRun(ex);
        if (!run) continue;
        state.runs.push(run);
        added++; km += run.dist || 0;
      }
      const changed = added > 0 || state.polar.lastSync == null;
      state.polar.lastSync = Date.now();
      if (changed) save();
      if (added) {
        toast("Polar : " + added + " sortie" + (added > 1 ? "s" : "") + " importée" + (added > 1 ? "s" : "") + " (" + km.toFixed(1).replace(".", ",") + " km). Pense à préciser chaussures et douleurs.");
        updateHeader();
        this.enrichMissing(5); // zones FC + charge des nouvelles sorties
        if ($("#view-sessions").classList.contains("active")) renderSessions();
        if ($("view-today") && $("view-today").classList.contains("active")) renderToday();
      } else if (manual) toast("Polar : aucune nouvelle sortie. Rappel : seuls les exercices téléversés sur Flow APRÈS la connexion (30 derniers jours) sont transmis — laisse la montre synchroniser, puis réessaie.");
    } catch (e) {
      if (manual) toast("Import Polar impossible : " + e.message);
    } finally { this.busy = false; }
  },

  /* infos physiques Polar -> profil coureur (FC max, FC repos, poids, VO2max) */
  async refreshProfile() {
    const res = await fetch("api/polar/physical-info", { cache: "no-store" });
    let data = null;
    try { data = await res.json(); } catch (e) { }
    if (!res.ok || !data || !data.ok) throw new Error((data && data.error) || ("HTTP " + res.status));
    const info = data.info || {};
    const p = Object.assign({ fcm: null, repos: null, poids: null, vma: null, vo2: null }, state.profile || {});
    if (info.maximum_heart_rate) p.fcm = info.maximum_heart_rate;
    if (info.resting_heart_rate) p.repos = info.resting_heart_rate;
    if (info.weight) p.poids = info.weight;
    if (info.vo2_max) p.vo2 = info.vo2_max;
    state.profile = p;
    save();
    return info;
  },

  async auto() {
    if (state.polar && state.polar.connected && ServerSync.on) {
      this.import(false);
      this.syncRecovery();
      this.enrichMissing(3); // zones de FC + charge des sorties déjà importées
    }
  },

  /* sommeil + Nightly Recharge + charge cardio -> state.polarNights (une clé par
     date). Échoue silencieusement par source (p. ex. si « Sleep data » n'est pas
     activé chez Polar). conserve 120 jours maximum. */
  async syncRecovery() {
    if (!ServerSync.on || !(state.polar && state.polar.connected)) return false;
    const to = isoDate(new Date());
    const from = isoDate(new Date(Date.now() - 27 * 864e5)); // Polar : plage max 28 jours
    const get = (url) => fetch(url, { cache: "no-store" })
      .then(r => r.ok ? r.json() : null)
      .catch(() => null);
    const [sleep, rec, load] = await Promise.all([
      get("api/polar/sleep?from=" + from + "&to=" + to),
      get("api/polar/recharge"),
      get("api/polar/load")
    ]);
    const nights = state.polarNights;
    let changed = false;
    const slot = (d) => nights[d] || (nights[d] = {});
    if (sleep && sleep.ok && Array.isArray(sleep.nights)) {
      sleep.nights.forEach(n => {
        if (!n || !n.date) return;
        const dur = n.sleep_start_time && n.sleep_end_time
          ? Math.max(0, Math.round((Date.parse(n.sleep_end_time) - Date.parse(n.sleep_start_time)) / 60000)) : null;
        slot(n.date).slp = {
          score: n.sleep_score || null,
          dur,
          deep: n.deep_sleep != null ? Math.round(n.deep_sleep / 60) : null,
          rem: n.rem_sleep != null ? Math.round(n.rem_sleep / 60) : null,
          cont: n.continuity != null ? n.continuity : null
        };
        changed = true;
      });
    }
    const recs = rec && rec.ok && Array.isArray(rec.recharges) ? rec.recharges : [];
    recs.forEach(r => {
      if (!r || !r.date) return;
      slot(r.date).rec = {
        ans: r["ans-charge"] != null ? r["ans-charge"] : null,
        hrv: r["heart-rate-variability-avg"] != null ? r["heart-rate-variability-avg"] : null,
        br: r["breathing-rate-avg"] != null ? r["breathing-rate-avg"] : null,
        hr: r["heart-rate-avg"] != null ? r["heart-rate-avg"] : null,
        st: r["nightly-recharge-status"] != null ? r["nightly-recharge-status"] : null
      };
      changed = true;
    });
    const loads = load && load.ok && Array.isArray(load.loads) ? load.loads : [];
    loads.forEach(l => {
      if (!l || !l.date || l.cardio_load == null || l.cardio_load < 0) return;
      slot(l.date).load = {
        v: l.cardio_load,
        str: l.strain != null ? l.strain : null,
        tol: l.tolerance != null && l.tolerance >= 0 ? l.tolerance : null,
        st: l.cardio_load_status || null
      };
      changed = true;
    });
    /* taille bornée : ne garde que 120 jours */
    const cutoff = Date.now() - 120 * 864e5;
    Object.keys(nights).forEach(d => {
      if (Date.parse(d) < cutoff) { delete nights[d]; changed = true; }
    });
    if (changed) {
      save();
      if ($("view-today") && $("view-today").classList.contains("active")) renderToday();
    }
    return changed;
  },

  /* rendu de la section « Montre Polar » des Réglages (statut + boutons) */
  async renderBox() {
    const box = $("#polar-box");
    if (!box) return;
    if (!ServerSync.on) {
      box.innerHTML = '<div class="muted small">Nécessite le serveur centralisé (deploy/worker). En hébergement statique : exporte tes sorties depuis Polar Flow (GPX) et importe-les dans l\'onglet Sorties.</div>';
      return;
    }
    box.innerHTML = '<div class="muted small">Vérification…</div>';
    const st = await this.status();
    if (!st || !st.ok) {
      box.innerHTML = '<div class="muted small">Serveur joignable mais Polar non configuré : renseigne POLAR_CLIENT_ID et POLAR_CLIENT_SECRET sur le worker (voir deploy/worker/README.md).</div>';
      return;
    }
    if (state.polar.connected !== !!st.connected) { state.polar.connected = !!st.connected; save(); }
    if (!st.connected) {
      box.innerHTML =
        '<div class="muted small">Montre non connectée. L\'autorisation se fait sur polar.com ; le jeton reste sur le serveur.</div>' +
        '<div class="muted small">URL de redirection à déclarer chez Polar : <b>' + esc(st.callback) + '</b></div>' +
        '<div class="row-actions"><button class="btn primary" id="pl-connect">Connecter ma montre Polar</button></div>';
      const b = $("#pl-connect");
      if (b) b.addEventListener("click", () => { location.href = "api/polar/connect"; });
      return;
    }
    const last = st.lastSync ? new Date(st.lastSync).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "jamais";
    box.innerHTML =
      '<div class="muted small">Montre connectée — dernière synchro : ' + last + '. ' +
      'Les sorties, le sommeil, la recharge ANS/VFC (Nightly Recharge) et la charge cardio sont synchronisés à chaque ouverture de l\'app puis toutes les 5 minutes.</div>' +
      '<div class="note">Important : Polar ne transmet que les exercices <b>téléversés sur Polar Flow APRÈS le moment de la connexion</b> de la montre ici (et des 30 derniers jours). Si une sortie est visible dans l\'appli Flow mais pas ici : laisse la montre synchroniser avec le téléphone, puis reviens ici ou appuie sur « Importer les sorties ». Les exercices enregistrés et synchronisés avant la connexion ne seront jamais transmis — c\'est une règle Polar, pas de l\'app.</div>' +
      '<div class="row-actions">' +
      '<button class="btn primary" id="pl-import">Importer les sorties Polar</button>' +
      '<button class="btn" id="pl-profile">Actualiser le profil (FC max, FC repos, poids, VO2max)</button>' +
      '<button class="btn" id="pl-disconnect">Déconnecter</button></div>';
    const bi = $("#pl-import");
    if (bi) bi.addEventListener("click", async () => {
      bi.disabled = true; bi.textContent = "Import…";
      await PolarSync.import(true);
      PolarSync.renderBox();
    });
    const bp = $("#pl-profile");
    if (bp) bp.addEventListener("click", async () => {
      bp.disabled = true; bp.textContent = "Mise à jour…";
      try {
        const info = await PolarSync.refreshProfile();
        toast("Profil mis à jour depuis Polar" +
          (info.maximum_heart_rate ? " : FCM " + info.maximum_heart_rate : "") +
          (info.vo2_max ? ", VO2max " + info.vo2_max : "") + ".");
        renderSettings(); // rafraîchit les champs profil + zones
      } catch (e) { toast("Profil Polar impossible : " + e.message); bp.disabled = false; bp.textContent = "Actualiser le profil (FC max, FC repos, poids, VO2max)"; }
    });
    const bd = $("#pl-disconnect");
    if (bd) bd.addEventListener("click", () => { location.href = "api/polar/disconnect"; });
  }
};

/* retour d'OAuth Polar : #polar=ok | #polar=off | #polar=err (après rechargement) */
function importPolarHash() {
  const m = location.hash.match(/^#polar=(ok|off|err)$/);
  if (!m) return;
  history.replaceState(null, "", location.pathname + location.search);
  if (m[1] === "ok") {
    state.polar.connected = true;
    save();
    toast("Montre Polar connectée — import des sorties en cours…");
    setTimeout(() => PolarSync.auto(), 1500);
  } else if (m[1] === "off") {
    state.polar.connected = false;
    state.polar.lastSync = null;
    save();
    toast("Montre Polar déconnectée.");
  } else {
    toast("Échec de la connexion Polar — réessaie depuis Réglages.");
  }
}

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
    polar: newer.polar || older.polar || { connected: false, lastSync: null },
    polarNights: mergeByKey(a.polarNights, b.polarNights, newer === b),
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
  /* conversations coach : fusion par id, messages fusionnés par id à l'intérieur
     de chaque conversation — l'historique venant d'un autre appareil est ajouté,
     jamais écrasé */
  const convsA = convsOf(a), convsB = convsOf(b);
  out.convs = mergeById(convsA, convsB, newer === b).map(cv => {
    const ma = (convsA.find(x => x.id === cv.id) || { msgs: [] }).msgs || [];
    const mb = (convsB.find(x => x.id === cv.id) || { msgs: [] }).msgs || [];
    return Object.assign({}, cv, { msgs: mergeById(ma, mb, newer === b).slice(-200) });
  }).sort((x, y) => x.id - y.id);
  out.convId = out.convs.some(c => c.id === newer.convId) ? newer.convId :
    (out.convs.length ? out.convs[out.convs.length - 1].id : null);
  return out;
}
/* vue « conversations » d'un état (migration à la volée de l'ancien state.chat) */
function convsOf(st) {
  if (Array.isArray(st.convs)) return st.convs;
  const msgs = normalizeMsgs(Array.isArray(st.chat) ? st.chat.slice() : []);
  return msgs.length ? [{ id: 0, title: "Ancienne conversation", created: 0, msgs }] : [];
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
  c.chat = undefined;
  c.polar = st.polar || null;
  c.polarNights = {};
  Object.keys(st.polarNights || {}).sort().forEach(k => { c.polarNights[k] = st.polarNights[k]; });
  c.convs = (st.convs || []).slice().sort((x, y) => x.id - y.id)
    .map(cv => Object.assign({}, cv, { msgs: (cv.msgs || []).slice() }));
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
activateView("today");
importFromHash();
importPolarHash();
ServerSync.init();
offerResume();
checkLock();
slimOldTracks();
applyNav();
/* zoom verrouillé sur mobile : le pincement à deux doigts est désactivé
   (Safari iOS ignore user-scalable=no, on bloque donc les gestes) */
["gesturestart", "gesturechange", "gestureend"].forEach(ev =>
  document.addEventListener(ev, e => e.preventDefault(), { passive: false }));
/* application installable + démarrage hors ligne (PWA) */
if ("serviceWorker" in navigator && (location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname)))
  navigator.serviceWorker.register("sw.js").catch(() => {});
