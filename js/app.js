"use strict";
/* TrainingTrail — application principale (vanilla JS, données en localStorage) */

/* ================= état ================= */
const LS_KEY = "trainingtrail_v1";
let state = {
  start: DEFAULT_START,
  done: {},       // clé "w-d-i" -> true
  runs: [],       // sorties réelles + feedback
  shoes: [],
  seq: 1,
  lastWeekView: null,
  mistral: { key: "", model: "mistral-small-latest", url: "https://api.mistral.ai" },
  chat: []        // conversation coach : [{role, content}]
};

function save() { localStorage.setItem(LS_KEY, JSON.stringify(state)); }
function load() {
  try { const raw = localStorage.getItem(LS_KEY); if (raw) Object.assign(state, JSON.parse(raw)); }
  catch (e) { console.warn("Lecture localStorage impossible", e); }
  normalizeState();
}
function normalizeState() {
  if (!state.done) state.done = {};
  if (!state.runs) state.runs = [];
  if (!state.shoes) state.shoes = [];
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
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.add("hidden"), 3200);
}
function typeChip(code) {
  const ty = TYPES[code]; if (!ty) return "";
  const kindCls = { run: "c-run", strength: "c-str", bike: "c-bike", swim: "c-swim", yoga: "c-yoga", recovery: "c-rec", rest: "c-rest" }[ty.kind] || "";
  return '<span class="chip ' + kindCls + '">' + esc(ty.label) + "</span>";
}
function itemKey(w, d, i) { return w + "-" + d + "-" + i; }
function isDone(w, d, i) { return !!state.done[itemKey(w, d, i)]; }
function toggleDone(w, d, i) {
  const k = itemKey(w, d, i);
  if (state.done[k]) delete state.done[k]; else state.done[k] = true;
  save();
}
function allItems(week) {
  const out = [];
  week.days.forEach((day, d) => day.forEach((it, i) => out.push({ w: week.n, d, i, it })));
  return out;
}
function plannedMinutes(week) { return allItems(week).reduce((s, x) => s + (x.it.m || 0), 0); }
function doneMinutes(week) { return allItems(week).filter(x => isDone(x.w, x.d, x.i)).reduce((s, x) => s + (x.it.m || 0), 0); }
function weekProgressPct() {
  let total = 0, done = 0;
  WEEKS.forEach(w => allItems(w).forEach(x => { total++; if (isDone(x.w, x.d, x.i)) done++; }));
  return total ? Math.round(100 * done / total) : 0;
}
function totalPlannedMin() { return WEEKS.reduce((s, w) => s + plannedMinutes(w), 0); }
function totalDoneMin() { return WEEKS.reduce((s, w) => s + doneMinutes(w), 0); }

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
  else if (name === "program") renderProgram();
  else if (name === "exercises") renderExercises();
  else if (name === "runs") renderRuns();
  else if (name === "shoes") renderShoes();
  else if (name === "progress") renderProgress();
  else if (name === "coach") renderCoach();
  else if (name === "settings") renderSettings();
  updateHeader();
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
  const ty = TYPES[it.c] || {};
  const isRun = RUN_CODES.includes(it.c);
  const routineKey = { RMA: "A", RMB: "B", RMC: "C", GAING: "G" }[it.c];
  const attrs = [];
  if (it.dplus) attrs.push(it.dplus + " m D+");
  return '<div class="item ' + (done ? "done" : "") + '" data-key="' + key + '">' +
    '<label class="item-l"><input type="checkbox" ' + (done ? "checked" : "") + ' data-w="' + w + '" data-d="' + d + '" data-i="' + i + '">' +
    typeChip(it.c) +
    '<span class="item-txt">' + esc(it.t) + (attrs.length ? ' <span class="dplus">· ' + attrs.join(" · ") + "</span>" : "") + "</span></label>" +
    '<div class="item-actions">' +
    (ty.desc ? '<button class="icon-btn info" data-info="' + it.c + '" title="Détails de la séance">i</button>' : "") +
    (routineKey ? '<button class="mini-btn" data-routine="' + routineKey + '">Lancer</button>' : "") +
    (isRun && !opts.noRunBtn ? '<button class="mini-btn" data-goto-run="' + w + "-" + d + '">Sortie</button>' : "") +
    "</div></div>";
}

/* délégation globale pour les cases à cocher et boutons */
document.addEventListener("change", e => {
  if (e.target.matches('input[type="checkbox"][data-w]')) {
    const w = +e.target.dataset.w, d = +e.target.dataset.d, i = +e.target.dataset.i;
    toggleDone(w, d, i);
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
});

/* ---- modal info type de séance ---- */
function openInfo(code) {
  const ty = TYPES[code]; if (!ty) return;
  $("#info-title").textContent = ty.label;
  let body = "<p>" + esc(ty.desc) + "</p>";
  if (code === "RMA" || code === "RMB") {
    const list = EXERCISES.filter(x => x.routine === code.slice(-1));
    body += "<p class='muted'>Exercices : " + list.map(x => esc(x.name)).join(" · ") + "</p>";
  }
  body += '<div class="row-actions"><button class="btn" id="info-start">Lancer la séance</button></div>';
  $("#info-body").innerHTML = body;
  $("#info-modal").classList.remove("hidden");
  const rk = { RMA: "A", RMB: "B", RMC: "C", GAING: "G" }[code];
  const st = $("#info-start");
  if (rk) st.addEventListener("click", () => { $("#info-modal").classList.add("hidden"); startRoutine(rk); });
  else st.style.display = "none";
}
$("#info-close").addEventListener("click", () => $("#info-modal").classList.add("hidden"));

/* ================= vue : aujourd'hui ================= */
function renderToday() {
  const w = currentWeek(), idx = todayIdx(), week = WEEKS[w - 1];
  const dates = weekDates(w);
  const today = dates[idx];
  const items = week.days[idx].map((it, i) => ({ it, i }));
  const wDone = doneMinutes(week), wPlan = plannedMinutes(week);
  const j = daysBetween(isoDate(today), RACE.date);
  const runsToday = items.filter(x => RUN_CODES.includes(x.it.c));

  let html = '<div class="hero">' +
    '<div><div class="hero-date">' + fmtDate(today) + "</div>" +
    '<h2>Semaine ' + w + " — " + esc(blockOf(w).name) + (week.light ? ' <span class="badge light">allégée</span>' : "") + "</h2>" +
    '<div class="muted">Du ' + fmtDateShort(dates[0]) + " au " + fmtDateShort(dates[6]) + " · " + (j >= 0 ? "J−" + j + " avant la course" : "course passée") + "</div></div>" +
    '<div class="hero-weekbar">' + weekBar(w) + "</div></div>";

  html += '<h3>Ce que le programme te propose aujourd\'hui</h3>';
  html += '<div class="day-card today-card">';
  if (items.length === 0) html += '<div class="muted">Pas de séance programmée aujourd\'hui — récupération. Pense à la proprioception (5\') et à l\'automassage si ce n\'est pas déjà fait.</div>';
  items.forEach(x => { html += itemHTML(w, idx, x.i, x.it); });
  html += "</div>";

  html += '<h3>Commencer une séance de renforcement (même en décalé)</h3>';
  html += '<div class="row-actions strength-launch">' +
    '<button class="btn" data-routine="A">RM-A · Jambes & chaîne post. (30-35\')</button>' +
    '<button class="btn" data-routine="B">RM-B · Tronc, fessiers & cheville (25-30\')</button>' +
    '<button class="btn" data-routine="C">RM-C · Pliométrie (20\')</button>' +
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
    const doneCount = day.filter((_, i) => isDone(w, d, i)).length;
    html += '<div class="day-card ' + (d === idx ? "sel" : "") + '"><div class="day-head">' +
      '<span>' + DAY_NAMES[d].slice(0, 3) + ' <span class="muted">' + fmtDateShort(dates[d]) + "</span></span>" +
      (day.length ? '<span class="count">' + doneCount + "/" + day.length + "</span>" : '<span class="muted">—</span>') + "</div>" +
      day.map((it, i) => '<div class="mini-item ' + (isDone(w, d, i) ? "done" : "") + '">' + typeChip(it.c) + "<span>" + esc(it.t) + "</span></div>").join("") +
      (day.length ? "" : '<div class="muted mini-item">repos</div>') + "</div>";
  });
  html += "</div>";

  html += '<div class="stat-cards">' +
    '<div class="stat"><span>' + fmtHours(wDone) + " / " + fmtHours(wPlan) + ' h</span><label>volume réalisé / planifié (min)</label></div>' +
    '<div class="stat"><span>' + esc(String(week.vol)).replace(".", ",") + ' h</span><label>volume indicatif de la semaine</label></div>' +
    '<div class="stat"><span>' + state.runs.length + '</span><label>sorties enregistrées</label></div>' +
    "</div>";

  html += '<div class="note">' + PAIN_RULE + "</div>";
  $("#view-today").innerHTML = html;

  const rec = $("#today-record");
  if (rec) rec.addEventListener("click", () => { showView("runs"); setTimeout(startRecording, 80); });
}

function weekBar(w) {
  const week = WEEKS[w - 1];
  const plan = plannedMinutes(week), done = doneMinutes(week);
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
    html += '<button class="wsel ' + (wk.n === cur ? "active" : "") + '" data-w="' + wk.n + '" style="--c:' + b.color + '" title="' + esc(b.name) + (wk.light ? " (allégée)" : "") + '">S' + wk.n + "</button>";
  });
  html += '</div><button class="icon-btn" id="wnext">▶</button>' +
    '<button class="btn" id="wback">Semaine actuelle</button></div>';
  const week = WEEKS[cur - 1], dates = weekDates(cur), b = blockOf(cur);
  const plan = plannedMinutes(week), done = doneMinutes(week);

  html += '<div class="week-head"><h2>S' + cur + " — " + esc(b.name) + (week.light ? ' <span class="badge light">allégée</span>' : "") + "</h2>" +
    '<div class="muted">' + fmtDate(dates[0]) + " → " + fmtDate(dates[6]) + "</div></div>";
  html += '<div class="stat-cards">' +
    '<div class="stat"><span>' + esc(String(week.vol)).replace(".", ",") + ' h</span><label>volume planifié (indicatif)</label></div>' +
    '<div class="stat"><span>' + fmtHours(done) + " / " + fmtHours(plan) + ' h</span><label>réalisé / planifié (somme des minutes cochées)</label></div>' +
    "</div>";
  html += '<div class="note">Proprio 5\' chaque matin (notamment mardi, mercredi, vendredi) · automassage 5\' (fessier, TFL, essuie-glace).</div>';
  html += '<div class="week-grid big">';
  week.days.forEach((day, d) => {
    html += '<div class="day-card"><div class="day-head"><span>' + DAY_NAMES[d] + ' <span class="muted">' + fmtDateShort(dates[d]) + "</span></span>" +
      (day.length ? '<span class="count">' + day.filter((_, i) => isDone(cur, d, i)).length + "/" + day.length + "</span>" : "") + "</div>";
    if (day.length) day.forEach((it, i) => { html += itemHTML(cur, d, i, it); });
    else html += '<div class="muted mini-item">repos</div>';
    html += "</div>";
  });
  html += "</div>";

  html += "<h3>Blocs du programme</h3><div class='blocks'>" + BLOCKS.map(bl =>
    '<div class="block-card" style="--c:' + bl.color + '"><b>Bloc ' + bl.n + "</b> · " + esc(bl.name) +
    ' <span class="muted">S' + bl.weeks[0] + "–S" + bl.weeks[1] + "</span></div>").join("") + "</div>";

  $("#view-program").innerHTML = html;
  $$("button.wsel").forEach(btn => btn.addEventListener("click", () => { state.lastWeekView = +btn.dataset.w; save(); renderProgram(); }));
  $("#wprev").addEventListener("click", () => { state.lastWeekView = Math.max(1, cur - 1); save(); renderProgram(); });
  $("#wnext").addEventListener("click", () => { state.lastWeekView = Math.min(29, cur + 1); save(); renderProgram(); });
  $("#wback").addEventListener("click", () => { state.lastWeekView = currentWeek(); save(); renderProgram(); });
}

/* ================= vue : exercices ================= */
function renderExercises() {
  let html = "";
  ["A", "B"].forEach(r => {
    const list = EXERCISES.filter(e => e.routine === r);
    const title = r === "A" ? "RM-A — Jambes et chaîne postérieure (lundi matin, 30-35')" : "RM-B — Tronc, fessiers et cheville (jeudi matin, 25-30')";
    const subtitle = r === "A" ? "Faites chaque répétition lentement : quelques répétitions propres valent mieux qu'une série bâclée. Lestez en bloc 2 quand 20 répétitions sont faciles."
                              : "La routine anti-essuie-glace et anti-entorse. À faire deux fois par semaine, sans exception, toute l'année.";
    html += '<h3>' + esc(title) + '</h3><div class="muted sub">' + esc(subtitle) + "</div>";
    html += '<div class="exo-grid">';
    list.forEach(ex => {
      html += '<div class="exo-card">' + figureHTML(ex.id) +
        '<div class="exo-body"><h4>' + esc(ex.name) + "</h4>" +
        '<div class="muscles">' + esc(ex.muscles) + "</div>" +
        '<div class="sets">' + esc(ex.sets) + "</div>" +
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
function renderExoModal() {
  const ex = exoQueue[exoPos];
  const cfg = ex.timer || { mode: "reps", rest: 60, sets: 3 };
  $("#exo-title").textContent = ex.name;
  $("#exo-body").innerHTML =
    '<div class="exo-detail">' + figureHTML(ex.id) +
    '<div class="exo-detail-txt"><div class="muscles">' + esc(ex.muscles) + "</div>" +
    "<p>" + esc(ex.desc) + "</p>" +
    "<p><b>Prescription : " + esc(ex.sets) + "</b></p>" +
    (ex.tip ? "<p class='tip'>" + esc(ex.tip) + "</p>" : "") +
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
    });
  });
  const prev = $("#exo-prev"), next = $("#exo-next");
  if (prev) prev.addEventListener("click", () => { exoPos--; renderExoModal(); });
  if (next) next.addEventListener("click", () => { exoPos++; renderExoModal(); });
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
    return { name: ex.name, muscles: ex.muscles, sets: st.alt || ex.sets, desc: ex.desc, tip: ex.tip, fig: ex.id, timer: ex.timer, series: (ex.timer && ex.timer.sets) || 3 };
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
    openTimer(s.name, { mode: t.mode || "interval", work: t.work, rest: t.rest, reps: t.reps || 1, sets: t.sets || 1, setrest: t.setrest || t.rest || 60 });
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
    (doneAlready ? "" : '<button class="btn primary" id="pl-mark">Cocher la séance ' + esc(TYPES[r.code].label) + " comme faite</button>") +
    '<button class="btn" id="pl-close2">Fermer</button>';
  const mk = $("#pl-mark");
  if (mk) mk.addEventListener("click", () => { markRoutineDone(r.code); mk.disabled = true; mk.textContent = "Séance cochée ✔"; });
  $("#pl-close2").addEventListener("click", () => $("#player-modal").classList.add("hidden"));
}
function firstItemOfCode(code) {
  const w = currentWeek(), week = WEEKS[w - 1];
  for (let d = 0; d < 7; d++)
    for (let i = 0; i < week.days[d].length; i++)
      if (week.days[d][i].c === code && !isDone(w, d, i)) return { w, d, i };
  return null;
}
function markRoutineDone(code) {
  const f = firstItemOfCode(code);
  if (!f) { toast("La séance " + TYPES[code].label + " est déjà cochée cette semaine."); return; }
  state.done[itemKey(f.w, f.d, f.i)] = true;
  save();
  toast("Séance " + TYPES[code].label + " cochée (décalée au " + DAY_NAMES[f.d] + ").");
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
  set: 1, rep: 1, iv: null, label: "", repsModeSet: 1
};
function openTimer(label, cfg) {
  Timer.cfg = Object.assign({ work: 30, rest: 30, reps: 10, sets: 3, setrest: 120, mode: "interval" }, cfg);
  Timer.mode = Timer.cfg.mode || "interval";
  Timer.run = false; Timer.phase = "idle"; Timer.set = 1; Timer.rep = 1; Timer.repsModeSet = 1;
  Timer.label = label;
  $("#timer-title").textContent = label;
  const show = id => ["cfg-work", "cfg-rest", "cfg-reps", "cfg-sets", "cfg-setrest"].map(s => $("#cfg-" + s).parentElement).forEach(l => l.style.display = id ? "" : "none");
  if (Timer.mode === "interval") show(true);
  else if (Timer.mode === "hold") { show(true); }
  else show(false); // reps : pas de config, bouton "série faite"
  $("#cfg-work").value = Timer.cfg.work;
  $("#cfg-rest").value = Timer.cfg.rest;
  $("#cfg-reps").value = Timer.cfg.reps;
  $("#cfg-sets").value = Timer.cfg.sets;
  $("#cfg-setrest").value = Timer.cfg.setrest;
  $("#timer-done").style.display = Timer.mode === "reps" ? "" : "none";
  $("#timer-modal").classList.remove("hidden");
  Timer.remain = Timer.mode === "reps" ? 0 : Timer.cfg.work;
  paintTimer(Timer.mode === "reps" ? "Fais ta série, puis « Série faite »" : "Prêt",
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
  if (!Timer.iv) Timer.iv = setInterval(tickTimer, 200);
  beep(phase === "work" ? 880 : 440, 0.18);
  paintTimerPhase();
}
function tickTimer() {
  if (!Timer.run) return;
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
    beep(880, 0.15);
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
  beep(1320, 0.4); setTimeout(() => beep(1320, 0.4), 450); setTimeout(() => beep(1760, 0.6), 900);
  $("#timer-phase").textContent = "Terminé — bien joué !";
}
function paintTimer(phase, remain, round) {
  if (phase) $("#timer-phase").textContent = phase;
  if (round) $("#timer-round").textContent = round;
  $("#timer-clock").textContent = fmtDur(remain);
  $("#timer-clock").className = "timer-clock " + (Timer.phase === "work" ? "t-work" : Timer.phase === "rest" ? "t-rest" : "");
}
function paintTimerPhase() {
  const names = { work: "Effort", rest: "Récupération", prep: "Préparation", idle: "Prêt", ready: "Fais ta série, puis « Série faite »", over: "Terminé" };
  let round = "Série " + Timer.set + "/" + Timer.cfg.sets;
  if (Timer.mode === "interval") round += " — répétition " + Timer.rep + "/" + Timer.cfg.reps;
  else if (Timer.mode === "reps") round = "Série " + Timer.repsModeSet + "/" + Timer.cfg.sets;
  paintTimer(names[Timer.phase] || Timer.phase, Timer.remain, round);
}
function stopTimer() {
  Timer.run = false;
  if (Timer.iv) { clearInterval(Timer.iv); Timer.iv = null; }
}
$("#timer-startstop").addEventListener("click", () => {
  if (Timer.run) { Timer.run = false; $("#timer-startstop").textContent = "Reprendre"; return; }
  readCfg();
  if (Timer.mode === "reps") {
    // mode "série faite" : pas de décompte pendant l'effort, l'utilisateur coche lui-même
    Timer.phase = "ready"; Timer.remain = 0;
    $("#timer-startstop").textContent = "Démarrer";
    paintTimerPhase();
  } else {
    Timer.run = true;
    $("#timer-startstop").textContent = "Pause";
    if (Timer.phase === "idle" || Timer.phase === "over") { Timer.set = 1; Timer.rep = 1; startPhase("prep", 10); }
    else { Timer.endAt = Date.now() + Timer.remain * 1000; }
  }
});
$("#timer-reset").addEventListener("click", () => {
  stopTimer();
  Timer.phase = "idle"; Timer.set = 1; Timer.rep = 1; Timer.repsModeSet = 1; Timer.remain = Timer.cfg.work;
  $("#timer-startstop").textContent = "Démarrer";
  paintTimer("Prêt", Timer.cfg.work, "Série 1 — répétition 1");
});
$("#timer-done").addEventListener("click", () => {
  // "ma série est faite" : lance la récupération, puis attend la série suivante
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
$("#timer-close").addEventListener("click", () => { stopTimer(); $("#timer-modal").classList.add("hidden"); });
/* bip WebAudio */
let actx = null;
function beep(freq, dur) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain();
    o.frequency.value = freq; o.type = "sine";
    g.gain.setValueAtTime(0.3, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + dur);
    o.connect(g).connect(actx.destination);
    o.start(); o.stop(actx.currentTime + dur);
  } catch (e) { /* audio indisponible */ }
}
// décompte : bips dans les 3 dernières secondes de travail
setInterval(() => {
  if (Timer.run && Timer.remain > 0 && Timer.remain <= 3 && (Timer.phase === "work" || Timer.phase === "rest")) beep(600, 0.08);
}, 1000);

/* ================= vue : sorties ================= */
let recTimerIv = null;
function renderRuns() {
  const w = currentWeek(), idx = todayIdx(), week = WEEKS[w - 1];
  const runsToday = week.days[idx].filter(it => RUN_CODES.includes(it.c));
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
    '<div class="rec-stat"><span id="rec-dplus">0 m</span><label>D+ cumulé</label></div>' +
    '<div class="rec-stat"><span id="rec-ele">—</span><label>Altitude</label></div>' +
    '<div class="rec-stat"><span id="rec-acc">—</span><label>Précision GPS</label></div>' +
    "</div>" +
    '<div class="row-actions"><button class="btn primary" id="rec-start">Démarrer l\'enregistrement</button>' +
    '<button class="btn" id="rec-pause" disabled>Pause</button>' +
    '<button class="btn danger" id="rec-stop" disabled>Terminer et noter la sortie</button>' +
    '<button class="btn" id="rec-cancel" disabled>Annuler</button></div>' +
    '<div class="muted small" id="rec-note">Nécessite l\'autorisation de géolocalisation. Précis sur smartphone ; sur ordinateur, préfère l\'import d\'un fichier GPX.</div>' +
    "</div>";

  /* formulaire feedback */
  html += '<div class="run-form"><h3>Ma sortie réelle — feedback</h3>' +
    '<div class="form-grid">' +
    '<label>Date <input type="date" id="rf-date" value="' + isoDate(new Date()) + '"></label>' +
    '<label>Type de séance <select id="rf-code">' +
      RUN_CODES.map(c => '<option value="' + c + '">' + esc(TYPES[c].label) + "</option>").join("") +
      '<option value="AUTRE">Autre</option></select></label>' +
    '<label>Distance (km) <input type="number" id="rf-dist" step="0.01" min="0"></label>' +
    '<label>Durée (min) <input type="number" id="rf-dur" step="1" min="0"></label>' +
    '<label>D+ (m) <input type="number" id="rf-dplus" step="1" min="0"></label>' +
    '<label>Chaussures <select id="rf-shoe"><option value="">—</option>' +
      state.shoes.filter(s => !s.retired).map(s => '<option value="' + s.id + '">' + esc(s.name) + "</option>").join("") + "</select></label>" +
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
    stat(r.feel ? r.feel + "/10" : "—", "sensations") +
    stat(r.knee != null ? r.knee + "/10" : "—", "essuie-glace") +
    stat(r.ankle != null ? r.ankle + "/10" : "—", "cheville") +
    "</div>" +
    (shoe ? '<div class="muted small">Chaussures : ' + esc(shoe.name) + "</div>" : "") +
    (r.notes ? '<div class="run-notes">' + esc(r.notes) + "</div>" : "") +
    (r.points && r.points.length > 1 ? Geo.profileSVG(r.points) : "") +
    '<div class="row-actions">' +
    (r.points && r.points.length > 1 ? '<button class="btn" data-export="' + r.id + '">Exporter le GPX</button>' : "") +
    "</div></div>";
  return html;
}
function stat(v, label) { return '<div class="run-stat"><span>' + v + "</span><label>" + label + "</label></div>"; }

function bindRunsEvents(sorted) {
  $("#rec-start").addEventListener("click", startRecording);
  $("#rec-stop").addEventListener("click", stopRecording);
  $("#rec-cancel").addEventListener("click", cancelRecording);
  $("#rf-save").addEventListener("click", saveRunFromForm);
  $$("button[data-open-timer]").forEach(b => b.addEventListener("click", () => {
    const ty = TYPES[b.dataset.openTimer];
    if (ty.timer) openTimer("Séance " + ty.label, ty.timer);
  }));
  $$("button[data-del]").forEach(b => b.addEventListener("click", () => {
    if (!confirm("Supprimer cette sortie ?")) return;
    state.runs = state.runs.filter(r => r.id !== +b.dataset.del);
    save(); renderRuns();
  }));
  $$("button[data-edit]").forEach(b => b.addEventListener("click", () => openEditRun(+b.dataset.edit)));
  $$("button[data-export]").forEach(b => b.addEventListener("click", () => {
    const r = state.runs.find(x => x.id === +b.dataset.export);
    if (r) Geo.download("sortie-" + r.date + ".gpx", Geo.toGpx("Sortie " + r.date, r.points));
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
          shoeId: null, points: pts, planned: null
        };
        state.runs.push(run); save();
        toast("GPX importé : " + s.dist.toFixed(1) + " km, " + s.dplus + " m D+");
      } catch (err) { toast("Erreur GPX : " + err.message); }
    }
    renderRuns();
  });
}

function prefillRunFormFromItem(w, d) {
  const week = WEEKS[w - 1], day = week.days[d];
  const runItems = day.filter(it => RUN_CODES.includes(it.c) && it.c !== "GAM" && it.c !== "LD");
  if (!runItems.length) return;
  const it = runItems[0];
  $("#rf-date").value = isoDate(weekDates(w)[d]);
  $("#rf-code").value = it.c;
  if (it.dplus) $("#rf-dplus").value = it.dplus;
  if (it.m) $("#rf-dur").value = it.m;
  $("#rf-notes").focus();
  toast("Formulaire pré-rempli avec la séance prévue : " + it.t);
}

function startRecording() {
  Recorder.start(live => {
    $("#rec-time").textContent = fmtDur(live.dur);
    $("#rec-dist").textContent = live.dist.toFixed(2).replace(".", ",") + " km";
    $("#rec-speed").textContent = live.speed.toFixed(1).replace(".", ",") + " km/h";
    $("#rec-dplus").textContent = live.dplus + " m";
    $("#rec-ele").textContent = live.ele != null ? Math.round(live.ele) + " m" : "—";
    $("#rec-acc").textContent = live.acc ? "± " + Math.round(live.acc) + " m" : "—";
  }).then(() => {
    $("#rec-start").disabled = true;
    $("#rec-stop").disabled = false;
    $("#rec-note").textContent = "Enregistrement en cours… Garde l'écran allumé pour un meilleur suivi GPS.";
    recTimerIv = setInterval(() => {
      if (Recorder.watchId == null) return;
      const live = Recorder.live();
      $("#rec-time").textContent = fmtDur(live.dur);
    }, 1000);
    toast("Enregistrement GPS démarré");
  }).catch(err => {
    toast("GPS indisponible (" + err.message + "). Sert le site en HTTPS/localhost ou importe un GPX.");
  });
}

function stopRecording() {
  const pts = Recorder.stop();
  clearInterval(recTimerIv);
  $("#rec-start").disabled = false;
  $("#rec-stop").disabled = true;
  $("#rec-cancel").disabled = true;
  $("#rec-note").textContent = "Enregistrement arrêté.";
  if (pts.length < 2) { toast("Pas assez de points enregistrés."); return; }
  const s = Geo.stats(pts);
  $("#rf-dist").value = Math.round(s.dist * 100) / 100;
  $("#rf-dur").value = Math.round(s.dur / 60);
  $("#rf-dplus").value = s.dplus;
  $("#rf-points").value = "captured";
  pendingPoints = pts;
  toast("Trace enregistrée (" + s.dist.toFixed(1) + " km, " + s.dplus + " m D+). Complète le feedback.");
}

function cancelRecording() {
  if (!confirm("Annuler l'enregistrement ? La trace GPS sera perdue.")) return;
  Recorder.stop();
  clearInterval(recTimerIv);
  pendingPoints = null;
  $("#rec-start").disabled = false;
  $("#rec-stop").disabled = true;
  $("#rec-cancel").disabled = true;
  ["rec-time", "rec-dist", "rec-speed", "rec-dplus"].forEach(id => $("#" + id).textContent = id === "rec-dist" ? "0,00 km" : id === "rec-dplus" ? "0 m" : id === "rec-speed" ? "0,0 km/h" : "00:00:00");
  $("#rec-ele").textContent = "—"; $("#rec-acc").textContent = "—";
  $("#rec-note").textContent = "Enregistrement annulé.";
  toast("Enregistrement annulé.");
}

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
  r.feel = $("#ed-feel").value ? +$("#ed-feel").value : null;
  r.knee = $("#ed-knee").value !== "" ? +$("#ed-knee").value : null;
  r.ankle = $("#ed-ankle").value !== "" ? +$("#ed-ankle").value : null;
  r.notes = $("#ed-notes").value.trim();
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
  const w = weekOfDate(date);
  const dayItems = WEEKS[w - 1].days[dayIndexOfDate(date)];
  const plannedRun = dayItems.find(it => RUN_CODES.includes(it.c) && it.c !== "GAM" && it.c !== "LD");
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
    shoeId: $("#rf-shoe").value ? +$("#rf-shoe").value : null,
    points: (pendingPoints && pendingPoints.length > 1) ? pendingPoints : null,
    planned: plannedRun ? plannedRun.t : null
  };
  state.runs.push(run);
  save();
  pendingPoints = null;
  ["#rf-dist", "#rf-dur", "#rf-dplus", "#rf-feel", "#rf-knee", "#rf-ankle", "#rf-notes"].forEach(s => $(s).value = "");
  toast("Sortie enregistrée. Bien joué !");
  renderRuns();
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
  const totalItems = WEEKS.reduce((a, w) => a + allItems(w).length, 0);
  const doneItems = Object.keys(state.done).length;
  const planMin = totalPlannedMin(), doneMin = totalDoneMin();
  const totDays = Math.max(1, daysBetween(state.start, RACE.date));
  const elDays = Math.max(0, Math.min(totDays, daysBetween(state.start, isoDate(new Date()))));
  const km = state.runs.reduce((a, r) => a + (r.dist || 0), 0);
  const dplus = state.runs.reduce((a, r) => a + (r.dplus || 0), 0);

  let html = "<h2>Progression</h2>";

  html += '<div class="stat-cards big-cards">' +
    '<div class="stat"><span>' + Math.round(100 * elDays / totDays) + ' %</span><label>temps écoulé (J' + (elDays - totDays <= 0 ? "−" + (totDays - elDays) : "+" + (elDays - totDays)) + ")</label></div>" +
    '<div class="stat"><span>' + doneItems + " / " + totalItems + '</span><label>séances cochées</label></div>' +
    '<div class="stat"><span>' + fmtHours(doneMin) + " / " + fmtHours(planMin) + ' h</span><label>volume réalisé / planifié</label></div>' +
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
    const dm = doneMinutes(w) / 60;
    const hDone = (dm / maxVol) * 150;
    html += '<rect x="' + x + '" y="' + (180 - hPlan) + '" width="18" height="' + hPlan + '" rx="3" class="vol-plan" style="--c:' + blockOf(w.n).color + '"/>';
    if (hDone > 0) html += '<rect x="' + (x + 2) + '" y="' + (180 - hDone) + '" width="14" height="' + hDone + '" rx="2" class="vol-done"/>';
    html += '<text x="' + (x + 9) + '" y="195" text-anchor="middle" class="vol-label' + (w.n === cw ? " cur" : "") + '">S' + w.n + "</text>";
    if (w.light) html += '<circle cx="' + (x + 9) + '" cy="202" r="2" class="vol-light"/>';
  }
  html += '<line x1="25" y1="180" x2="940" y2="180" class="vol-axis"/></svg>';
  html += '<div class="legend"><span class="lg"><i class="vol-plan" style="--c:#3d6ea5"></i> planifié (h)</span><span class="lg"><i class="vol-done"></i> réalisé (séances cochées, h)</span><span class="lg"><i class="vol-light"></i> semaine allégée</span></div>';

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
  html += "<li class='" + (s25sl ? "ok" : "") + "'>Sortie longue de S25 (3 h 30 à allure course) terminée avec le sourire et les jambes</li>";
  const b4knee = state.runs.filter(r => r.knee != null && weekOfDate(r.date) >= 22 && weekOfDate(r.date) <= 25 && r.knee > 2).length === 0 && state.runs.some(r => weekOfDate(r.date) >= 22);
  html += "<li class='" + (b4knee ? "ok" : "") + "'>Aucune douleur essuie-glace > 2/10 dans le bloc 4 (S22-S25)</li>";
  html += "<li>60-90 g de glucides/heure avalés sans dégoût sur les trois dernières sorties longues</li><li>L'envie d'y être déjà.</li></ul>";

  $("#view-progress").innerHTML = html;
}

/* ================= vue : coach IA (Mistral) ================= */
const COACH_SUGGESTIONS = [
  "Où j'en suis, coach ?",
  "Analyse mes dernières sorties",
  "Je n'ai pas pu faire ma sortie longue, comment j'ajuste ?",
  "Ma douleur essuie-glace revient en descente, que faire ?",
  "Que dois-je tester au ravitaillement sur la prochaine sortie longue ?"
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

/* ================= vue : réglages ================= */
function renderSettings() {
  $("#view-settings").innerHTML =
    "<h2>Réglages</h2>" +
    "<h3>Programme</h3>" +
    '<div class="form-grid">' +
    '<label>Début du programme (lundi S1) <input type="date" id="st-start" value="' + state.start + '"></label>' +
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
    "Pense à exporter régulièrement une sauvegarde.</div>";

  $("#st-save").addEventListener("click", () => {
    state.start = $("#st-start").value || DEFAULT_START;
    state.mistral.key = $("#st-key").value.trim();
    state.mistral.model = $("#st-model").value;
    state.mistral.url = $("#st-url").value.trim() || "https://api.mistral.ai";
    save(); toast("Réglages enregistrés."); updateHeader(); renderToday();
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
    state = { start: DEFAULT_START, done: {}, runs: [], shoes: [], seq: 1, lastWeekView: null, mistral: keep, chat: [] };
    save(); toast("Données effacées."); renderSettings(); updateHeader();
  });
}

/* ================= démarrage ================= */
renderToday();
updateHeader();
