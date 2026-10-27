"use strict";
/* Données du programme d'entraînement — Trail des Forts 72 km, Besançon, 9 mai 2027.
   Transcrit depuis programme_entrainement_trail_des_forts.tex */

const RACE = {
  name: "Trail des Forts",
  dist: 72,          // km
  dplus: 2800,       // m D+
  date: "2027-05-09",
  city: "Besançon",
  note: "Barrières horaires : 6,2 km/h de moyenne. Objectif : terminer en 10 h 30 – 11 h 30."
};

const DEFAULT_START = "2026-10-19"; // lundi de la semaine 1

/* item : { s: slot (matin|midi|autre), c: code, m: minutes indicatives, t: texte, dplus } */
const I = (s, c, m, t, o) => Object.assign({ s, c, m, t }, o || {});

const BLOCKS = [
  { n: 1, weeks: [1, 6],   name: "Fondation",    color: "#3d6ea5" },
  { n: 2, weeks: [7, 14],  name: "Développement", color: "#2f7fbf" },
  { n: 3, weeks: [15, 21], name: "Spécifique I", color: "#1a8fa8" },
  { n: 4, weeks: [22, 25], name: "Pic spécifique", color: "#0e7d7d" },
  { n: 5, weeks: [26, 29], name: "Affûtage",     color: "#008b76" }
];

const TYPES = {
  RMA:   { label: "RM-A", kind: "strength", desc: "Routine jambes & chaîne postérieure (squat, fente, step-up, bulgare, pont fessier, mollets, excentrique)." },
  RMB:   { label: "RM-B", kind: "strength", desc: "Routine tronc, fessiers & cheville — anti-essuie-glace et anti-entorse (planche, planche latérale, dead bug, bird dog, proprio, monstre)." },
  RMC:   { label: "RM-C", kind: "strength", desc: "Pliométrie et gammes : montées de genoux, talons-fesses, foulées bondissantes, squats sautés, sauts de galet. Sur herbe ou sol souple." },
  CORDE: { label: "Corde", kind: "jump", desc: "Corde à sauter : travail de pliométrie douce, de coordination et de cheville (proprioception dynamique). Idéal en échauffement ou en séance courte à la maison." },
  GAING: { label: "Gainage", kind: "strength", desc: "Gainage léger (affûtage) : planche, planche latérale, gainage dynamique doux." },
  PROP:  { label: "Proprioception", kind: "strength", desc: "Proprioception unipodale 30'' par jambe, 3 séries. Tous les jours en bloc 1, puis 2-3 fois/semaine." },
  MAS:   { label: "Automassage", kind: "recovery", desc: "Rouleau ou balle : fessier, TFL, extérieur de cuisse (essuie-glace), puis étirements doux 20-30'' par groupe." },
  NAT:   { label: "Natation", kind: "swim", desc: "40-45' : récupération active et travail respiratoire." },
  YOGA:  { label: "Yoga", kind: "yoga", desc: "Hatha yoga : mobilité, respiration, gainage doux." },
  EV:    { label: "EV", kind: "run", desc: "Endurance vallonnée : 6-8 km à la pause du midi avec 200-300 m D+, 65-75 % FCM." },
  EP:    { label: "EP", kind: "run", desc: "Endurance sur le plat : footing souple, 65-75 % FCM." },
  SQ1:   { label: "SQ1 VMA", kind: "run", desc: "10 à 16 × 30'' fort / 30'' lent (90-95 % FCM), en côte dès S9. Échauffement 15', retour au calme 10'.", timer: { work: 30, rest: 30, reps: 16, sets: 1, setrest: 120 } },
  SQ2:   { label: "SQ2 Côtes", kind: "run", desc: "4 à 10 montées de 1' à 3' (tempo élevé mais contrôlé), récup en descente en marchant puis en trottinant." },
  SQ3:   { label: "SQ3 Seuil", kind: "run", desc: "2 à 4 blocs de 8' à 12' à allure semi-marathon (80-88 % FCM), récup = un tiers du temps d'effort.", timer: { work: 600, rest: 180, reps: 1, sets: 3, setrest: 0 } },
  SQ4:   { label: "SQ4 Fartlek", kind: "run", desc: "45' de course continue sur terrain vallonné en alternant librement les allures : accélérations en côte, relâchement en descente." },
  DT:    { label: "DT Descentes", kind: "run", desc: "Descentes techniques dans le footing : regard 3-5 m devant, pas courts, cadence élevée, buste légèrement penché en avant, bras larges." },
  GAM:   { label: "Gammes", kind: "run", desc: "2-3 × 20'' de chaque : montées de genoux, talons-fesses, foulées bondissantes, puis 3-4 lignes droites progressives." },
  LD:    { label: "Lignes droites", kind: "run", desc: "3-4 lignes droites progressives après le footing." },
  V:     { label: "Vélo", kind: "bike", desc: "Équivalence : 1 h de course = 1 h 30 de vélo. Idéal en famille." },
  CAP:   { label: "CAP", kind: "run", desc: "Course à pied (souvent en enchaînement après le vélo)." },
  SL:    { label: "Sortie longue", kind: "run", desc: "1 semaine sur 2 : test du matériel et du ravitaillement. Chaque sortie longue est une répétition générale." },
  REST:  { label: "Repos", kind: "rest", desc: "Repos." },
  AUTRE: { label: "Autre", kind: "run", desc: "Sortie libre." },
  RACE:  { label: "COURSE", kind: "run", desc: "Jour J : 72 km, 2 800 m D+. Rien de neuf, jamais." }
};

const RUN_CODES = ["EV", "EP", "SQ1", "SQ2", "SQ3", "SQ4", "DT", "SL", "CAP", "RACE", "LD", "GAM"];

/* types de route/terrain pour les sorties */
const ROUTES = [
  { id: "route",   label: "Route / bitume" },
  { id: "chemin",  label: "Chemin forestier" },
  { id: "sentier", label: "Sentier technique" },
  { id: "prairie", label: "Sol souple / prairie" },
  { id: "tapis",   label: "Tapis de course" },
  { id: "mixte",   label: "Mixte" }
];
function routeLabel(id) { const r = ROUTES.find(x => x.id === id); return r ? r.label : ""; }

/* ---------- constructeurs ---------- */
const lundi = (rma, nat) => [
  I("matin", "RMA", rma, "RM-A " + rma + "' (+ proprio 5')"),
  I("autre", "NAT", nat || 40, "Natation " + (nat || 40) + "'"),
  I("midi", "YOGA", 45, "Hatha yoga")
];
const lundiGain = (min, nat) => [
  I("matin", "GAING", min, "Gainage " + min + "'"),
  I("autre", "NAT", nat || 40, "Natation " + (nat || 40) + "'"),
  I("midi", "YOGA", 45, "Hatha yoga")
];
const rmb = (m) => [I("matin", "RMB", m, "RM-B " + m + "'")];
const evdt = (ev, dtTxt) => dtTxt
  ? [I("midi", "EV", ev, "EV " + ev + "'"), I("midi", "DT", 0, "+ DT : " + dtTxt)]
  : [I("midi", "EV", ev, "EV " + ev + "'")];
const ep = (m) => [I("midi", "EP", m, "EP " + m + "'")];
const v = (m, extra) => [I("autre", "V", m, "Vélo " + fmtMin(m) + (extra ? " " + extra : ""))];
const sl = (m, dplus, extra) => [I("autre", "SL", m, "Sortie longue " + fmtMin(m) + " — " + dplus + " m D+" + (extra ? " " + extra : ""), { dplus })];
function fmtMin(m) {
  if (m < 60) return m + "'";
  const h = Math.floor(m / 60), r = m % 60;
  return h + " h" + (r ? " " + (r < 10 ? "0" : "") + r + "'" : "");
}

/* ---------- les 29 semaines ---------- */
const WEEKS = [
  { n: 1, vol: 4.5, light: false, days: [
    lundi(30), [], [I("midi", "EV", 45, "EV 45' — 250 m D+", { dplus: 250 })], rmb(25),
    ep(45), v(60, "souple"), sl(75, 300)
  ]},
  { n: 2, vol: 5, light: false, days: [
    lundi(30), [I("matin", "CORDE", 10, "Corde à sauter 10' : 3 × 1' (récup 30'')")], [I("midi", "SQ1", 45, "VMA : 2 × (8 × 30''/30'') — fractionné court")], rmb(25),
    ep(45), v(75), [I("autre", "V", 90, "Vélo 1 h 30 ou CAP 1 h")]
  ]},
  { n: 3, vol: 5, light: false, days: [
    lundi(30), [I("matin", "CORDE", 10, "Corde à sauter 10' : 2 × 3 × 30'' pas alternés")], [I("midi", "SQ2", 50, "Côtes : 6 × 1' en côte (fractionné progressif)")], rmb(25),
    ep(45), v(75), sl(90, 400)
  ]},
  { n: 4, vol: 4, light: true, days: [
    lundi(25), [I("matin", "CORDE", 8, "Corde à sauter 8' douce (récupération active)")], [I("midi", "EV", 45, "EV 45' souple")], rmb(20),
    ep(40), v(60), [I("autre", "V", 90, "Vélo 1 h 30"), I("autre", "LD", 0, "+ lignes droites")]
  ]},
  { n: 5, vol: 5.5, light: false, days: [
    lundi(30), [I("matin", "CORDE", 10, "Corde à sauter 10' : 3 × 1' + gammes")], [I("midi", "SQ1", 50, "VMA : 2 × (6 × 45''/45'') en côte légère")], rmb(25),
    ep(45), v(90), sl(120, 500)
  ]},
  { n: 6, vol: 6, light: false, days: [
    lundi(30), [I("matin", "CORDE", 10, "Corde à sauter 10' : 4 × 1' (récup 30'')")], [I("midi", "SQ4", 50, "Fartlek 20' dans EV 50'")], rmb(25),
    ep(45), v(90), sl(120, 600)
  ]},
  { n: 7, vol: 6.25, light: false, days: [
    lundi(35), [], [I("midi", "SQ1", 45, "VMA : 2 × (8 × 30''/30'')")], rmb(25),
    evdt(50, "6 × 30''"), v(90), sl(135, 700)
  ]},
  { n: 8, vol: 4.25, light: true, days: [
    lundi(25), [], [I("midi", "EV", 45, "EV 45' souple")], rmb(20),
    ep(40), v(60), v(90)
  ]},
  { n: 9, vol: 6.5, light: false, days: [
    lundi(35), [], [I("midi", "SQ2", 45, "Côtes : 8 × 1' en côte")], rmb(25),
    evdt(50, "8 × 30''"), v(90), sl(150, 900)
  ]},
  { n: 10, vol: 6.5, light: false, days: [
    lundi(30), [], [I("midi", "SQ3", 45, "Seuil : 2 × 10' (récup 3')")], rmb(25),
    evdt(50, "6 × 45''"),
    [I("matin", "CORDE", 5, "Corde à sauter 5' (échauffement pliométrie)"), I("matin", "RMC", 20, "RM-C 20' (pliométrie)"), I("autre", "V", 90, "Vélo 1 h 30")],
    [I("autre", "V", 105, "Vélo 1 h 45"), I("autre", "CAP", 30, "+ CAP 30' (enchaînement)")]
  ]},
  { n: 11, vol: 7, light: false, days: [
    lundi(35), [], [I("midi", "SQ2", 50, "Côtes : 6 × 2' en côte")], rmb(25),
    evdt(50, "6 × 45''"), v(90), sl(165, 1000)
  ]},
  { n: 12, vol: 4, light: true, days: [
    lundi(25), [], [I("midi", "EV", 45, "EV 45' souple")], rmb(20),
    ep(40), v(60), [I("autre", "CAP", 60, "CAP 1 h souple")]
  ]},
  { n: 13, vol: 7.25, light: false, days: [
    lundi(35), [], [I("midi", "SQ1", 50, "VMA : 12 × 30''/30'' en côte")], rmb(25),
    evdt(50, "8 × 45''"), v(105), sl(180, 1100)
  ]},
  { n: 14, vol: 7.25, light: false, days: [
    lundi(30), [], [I("midi", "SQ3", 50, "Seuil : 3 × 10' (récup 3')")], rmb(25),
    evdt(50, "6 × 45''"),
    [I("matin", "CORDE", 5, "Corde à sauter 5' (échauffement pliométrie)"), I("matin", "RMC", 20, "RM-C 20' (pliométrie)"), I("autre", "V", 105, "Vélo 1 h 45")],
    [I("autre", "V", 120, "Vélo 2 h"), I("autre", "CAP", 30, "+ CAP 30'")]
  ]},
  { n: 15, vol: 7.5, light: false, days: [
    lundi(35), [], [I("midi", "SQ2", 50, "Côtes : 4 × 3' en côte")], rmb(25),
    evdt(55, "6 × 1'"), v(105), sl(135, 1100, "Course préparatoire n°1 : trail 25-28 km (2 h – 2 h 30, 900-1 200 m D+) — test ravitaillement complet, départ contrôlé (à défaut : SL 3 h 15 — 1 300 m D+)")
  ]},
  { n: 16, vol: 4.5, light: true, days: [
    lundi(25), [], [I("midi", "EV", 45, "EV 45'")], rmb(20),
    ep(40), v(75), v(90)
  ]},
  { n: 17, vol: 8, light: false, days: [
    lundi(35), [], [I("midi", "SQ3", 55, "Seuil : 3 × 12' (récup 3')")], rmb(25),
    evdt(55, "8 × 1'"), v(120), sl(210, 1500)
  ]},
  { n: 18, vol: 7, light: false, days: [
    lundi(30), [I("matin", "CORDE", 10, "Corde à sauter 10' : 2 × (3 × 1')")], [I("midi", "SQ4", 50, "Fartlek vallonné 45'")], rmb(25),
    [I("midi", "EV", 55, "EV 55'")], v(90),
    [I("autre", "V", 105, "Vélo 1 h 45"), I("autre", "CAP", 45, "+ CAP 45' à l'allure sortie longue")]
  ]},
  { n: 19, vol: 8, light: false, days: [
    lundi(30), [], [I("midi", "SQ2", 50, "Côtes : 5 × 3' en côte")], rmb(25),
    evdt(55, "10 × 1'"), v(120), sl(180, 1400, "Course préparatoire n°2 : trail 28-32 km (2 h 45 – 3 h 30, 1 300-1 600 m D+) — répétition générale : matériel, ravito, allure de départ (à défaut : SL 3 h 45 — 1 600 m D+)")
  ]},
  { n: 20, vol: 4, light: true, days: [
    lundi(20), [], [I("midi", "EV", 45, "EV 45'")], rmb(15),
    ep(40), v(60), [I("autre", "CAP", 60, "CAP 1 h")]
  ]},
  { n: 21, vol: 8.5, light: false, days: [
    lundi(30), [], [I("midi", "SQ3", 60, "Seuil : 4 × 10' (récup 3')")], rmb(25),
    evdt(55, "8 × 1'"), v(120), sl(240, 1700)
  ]},
  { n: 22, vol: 7.75, light: false, days: [
    lundi(25), [], [I("midi", "SQ2", 50, "Côtes : 6 × 3' en côte")], rmb(20),
    evdt(55, "6 × 1'"), v(120),
    [I("autre", "V", 120, "Vélo 2 h"), I("autre", "CAP", 45, "+ CAP 45'")]
  ]},
  { n: 23, vol: 8.75, light: false, days: [
    lundiGain(20), [], [I("midi", "SQ4", 50, "Fartlek 45' montées/descentes")], rmb(15),
    [I("midi", "EV", 50, "EV 50'")], v(90, "souple"),
    sl(270, 1900, "(la plus grosse sortie — audit des emballages : glucides/h, sodium, litres)")
  ]},
  { n: 24, vol: 4.5, light: true, days: [
    lundi(20), [], [I("midi", "EV", 45, "EV 45'")], rmb(15),
    ep(40), v(75), [I("autre", "CAP", 75, "CAP 1 h 15")]
  ]},
  { n: 25, vol: 7.5, light: false, days: [
    lundi(20), [], [I("midi", "SQ3", 50, "Seuil : 3 × 10' (récup 3')")], rmb(15),
    evdt(55, "6 × 1'"), v(90),
    sl(210, 1500, "à l'allure course — répétition générale : ravitaillement complet, matériel de course, première sortie avec bâtons (si le règlement les autorise — décision avant fin S24)")
  ]},
  { n: 26, vol: 4.5, light: false, days: [
    lundiGain(15), [I("matin", "CORDE", 10, "Corde à sauter 10' : 3 × 1'")], [I("midi", "SQ2", 45, "Côtes : 4 × 2' en côte"), I("midi", "DT", 0, "+ DT : 6 × 45''")], rmb(15),
    [I("midi", "EV", 45, "EV 45'"), I("midi", "GAM", 0, "+ gammes")], v(45),
    [I("autre", "V", 60, "Vélo 1 h"), I("autre", "CAP", 30, "+ CAP 30' (bâtons sur les côtes marchées)")]
  ]},
  { n: 27, vol: 3.25, light: false, days: [
    lundiGain(15), [], [I("midi", "SQ3", 45, "Seuil : 2 × 8' (récup 3')")], rmb(15),
    evdt(45, "3 × 1'"), v(45),
    sl(90, 600, "à l'allure course, avec bâtons (si utilisés le jour J)")
  ]},
  { n: 28, vol: 2.25, light: false, days: [
    lundiGain(10, 30), [I("matin", "CORDE", 8, "Corde à sauter 8' douce")], [I("midi", "SQ2", 40, "Côtes : 4 × 1' en côte"), I("midi", "DT", 0, "+ DT : 3 × 45''")], rmb(10),
    [I("midi", "EV", 40, "EV 40'")], v(30),
    [I("autre", "CAP", 45, "CAP 45' dont 3 × 2' à l'allure course")]
  ]},
  { n: 29, vol: 6.3, light: false, days: [
    [I("autre", "NAT", 20, "Natation 20' souple"), I("midi", "YOGA", 45, "Yoga doux")],
    [I("matin", "GAING", 10, "Gainage 10'"), I("matin", "PROP", 5, "Proprioception")],
    [I("midi", "EP", 25, "EP 25' + 2 × 2' seuil léger + 4 lignes droites")],
    [I("autre", "REST", 0, "Repos")],
    [I("midi", "EP", 20, "EP 20' + gammes")],
    [I("midi", "CAP", 15, "CAP 15' + 2-3 lignes droites")],
    [I("autre", "RACE", 420, "COURSE : Trail des Forts — 72 km, 2 800 m D+", { dplus: 2800 })]
  ]}
];

/* ---------- exercices de renforcement (avec animation + minuteur) ---------- */
const EXERCISES = [
  { id: "squat", name: "Squat", routine: "A", muscles: "quadriceps, fessiers, ischio-jambiers",
    sets: "3 séries de 12 à 20", tip: "Lestez (sac à dos) en bloc 2. Variante : squat sauté en RM-C.",
    desc: "Le geste de base de la force de jambes : descendre et remonter en gardant le dos rigide et les talons ancrés.",
    steps: [
      "Pieds largeur de bassin, pointes légèrement ouvertes vers l'extérieur.",
      "Bras tendus devant pour l'équilibre, pousse les hanches en arrière comme pour t'asseoir.",
      "Descends jusqu'à cuisses parallèles au sol (ou moins si le dos arrondit), genoux dans l'axe des pieds.",
      "Remonte en poussant fort sur toute la plante du pied, expire en montant."
    ],
    mistakes: ["Talons qui se décollent (recule le poids sur les talons)", "Genoux qui rentrent vers l'intérieur", "Dos qui s'arrondit en bas — réduis l'amplitude plutôt"],
    timer: { mode: "reps", rest: 60, sets: 3 } },
  { id: "fente", name: "Fente arrière", routine: "A", muscles: "quadriceps, fessiers, équilibre unilatéral",
    sets: "3 séries de 8-12 par jambe", tip: "Genou avant au-dessus du pied, genou arrière descend sans toucher le sol.",
    desc: "Travail unilatéral : chaque jambe porte seule, comme en montée. Corrige les déséquilibres gauche/droite.",
    steps: [
      "Debout, grand pas en arrière avec la jambe la plus faible en premier.",
      "Descends verticalement : le genou arrière va vers le sol sans le toucher.",
      "Le genou avant reste pile au-dessus du pied, buste droit, regard devant.",
      "Pousse dans le talon avant pour revenir, change de jambe à chaque répétition."
    ],
    mistakes: ["Buste qui penche en avant", "Genou avant qui dépasse loin devant les orteils", "Aller trop vite — 2'' descente, 1'' montée"],
    timer: { mode: "reps", rest: 60, sets: 3 } },
  { id: "stepup", name: "Step-up", routine: "A", muscles: "fessiers, quadriceps — le geste de la montée",
    sets: "3 séries de 8-12 par jambe", tip: "Augmente la hauteur puis la charge (sac à dos).",
    desc: "Montée sur marche ou banc : reproduit exactement le geste de poussée en côte. C'est l'exercice le plus spécifique du trail.",
    steps: [
      "Place un pied entier sur la marche (hauteur genou à mi-cuisse au début).",
      "Pousse uniquement avec la jambe d'appui — la jambe libre ne pousse pas.",
      "Redresse-toi complètement en haut, une seconde de pause.",
      "Redescends posé, en posant doucement le pied libre, sans te laisser tomber."
    ],
    mistakes: ["Pousser avec la jambe libre", "S'élancer avec le buste pour monter", "Descendre en tombant (freine avec la jambe d'appui)"],
    timer: { mode: "reps", rest: 60, sets: 3 } },
  { id: "bulgare", name: "Squat bulgare", routine: "A", muscles: "fessiers, quadriceps — force unilatérale, contrôle du genou",
    sets: "3 séries de 8-10 par jambe (à partir du bloc 2)", tip: "Avancé : ajoute une paire d'haltères ou un sac à dos chargé.",
    desc: "Fente avec le pied arrière surélevé : amplitude et contrainte maximales sur la jambe avant. Introduis-le au bloc 2, quand la fente arrière est stable.",
    steps: [
      "Pied arrière posé sur une chaise ou un banc (cou-de-pied à plat).",
      "Avance le pied avant d'environ 60-70 cm, buste droit.",
      "Descends vertical jusqu'à ce que la cuisse avant soit parallèle au sol.",
      "Remonte en poussant sur le talon avant, sans l'aide du pied arrière."
    ],
    mistakes: ["Position trop courte : le genou part trop en avant", "Buste qui bascule", "Amplitude partielle — descends entièrement ou réduis la charge"],
    timer: { mode: "reps", rest: 60, sets: 3 } },
  { id: "pont", name: "Pont fessier", routine: "A", muscles: "grand fessier, ischio-jambiers",
    sets: "3 séries de 15-20", tip: "2'' de pause en haut. Version sur une jambe en bloc 3.",
    desc: "Isolation des fessiers, au sol. Protège le dos et prépare la chaîne postérieure pour les montées.",
    steps: [
      "Allongé sur le dos, pieds à plat à largeur de bassin, talons proches des fesses.",
      "Pousse sur les talons, lève les hanches jusqu'à aligner épaules-hanches-genoux.",
      "Serre fort les fessiers en haut, tiens 2'' sans cambrer le bas du dos.",
      "Redescends en contrôlant, hanches frôlent le sol sans reposer."
    ],
    mistakes: ["Cambrer le dos au lieu de serrer les fessiers", "Pousser avec les orteils", "Aller trop vite — le mouvement doit être lent et serré"],
    timer: { mode: "reps", rest: 60, sets: 3 } },
  { id: "mollets", name: "Montées sur pointes au bord d'une marche", routine: "A", muscles: "mollets, tendon d'Achille, cheville",
    sets: "3 séries de 12-20", tip: "Sur une jambe en bloc 2. L'exercice le plus rentable pour ta cheville.",
    desc: "Renforce mollets et tendon d'Achille en grande amplitude — la meilleure assurance anti-entorse pour un trail avec 2 800 m de D-.",
    steps: [
      "Avant-pieds sur le bord d'une marche, talons dans le vide, un appui à portée de main.",
      "Descends les talons au maximum : étirement complet du mollet, 2'' en bas.",
      "Monte sur la pointe complète : 1'' de contraction forte en haut.",
      "Tempo lent en descente (3'') : c'est la phase excentrique qui renforce le tendon."
    ],
    mistakes: ["Amplitude partielle (petits rebonds)", "S'aider de la rampe pour pousser", "Aller trop vite — le tendon se renforce avec la lenteur"],
    timer: { mode: "reps", rest: 45, sets: 3 } },
  { id: "stepdown", name: "Descente de marche lente (excentrique)", routine: "A", muscles: "quadriceps en excentrique — la clé des descentes",
    sets: "2 séries de 6 par jambe (à partir de S7)", tip: "Tu prépares tes cuisses à freiner 2 800 m de descente.",
    desc: "Descente ultra-lente d'une marche : la phase excentrique (freinage) est ce qui cuit les cuisses en descente. À introduire dès S7, avec précaution.",
    steps: [
      "Debout sur une marche (20-30 cm), sur une seule jambe, l'autre jambe pend dans le vide.",
      "Descends le pied libre vers le sol en 4 secondes comptées, talon jamais posé.",
      "Remonte en poussant sur la jambe d'appui, sans impulsion.",
      "6 répétitions suffisent : c'est un exercice coûteux pour les cuisses."
    ],
    mistakes: ["Descendre trop vite", "Poser le talon au sol (le mouvement reste en l'air)", "Enchaîner trop de séries les premières semaines"],
    timer: { mode: "reps", rest: 60, sets: 2 } },
  { id: "planche", name: "Planche sur les avant-bras", routine: "B", muscles: "tronc entier : grand droit, transverse",
    sets: "3 séries de 30'' à 60''", tip: "Avant-bras sous les épaules, nombril rentré, respire.",
    desc: "Gainage frontal : apprendre à garder le tronc rigide pendant que les jambes travaillent — exactement ce que demandent 72 km de course.",
    steps: [
      "Avant-bras au sol, coudes pile sous les épaules.",
      "Jambes tendues, corps aligné de la tête aux talons.",
      "Nombril rentré, fessiers légèrement serrés, nuque dans le prolongement.",
      "Respire calmement par le nez — si la forme casse, arrête : une planche molle ne sert à rien."
    ],
    mistakes: ["Hanches qui s'affaissent (le dos prend)", "Fesses trop hauts (triche)", "Retenir sa respiration"],
    timer: { mode: "hold", work: 45, rest: 60, sets: 3 } },
  { id: "planchelat", name: "Planche latérale", routine: "B", muscles: "obliques et fessier moyen — l'anti-essuie-glace",
    sets: "3 séries de 20'' à 45'' par côté", tip: "Monte les pieds sur un support pour durcir.",
    desc: "Le gainage latéral cible le fessier moyen, le muscle qui retient le genou vers l'intérieur (syndrôme de la bandelette ilio-tibiale). Ta routine prioritaire.",
    steps: [
      "Sur le côté, coude sous l'épaule, avant-bras au sol.",
      "Lève la hanche jusqu'à aligner épaules-hanches-chevilles.",
      "Bras libre levé vers le ciel, regard neutre.",
      "Tiens en respirant ; change de côté à chaque série."
    ],
    mistakes: ["Hanche qui retombe vers le sol", "Buste qui bascule en avant ou en arrière", "Aller jusqu'à l'échec — arrête quand la position se dégrade"],
    timer: { mode: "hold", work: 30, rest: 45, sets: 3 } },
  { id: "deadbug", name: "Dead bug", routine: "B", muscles: "grand droit, contrôle du bassin",
    sets: "2 séries de 10 par côté, lent", tip: "Lombaires collées au sol en permanence.",
    desc: "Gainage dynamique au sol : tendre bras et jambe sans bouger le bassin. Apprend au tronc à rester stable pendant que les membres bougent.",
    steps: [
      "Sur le dos, bras verticaux, genoux à 90° au-dessus des hanches.",
      "Colle les lombaires au sol : c'est ta position de référence, ne la perds jamais.",
      "Tends lentement la jambe droite et le bras gauche vers le sol, sans toucher.",
      "Reviens en contrôlant, change de côté."
    ],
    mistakes: ["Bas du dos qui se creuse quand la jambe s'éloigne", "Mouvement rapide et balancé", "Respiration bloquée"],
    timer: { mode: "reps", rest: 45, sets: 2 } },
  { id: "birddog", name: "Bird dog", routine: "B", muscles: "stabilité dos et hanches, gainage en appui",
    sets: "2 séries de 10 par côté", tip: "1'' de pause en extension, sans basculer le bassin.",
    desc: "À quatre pattes, tendre bras et jambe opposés : renforce les muscles profonds du dos et l'équilibre du bassin en position de course.",
    steps: [
      "À quatre pattes, mains sous les épaules, genoux sous les hanches, dos plat.",
      "Tends le bras droit devant et la jambe gauche derrière, en même temps, lentement.",
      "1'' de pause en extension : une ligne bras-bassin-jambe.",
      "Reviens sans poser le pied, change de côté."
    ],
    mistakes: ["Bassin qui bascule en extension", "Jambe qui monte trop haut (au-dessus de la hanche)", "Tête qui se lève — nuque alignée"],
    timer: { mode: "reps", rest: 45, sets: 2 } },
  { id: "proprio", name: "Proprioception unipodale", routine: "B", muscles: "cheville : stabilisateurs et capteurs (entorse ancienne)",
    sets: "3 × 30'' par jambe — tous les jours en bloc 1, puis 2-3 fois/semaine", tip: "Progression : cercles de bras, yeux fermés, coussin, balle. Y compris le jour de course, à l'échauffement.",
    desc: "Tenir en équilibre sur une jambe : rééduque les capteurs de la cheville après une entorse et prévient la suivante. Non négociable dans ton programme.",
    steps: [
      "Debout sur une jambe, genou légèrement fléchi, regard fixe sur un point.",
      "Tiens 30'' sans poser le pied — si tu décroches, reprends le chrono.",
      "Progression : ferme les yeux, puis passe sur un coussin ou une balle.",
      "Ajoute des cercles de bras ou des mouvements de tête pour complexifier."
    ],
    mistakes: ["Poser le pied au sol dès le premier déséquilibre", "Genou verrouillé en extension", "Sauter l'exercice les jours sans douleur — c'est justement là qu'il agit"],
    timer: { mode: "hold", work: 30, rest: 15, sets: 3 } },
  { id: "monstre", name: "Marche du monstre avec élastique", routine: "B", muscles: "fessier moyen et TFL — l'anti-essuie-glace en dynamique",
    sets: "2 séries de 10 pas par jambe", tip: "Si douleur : version allongée sur le côté (coquillage).",
    desc: "Marche latérale avec élastique aux chevilles : active le fessier moyen en charge, le muscle qui retient l'essuie-glace en course.",
    steps: [
      "Élastique aux chevilles (ou genoux), demi-flexion, buste légèrement en avant.",
      "Fais 10 pas de côté dans un sens en tenant la tension de l'élastique.",
      "Puis 10 pas dans l'autre sens — les pieds ne se touchent pas : l'élastique reste tendu.",
      "Reste bas toute la série : les épaules ne montent pas."
    ],
    mistakes: ["Élastique qui se détend entre les pas", "Se redresser en marchant", "Aller trop vite — le tempo lent fait travailler le fessier, pas l'élan"],
    timer: { mode: "reps", rest: 45, sets: 2 } },

  /* ---------- corde à sauter (routine S) ---------- */
  { id: "corde-base", name: "Corde : sauts de base (double appui)", routine: "S", muscles: "mollets, tendon d'Achille, coordination, gainage",
    sets: "3 × 1' (récup 30'')", tip: "Coudes collés au corps : la rotation vient des poignets, pas des bras.",
    desc: "Le saut de base, pieds joints, rebonds bas et légers : pliométrie douce et apprentissage du rythme. Échauffement idéal avant toute séance.",
    steps: [
      "Corde derrière les talons, coudes collés au buste, les poignets tournent la corde.",
      "Saute juste 2-3 cm : la corde passe, les genoux restent souples.",
      "Rebondis sur l'avant-pied, les talons ne touchent jamais le sol.",
      "Respire calmement, rythme régulier — compte les sauts pour t'ancrer."
    ],
    mistakes: ["Sauter trop haut (fatigue inutile)", "Bras qui font de grands cercles", "Atterrir sur les talons — toujours l'avant-pied"],
    timer: { mode: "interval", work: 60, rest: 30, reps: 3, sets: 1, setrest: 60 } },
  { id: "corde-alterne", name: "Corde : pas alternés (boxeur)", routine: "S", muscles: "cheville en mobilité latérale, équilibre, coordination",
    sets: "3 × 30'' à 1' (récup 30'')", tip: "Sur place, un pied à la fois — léger, sur l'avant-pied.",
    desc: "Alterne gauche/droite comme un boxeur sur place : travail d'équilibre et de réactivité de la cheville, très proche des micro-appuis du trail.",
    steps: [
      "Position de base, puis déroule un pied à la fois : gauche, droite, gauche…",
      "L'amplitude du pas est minime : on soulève à peine le pied du sol.",
      "Buste stable, regarde devant, la cadence monte progressivement.",
      "Reste sur l'avant-pied, respiration régulière."
    ],
    mistakes: ["Pas trop amples (on ne court pas sur place)", "Corde trop lente — garde un rythme vif", "Regarder ses pieds (déséquilibre)"],
    timer: { mode: "interval", work: 45, rest: 30, reps: 3, sets: 1, setrest: 60 } },
  { id: "corde-genoux", name: "Corde : montées de genoux", routine: "S", muscles: "fléchisseurs de hanche, abdominaux, gainage dynamique",
    sets: "3 × 30'' (récup 30'')", tip: "Garde le buste droit : le genou monte vers le buste, pas l'inverse.",
    desc: "Montées de genoux à la corde : allie le geste de course (foulée avant) et la pliométrie. Excellent avant les séances de qualité.",
    steps: [
      "Alterne les montées de genoux à hauteur de bassin, un saut de corde par jambe.",
      "Pousse sur l'avant-pied, atterrissage moelleux et silencieux.",
      "Bras actifs comme en course, corde rapide.",
      "30'' à bonne intensité : tu dois finir le temps essoufflé."
    ],
    mistakes: ["Buste qui penche en arrière", "Genoux trop bas (moins intense)", "Atterrissage bruyant = jambes raides"],
    timer: { mode: "interval", work: 30, rest: 30, reps: 3, sets: 1, setrest: 60 } },
  { id: "corde-latereau", name: "Corde : sauts latéraux", routine: "S", muscles: "stabilisateurs de la cheville, adducteurs, abducteurs",
    sets: "3 × 30'' (récup 30'')", tip: "Amplitude d'un pied environ : la cheville travaille, pas l'adducteur.",
    desc: "Sauts de gauche à droite pendant que la corde tourne : proprioception latérale de la cheville — le geste qui protège en terrain cassant.",
    steps: [
      "Pieds joints, saute latéralement d'environ 30 cm de gauche à droite.",
      "La corde tourne à chaque saut — un saut par passage de corde.",
      "Réception sur l'avant-pied, genoux souples.",
      "Alterne les amplitudes : petits pas rapides, puis plus larges."
    ],
    mistakes: ["Sauter trop loin (perte de contrôle)", "Genoux qui se verrouillent", "Corde qui ralentit — maintiens le tempo"],
    timer: { mode: "interval", work: 30, rest: 30, reps: 3, sets: 1, setrest: 60 } },
  { id: "corde-double", name: "Corde : double unders (avancé)", routine: "S", muscles: "puissance des mollets, coordination fine, sangle abdominale",
    sets: "2-3 × 20-30'' (récup 45'')", tip: "Exercice avancé : maîtrise d'abord parfaitement les sauts de base.",
    desc: "Deux passages de corde par saut : travail de puissance pur. À réserver aux semaines sans douleur au mollet ou au tendon d'Achille, jamais en découverte.",
    steps: [
      "Saute légèrement plus haut que le saut de base, corps gainé.",
      "Tourne la corde deux fois plus vite avec les poignets, un seul saut.",
      "Réception immédiate sur l'avant-pied.",
      "Si tu échoues deux fois de suite, reviens au saut de base : c'est normal."
    ],
    mistakes: ["Grand saut désordonné au lieu d'un saut vif et gainé", "Bras trop larges", "Enchaîner par fatigue : qualité avant quantité"],
    timer: { mode: "interval", work: 20, rest: 45, reps: 3, sets: 1, setrest: 60 } }
];

const RM_C_DRILLS = [
  "Montées de genoux : 3 × 20''",
  "Talons-fesses : 3 × 20''",
  "Foulées bondissantes : 3 × 20''",
  "Squats sautés ou sauts sur banc : 3 × 8",
  "Sauts de galet (cloche-pied alterné) : 2 × 10 par jambe"
];

const NUTRITION_TIPS = [
  "Efforts > 1 h 30 : boisson isotonique ; sortie < 1 h : eau.",
  "Sorties longues (dès S9) : 60 à 90 g de glucides par heure, en variant saveurs et textures.",
  "500 à 750 ml de boisson par heure ; par chaleur, ajoutez du sel.",
  "Récupération dans les 30' : glucides + protéines (ratio 3:1).",
  "Le jour J : rien de neuf, jamais — testez tout sur les sorties longues."
];

const PAIN_RULE = "Règle de la douleur : douleur essuie-glace ou cheville > 3/10 pendant deux séances consécutives => supprimer le dénivelé négatif de la semaine et consulter un kiné si cela persiste.";

/* ---------- routines pour le déroulé guidé (séance player) ---------- */
const ROUTINES = {
  A: {
    code: "RMA", name: "RM-A — Jambes et chaîne postérieure", dur: "30-35'",
    intro: "Matin. Fais chaque répétition lentement : quelques répétitions propres valent mieux qu'une série bâclée.",
    steps: EXERCISES.filter(e => e.routine === "A").map(e => ({ ex: e.id }))
  },
  B: {
    code: "RMB", name: "RM-B — Tronc, fessiers et cheville", dur: "25-30'",
    intro: "La routine anti-essuie-glace et anti-entorse. À faire deux fois par semaine, sans exception, toute l'année.",
    steps: EXERCISES.filter(e => e.routine === "B").map(e => ({ ex: e.id }))
  },
  C: {
    code: "RMC", name: "RM-C — Pliométrie et gammes", dur: "20'",
    intro: "Après 10' d'échauffement (marche rapide puis gammes). Progressif, sur herbe ou sol souple — jamais sur sol dur.",
    steps: [
      { name: "Montées de genoux", txt: "3 × 20''", timer: { mode: "interval", work: 20, rest: 40, reps: 3, sets: 1, setrest: 0 } },
      { name: "Talons-fesses", txt: "3 × 20''", timer: { mode: "interval", work: 20, rest: 40, reps: 3, sets: 1, setrest: 0 } },
      { name: "Foulées bondissantes", txt: "3 × 20''", timer: { mode: "interval", work: 20, rest: 40, reps: 3, sets: 1, setrest: 0 } },
      { name: "Squats sautés ou sauts sur banc", txt: "3 × 8", series: 3 },
      { name: "Sauts de galet (cloche-pied alterné)", txt: "2 × 10 par jambe", series: 2 }
    ]
  },
  G: {
    code: "GAING", name: "Gainage léger (affûtage)", dur: "10-15'",
    intro: "Gainage doux pour l'affûtage : arrêt des exercices lourds 10 jours avant la course, gainage/mobilité jusqu'à J−3.",
    steps: [
      { ex: "planche", alt: "3 × 30'' à 45''" },
      { ex: "planchelat", alt: "3 × 20'' à 30'' par côté" },
      { ex: "deadbug", alt: "2 × 10 par côté, lent" },
      { ex: "birddog", alt: "2 × 10 par côté, lent" }
    ]
  },
  S: {
    code: "CORDE", name: "Corde à sauter — pliométrie douce et cheville", dur: "10-15'",
    intro: "Échauffe-toi 2' (marche rapide, mobilisation cheville). Sur un sol souple (parquet, herbe, tapis), pieds en basket légère ou pieds nus si tu maîtrises. La corde se règle : poignées à hauteur d'aisselles sur le milieu de la corde.",
    steps: EXERCISES.filter(e => e.routine === "S").map(e => ({ ex: e.id }))
  }
};

/* ---------- skill « coach trail » pour Mistral AI ---------- */
const COACH_SKILL = `Tu es « Coach Trail », l'assistant d'entraînement intégré au site TrainingTrail.
Tu conseilles un coureur qui prépare le Trail des Forts de Besançon : 72 km, 2800 m D+/D-, le dimanche 9 mai 2027.
Profil du coureur : père de famille, séances midi (mercredi/vendredi), renforcement le matin (RM-A lundi, RM-B jeudi),
sortie longue une semaine sur deux, vélo le samedi, yoga + natation le lundi.
Points faibles à protéger en priorité : ancienne entorse de cheville (proprioception indispensable) et
tendinopathie chronique de la bandelette ilio-tibiale (« essuie-glace ») : privilégier fessiers moyens,
descentes très progressives, pas courts et cadence élevée en descente.
Règles du programme : progression 3+1 (semaines allégées S4, S8, S12, S16, S20, S24), jamais de renforcement
la veille d'une sortie longue ou d'une séance qualité, règle de la douleur >3/10 sur deux séances consécutives
= supprimer le dénivelé négatif et consulter un kiné. Priorité si semaine impossible : 1) sortie longue,
2) séance qualité du mercredi, 3) RM-B, 4) le reste — on ne rattrape jamais une séance manquée.
Réponds en français, de façon concise, concrète et bienveillante, comme un coach qui connaît le plan.
Règles issues de la bibliographie ultratrail (Koop, Koerner, Sharman, Garza-Hillman) : juger l'effort (RPE, test de la parole)
plutôt que la montre ; jamais de fractionné en descente (la descente = technique, pas d'intensité) ; le sous-entraîné bat
le sur-entraîné, une séance sautée ne se rattrape jamais ; boire à la soif (l'hyponatrémie est plus dangereuse que la
déshydratation), un peu d'eau avec chaque gel ; jamais d'ibuprofène pendant l'effort long.
Deux courses préparatoires (S15 : trail 25-28 km, S19 : trail 28-32 km) remplacent la sortie longue : objectifs = répétition
générale (matériel, ravito, départ contrôlé), pas la performance. Affûtage S26-S29 à décroissance rapide (Koop) : ~55 % du
pic en S26, 40-45 % en S27, 25 % en S28, moins de 2 h en semaine de course — intensité conservée en touches courtes,
ne jamais charger ces semaines. Bâtons : décision avant fin S24 (vérifier le règlement), entraînement avec bâtons dès S25
(au moins 4 semaines, coude à 90°). Jour J : trois tiers en temps (~3 h 30), premier tiers volontairement prudent,
marche en puissance dès les pentes raides, ne jamais rattraper du temps en descente, ravitos < 2 min, objectifs
A (10 h 30) / B (11 h 00) / C (finir dans les barrières), rien de neuf jamais.
Appuie-toi sur l'état du programme et des sorties fourni ci-dessous ; si une information manque, demande-la.
Ne donne jamais de conseil médical : en cas de douleur persistante, oriente vers un kiné ou un médecin.
Contexte en temps réel ci-dessous (mis à jour à chaque question) :`;

/* récupération Polar (si la montre est connectée) : résumé pour le coach —
   3 dernières nuits (sommeil, recharge ANS/VFC) + charge cardio récente.
   Règle transmise au coach : récupération compromise -> séance facile/échange. */
function polarRecoveryContext() {
  const pn = (typeof state !== "undefined" && state && state.polarNights) || {};
  const dates = Object.keys(pn).sort();
  const last3 = dates.slice(-3);
  if (!last3.length) return "";
  const lines = last3.map(d => {
    const n = pn[d] || {}, sl = n.slp, rc = n.rec;
    let t = "- " + d + " :";
    if (rc && rc.st != null) {
      const lbl = rc.st >= 5 ? "bien récupéré" : rc.st >= 4 ? "récupération correcte" : rc.st >= 3 ? "récupération moyenne" : "récupération compromise";
      t += " " + lbl + (rc.ans != null ? " (recharge ANS " + (rc.ans >= 0 ? "+" : "") + Math.round(rc.ans * 10) / 10 + ")" : "");
      if (rc.hrv != null) t += ", VFC RMSSD " + rc.hrv + " ms";
      if (rc.br != null) t += ", respiration " + rc.br + "/min";
    }
    if (sl) {
      t += " · sommeil " + (sl.dur ? Math.floor(sl.dur / 60) + " h " + String(sl.dur % 60).padStart(2, "0") : "?");
      if (sl.score) t += " (score " + sl.score + "/100" + (sl.deep != null ? ", profond " + sl.deep + " min" : "") + ")";
    }
    return t;
  }).join("\n");
  let loadTxt = "";
  const ldDates = dates.filter(d => pn[d].load);
  if (ldDates.length) {
    const d = ldDates[ldDates.length - 1], ld = pn[d].load;
    loadTxt = "\nCharge cardio du " + d + " : " + ld.v +
      (ld.st ? " (" + (ld.st.indexOf("STRAINED") >= 0 ? "en surcharge" : ld.st.indexOf("BALANCED") >= 0 ? "équilibrée" : ld.st.indexOf("RECOVERY") >= 0 ? "en dessous de la moyenne" : "?") + ")" : "") +
      (ld.str != null && ld.tol != null ? " (strain " + ld.str + " / tolérance " + ld.tol + ")" : "");
  }
  return "Récupération Polar (montre, " + last3.length + " dernières nuits) :\n" + lines + loadTxt + "\n" +
    "Règle : recharge compromise (stade ≤ 3) ou sommeil < 6 h deux nuits de suite -> privilégier l'endurance facile, échanger la séance qualité si besoin ; un repos non prévu reste un bon choix. Bien récupéré -> séance qualité possible comme prévu.";
}

function coachContext() {
  const w = currentWeek(), week = effWeek(w), blk = blockOf(w);
  const idx = todayIdx();
  const today = week.days[idx].map(x => "- [" + (itemDone(x) ? "x" : " ") + "] " +
    ((TYPES[x.it.c] || { label: x.it.c }).label) + " : " + x.it.t).join("\n") || "- repos";
  const donePct = weekProgressPct();
  const wDone = realizedMinutes(w), wPlan = plannedMinutes(w);
  const runs = state.runs.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6)
    .map(r => "- " + r.date + " (" + (TYPES[r.code] || { label: r.code }).label + ") : " +
      (r.dist ? r.dist.toFixed(1) + " km, " : "") + (r.dur ? Math.round(r.dur) + " min, " : "") +
      (r.dplus ? r.dplus + " m D+, " : "") +
      (r.polar && r.polar.hr ? "FC moy " + r.polar.hr.average + " / max " + r.polar.hr.maximum + " bpm, " : "") +
      (r.polar && r.polar.ri != null ? "Running Index " + r.polar.ri + ", " : "") +
      (r.route ? "terrain : " + routeLabel(r.route) + ", " : "") +
      (r.feel ? "sensations " + r.feel + "/10, " : "") +
      (r.knee != null ? "essuie-glace " + r.knee + "/10, " : "") +
      (r.ankle != null ? "cheville " + r.ankle + "/10, " : "") +
      (r.notes ? '"' + r.notes + '"' : ""))
    .join("\n") || "- aucune sortie enregistrée";
  const shoes = state.shoes.map(s => {
    const km = state.runs.filter(r => r.shoeId === s.id).reduce((a, r) => a + (r.dist || 0), 0);
    return "- " + s.name + " : " + km.toFixed(1) + " km / " + s.maxKm + " km estimés" + (s.retired ? " (retraitée)" : "");
  }).join("\n") || "- aucune chaussure suivie";
  const prof = state.profile;
  const zones = (typeof hrZones === "function" && hrZones())
    ? "Zones (Karvonen) : " + hrZones().map(z => z.name.split(" ")[0] + " " + z.lo + "-" + z.hi).join(" · ")
    : "zones FC non calculables (FC max non renseignée)";
  const wkNote = (state.notes || {})["S" + w];
  const dailyAdh = (typeof DAILY !== "undefined" ? DAILY : []).map(d => {
    const n = weekDates(w).filter(dt => (state.daily || {})[isoDate(dt)] && state.daily[isoDate(dt)][d.c]).length;
    return (TYPES[d.c] || { label: d.c }).label + " " + n + "/7";
  }).join(", ");
  const lastLoads = Object.keys(state.loads || {}).slice(-4)
    .map(k => "- " + k + " : " + (state.loads[k].kg || 0) + " kg × " + (state.loads[k].reps || "?") + " (" + (state.loads[k].date || "?") + ")")
    .join("\n");
  const km = state.runs.reduce((a, r) => a + (r.dist || 0), 0);
  const dp = state.runs.reduce((a, r) => a + (r.dplus || 0), 0);
  const j = daysBetween(isoDate(new Date()), RACE.date);
  return [
    COACH_SKILL,
    "\n[ÉTAT DU COUREUR]",
    "Date du jour : " + fmtDate(new Date()),
    "Semaine en cours : S" + w + " (" + blk.name + (week.light ? ", allégée" : "") + "), J-" + j + " avant la course.",
    "Programme réalisé : " + donePct + " % des séances cochées ; volume semaine : " + fmtHours(wDone) + " / " + fmtHours(wPlan) + " h" +
      (extraMinutes(w) ? " (dont " + extraMinutes(w) + " min d'exercices hors programme)" : "") + ".",
    "Séances prévues aujourd'hui :\n" + today,
    "Distance totale courue (enregistrée) : " + km.toFixed(1) + " km, D+ cumulé : " + dp + " m.",
    "Profil coureur : " + (prof ? (prof.fcm ? "FCM " + prof.fcm + " bpm, " : "") + (prof.repos != null ? "repos " + prof.repos + " bpm, " : "") +
      (prof.poids != null ? prof.poids + " kg, " : "") + (prof.vo2 != null ? "VO2max " + prof.vo2 + " ml/kg/min, " : "") +
      (prof.vma != null ? "VMA " + prof.vma + " km/h" : "") : "non renseigné") + ". " + zones + ".",
    "Quotidiennes de la semaine (proprio/automassage, hors volume) : " + (dailyAdh || "aucune"),
    polarRecoveryContext(),
    (wkNote ? "Notes de la semaine du coureur : \"" + wkNote + "\"" : ""),
    (lastLoads ? "Dernières charges de renforcement :\n" + lastLoads : ""),
    "Dernières sorties :\n" + runs,
    "Chaussures :\n" + shoes
  ].join("\n");
}

/* ================= conseils (onglet Conseils) =================
   Fondés sur la littérature trail/ultra (nutrition d'endurance, entraînement
   polarisé, prévention blessures) et sur les règles du plan (coach-trail). */
const TIPS = [
  { cat: "Alimentation — avant l'effort", tips: [
    "Sortie courte du matin : 20-40 g de glucides 30 min avant suffisent (banane, dates, flocons d'avoine). Pas besoin de plus.",
    "Sortie longue ou séance qualité : repas riche en glucides 2-3 h avant (avoine, riz, pâtes), léger en fibres et en graisses.",
    "Café 30-60 min avant si tu le tolères — testé d'abord à l'entraînement, jamais pour la première fois en course.",
    "Rien de nouveau le jour J : chaque sortie longue teste exactement ce que tu feras en course (petit-déj, gels, boisson)."
  ]},
  { cat: "Alimentation — pendant l'effort", tips: [
    "Moins de 60-90 min d'effort : l'eau suffit, pas besoin de glucides.",
    "Au-delà : 60-90 g de glucides/heure + 500-750 ml de boisson par heure — à mettre en place dès S9.",
    "Fractionner : une prise toutes les 20-25 min passe mieux qu'un gros apport d'un coup.",
    "Au-delà de 3 h : ajoute du sodium (200-400 mg/h, jusqu'à 600 mg/h par chaleur) et alterne sucré/salé quand le sucre écœure.",
    "Le ventre s'entraîne comme les jambes : manger en courant se travaille sur chaque sortie longue.",
    "Calories dans les poches, hydratation dans les gourdes (Koop) : un peu d'eau avec chaque gel ; bois à la soif — l'hyponatrémie (trop boire) est plus dangereuse que la légère déshydratation.",
    "Audit des emballages sur la sortie longue de S23 : garde chaque emballage, compte glucides/heure, sodium et litres — tu sauras exactement quoi emporter le jour J.",
    "Jamais d'ibuprofène pendant l'effort long (risque rénal — Koerner) ; caféine à partir du premier tiers de la course, avec des gels testés à l'entraînement."
  ]},
  { cat: "Récupération", tips: [
    "Dans les 30 min après l'effort : glucides + protéines, ratio ~3:1 (yaourt-banane, lait d'avoine, shake).",
    "Repas complet dans les 2 h, avec des légumes et des sources de fer (lentilles, viande rouge 1-2 fois/semaine).",
    "Sommeil : le meilleur dopant légal — vise 7-9 h, et une sieste de 20 min les jours de grosse charge.",
    "Douleur essuie-glace ou cheville > 3/10 deux séances de suite : retire le dénivelé négatif de la semaine (règle du plan).",
    "Sous-entraîné bat sur-entraîné (Sharman) : une séance sautée ne se rattrape jamais, un repos imprévu est un avantage, pas un échec.",
    "Douleur vive et localisée = ajuste tout de suite ; souffrance diffuse de l'effort = normale, on continue (Sharman)."
  ]},
  { cat: "Cardio / endurance", tips: [
    "80-85 % du volume en aisance (zone 2, allure où tu peux parler) : c'est là que se construit le moteur aérobie.",
    "Évite le « ni vite ni lent » (allure moyennement dure) : adaptations moindres et risque de blessure plus élevé.",
    "Sur trail, compte le temps en pieds plus que les kilomètres : 3 h sur sentier technique sont un excellent stimulus.",
    "La qualité du mercredi (fractionné, côtes) se court en frais : pas de renforcement la veille.",
    "La marche rapide en côte raide est un outil de course : travaille-la dès les SL pour les 12 forts de Besançon.",
    "Juge l'effort, pas la montre (Koop, Sharman) : sur sentier, allure et zones de FC ne veulent rien dire — test de la parole (phrases complètes) et respiration nasale suffisent en endurance.",
    "Marche en puissance par choix, pas par détresse : au-dessus d'environ 28 % de pente, marcher coûte moins cher que courir (Sharman). Mange en haut des côtes, jamais dedans (Koerner).",
    "Répartis le profil de la course sur la semaine dans les 6-8 dernières semaines (environ 130 m de D+ par 10 km) plutôt que dans une seule sortie (Koop)."
  ]},
  { cat: "Renforcement / prévention", tips: [
    "2 séances par semaine suffisent (RM-A lundi, RM-B jeudi) — jamais la veille d'une sortie longue ou d'une qualité.",
    "Fessier moyen et cheville = tes deux points faibles : ponts fessiers et proprioception chaque semaine, sans exception.",
    "Pliométrie (RM-C) sur herbe ou sol souple, très progressivement : c'est ce qui te protégera dans les descentes.",
    "Corde à sauter : 10 min valent un renforcement cheville/mollets complet — même en décalé, ça compte."
  ]},
  { cat: "Descentes & technique", tips: [
    "Regard 3-5 m devant, foulée courte sous le corps, cadence 175-185 pas/min : la descente se travaille (séance DT, jamais sautée).",
    "S'incline avec la pente plutôt que freiner en arrière — freiner surcharge le genou et l'essuie-glace.",
    "Dénivelé négatif : +10-15 % par mois maximum.",
    "Gammes (montées de genoux, talons-fesses, foulées bondissantes) 10 min après échauffement, une fois par semaine.",
    "Jamais de fractionné en descente (Koop) : la descente se travaille en technique et en retenue, pas en quad-bashing.",
    "Sur terrain rocheux : pointes légèrement vers l'extérieur (« stance canard » — Koerner), l'assurance anti-entorse de la cheville.",
    "En course, ne rattrape jamais du temps en descente : les quadriceps sont ton capital de fin de course (Sharman)."
  ]},
  { cat: "Matériel", tips: [
    "Chaussures trail : 600-900 km de durée de vie — suis l'usure dans l'onglet Chaussures et change avant que la mousse meure.",
    "Deux paires en rotation pendant le pic d'entraînement : une sèche, une en course.",
    "Teste le sac à charge sur chaque sortie longue : ce qui frotte à 2 h frotte plus à 8 h.",
    "Semaine allégée = bon moment pour régler le matériel (lacets, anti-frottements) sans fatigue.",
    "Bâtons : vérifie le règlement avant fin S24 ; si tu les utilises, entraîne-toi avec au moins 4 semaines d'avance (coude à 90°, planté en rythme avec le pied — Koop).",
    "Option bloc 3 : marche en puissance lestée (gilet ≤ 10-15 % du poids du corps) sur les montées des sorties longues — durcissement progressif des quadriceps (Sharman)."
  ]},
  { cat: "Mental & jour J", tips: [
    "72 km = 12 forts : un à la fois. En course, ne pense qu'au prochain ravitaillement.",
    "Départ 15-20 % plus lent que ton allure marathon : les barrières à 6,2 km/h récompensent la patience.",
    "Vise 30 min de marge sur les barrières à mi-course.",
    "Mauvais passage en course : ça arrive à tout le monde — 10 min de marche, mange, bois, repars. Ça passe.",
    "Les semaines allégées (S4, S8, S12, S16, S20, S24) ne sont jamais des semaines à charger.",
    "Trois tiers en temps (~3 h 30 chacun — Sharman) : premier tiers volontairement prudent (l'allure à tenir doit sembler étonnamment lente), deuxième on tient le plan, dernier = la vraie course.",
    "Objectifs écrits et partagés avant la course (Koerner) : A 10 h 30, B 11 h 00, C finir dans les barrières.",
    "Ravitos : moins de 2 minutes chacun — 2 min perdues × 15 ravitos = 30 min sur les barrières (Koerner).",
    "La vraie bonne nuit est celle d'avant-veille (Koerner) ; rien de neuf le jour J — jamais.",
    "Les courses préparatoires (S15, S19) servent de répétition générale : départ contrôlé, matériel et ravito du jour J — pas de performance."
  ]}
];

/* ================= séances standard (formulaire d'ajout, onglet Semaine) ================= */
const STD_SESSIONS = [
  { g: "Renforcement", items: [
    { c: "RMA", t: "RM-A · Jambes & chaîne postérieure", m: 35 },
    { c: "RMB", t: "RM-B · Tronc, fessiers & cheville", m: 30 },
    { c: "RMC", t: "RM-C · Pliométrie & gammes", m: 20 },
    { c: "CORDE", t: "Corde à sauter", m: 15 },
    { c: "GAING", t: "Gainage léger", m: 10 },
    { c: "PROP", t: "Proprioception", m: 10 },
    { c: "MAS", t: "Automassage / mobilité", m: 15 }
  ]},
  { g: "Course", items: [
    { c: "EP", t: "Endurance plate", m: 45 },
    { c: "EV", t: "Endurance vallonnée", m: 60 },
    { c: "SL", t: "Sortie longue", m: 120 },
    { c: "DT", t: "Technique de descente", m: 40 },
    { c: "SQ1", t: "SQ1 · Qualité (VMA courte)", m: 45 },
    { c: "SQ2", t: "SQ2 · Qualité (côtes)", m: 50 },
    { c: "SQ3", t: "SQ3 · Qualité (seuil)", m: 50 },
    { c: "SQ4", t: "SQ4 · Fartlek", m: 50 },
    { c: "LD", t: "Longue durée", m: 90 }
  ]},
  { g: "Complément", items: [
    { c: "V", t: "Vélo", m: 90 },
    { c: "NAT", t: "Natation", m: 45 },
    { c: "YOGA", t: "Yoga", m: 60 },
    { c: "GAM", t: "Gammes", m: 30 },
    { c: "REST", t: "Repos", m: 0 }
  ]}
];

/* ================= quotidiennes — hygiène du coureur =================
   Proposées chaque jour, cochables, mais COMPTÉES À PART du volume
   (ni dans les minutes planifiées, ni dans le réalisé). */
const DAILY = [
  { c: "PROP", t: "Proprioception 5' — unipodale 30\"/jambe × 3 (cheville)", why: "anti-entorse, ta cheville est ton point faible" },
  { c: "MAS", t: "Automassage 5' — fessier, TFL, essuie-glace + étirements doux", why: "anti-essuie-glace, à faire dès que tu penses au programme" }
];

/* ================= feuille nutrition (onglet Aide > Nutrition) =================
   Synthèse « manger / éviter » par moment de la journée d'un coureur, orientée
   récupération (acidité musculaire, crampes, tendons), sobriété carbone et
   régime majoritairement végétarien. Reste alignée avec les règles du plan :
   60-90 g CH/h en course, récup 3:1 dans les 30-45', rien de nouveau le jour J. */
const FOOD_SHEET = [
  { cat: "Quotidien — la base",
    good: ["Légumineuses (lentilles, pois chiches, haricots) : protéines + fer, l'aliment le plus sobre en CO2",
      "Céréales complètes (avoine, riz complet, quinoa, pâtes complètes) : glucides lents + magnésium",
      "Oléagineux (noix, amandes, noisettes) : oméga-3, magnésium — une poignée/jour",
      "Fruits de saison et locaux (pomme, poire, prune…) et fruits séchés (dattes, abricots, raisins)",
      "Légumes verts et colorés à chaque repas, dont une portion crue (vitamine C, antioxydants)",
      "Eau plate à volonté — vérifie la couleur des urines (claires = bien hydraté)"],
    bad: ["Viande rouge et charcuterie plus de 1-2 fois/semaine (charge acide, CO2 élevé)",
      "Produits ultra-transformés, sodas, sucreries industrielles (inflammation de fond)",
      "Alcool (ralentit la récupération et le sommeil profond)"],
    why: "80 % des effets se jouent sur l'assiette quotidienne, pas sur le jour de séance. Une base végétale et complète couvre fer, magnésium et oméga-3, les trois carences classiques du coureur." },
  { cat: "Avant l'effort (0 à 3 h)",
    good: ["2-3 h avant : repas riche en glucides, léger en fibres et graisses (avoine, riz, pâtes)",
      "30-60' avant si sortie du matin : 20-40 g de glucides simples (banane, dattes, tartine miel)",
      "Café 30-60' avant si tu le tolères — jamais testé pour la première fois le jour J"],
    bad: ["Fibres en grande quantité juste avant (légumes crus, légumineuses non testées)",
      "Plats gras ou frits dans les 3 h (digestion lente)",
      "Sucres rapides 10' avant le départ en dehors de la sortie très courte (pic puis creux d'énergie)"],
    why: "Le but : des réserves pleines et un estomac vide. Tout ce qui stagne dans l'estomac part dans les jambes en moins." },
  { cat: "Pendant l'effort (> 1 h)",
    good: ["60-90 g de glucides par heure dès que l'effort dépasse 1 h 30 (dès S9 sur les sorties longues)",
      "500 à 750 ml d'eau par heure ; par forte chaleur, ajoute du sodium (600-800 mg/l bu)",
      "Alterner sucré/salé quand le sucre écœure ; fractionner une prise toutes les 20-25 min",
      "Compotes et barres maison de l'onglet Recettes : testées à l'entraînement, jamais neuves en course"],
    bad: ["Boire uniquement quand on a soif sur les efforts longs (la soif arrive trop tard)",
      "Trop boire de l'eau seule sur très longs efforts (hyponatrémie — le vrai danger, pire que la déshydratation)",
      "Ibuprofène ou anti-inflammatoire pendant l'effort (risque rénal, rhabdomyolyse)"],
    why: "Règle Koop : « les calories dans la poche, l'hydratation dans les bidons ». Chaque sortie longue répète le ravitaillement du jour J." },
  { cat: "Récupération (0 à 45' après)",
    good: ["Dans les 30-45' : 20 g de protéines + glucides au ratio ~3:1 (skyr + fruits, ou plat Recettes)",
      "Réhydrater jusqu'à retrouver des urines claires (+ une pincée de sel si transpiration abondante)",
      "Anti-inflammatoires naturels au repas : fruits rouges, curcuma + poivre, gingembre, oméga-3 (noix, colza)"],
    bad: ["Sauter la fenêtre de récupération « je mangerai plus tard » (resynthèse du glycogène divisée)",
      "Alcool juste après l'effort (vide les réserves de glycogène)",
      "Grignotage sucré sans protéines"],
    why: "La fenêtre des 45' est le meilleur rapport effort/bénéfice de toute la nutrition du coureur. Après, on reconstruit à peine." },
  { cat: "Crampes & acidité musculaire",
    good: ["Sodium régulier en course (sel, bouillon, compotes salées) et potassium quotidien (banane, dattes, abricots secs)",
      "Magnésium par l'alimentation : oléagineux, céréales complètes, légumes verts",
      "Départs progressifs : l'acidité (lactate) vient de l'intensité, pas de l'assiette — monter doucement les allures",
      "Échauffement 10-15' avant toute séance qualité (SQ1-SQ4)"],
    bad: ["Départ trop violent (la cause n°1 de l'acidose ressentie dans les muscles)",
      "Déshydratation : crampes et acidité aggravées",
      "Chargement en sel uniquement le jour J sans l'avoir testé",
      "Compléments « anti-acide » miracles : aucun ne fait mieux que progressivité + hydratation + glucides"],
    why: "Aucun aliment n'« efface » l'acide lactique : il se recycle en carburant dès que l'allure retombe. Ce qui marche : partir doucement, boire, recharger en glucides — et assiette quotidienne peu acidifiante pour récupérer plus vite." },
  { cat: "Tendons & articulations (essuie-glace, cheville)",
    good: ["20-40 g de protéines à chaque repas (légumineuses, tofu, tempeh, skyr) : le tendon se construit avec",
      "Collagène ou gélatine (10-15 g) + vitamine C (jus d'orange-citron) 30-60' autour des séances de renforcement/pliométrie",
      "Vitamine C quotidienne : kiwi, agrumes, poivron cru, fruits rouges (synthèse du collagène)",
      "Oméga-3 quotidiens : noix, graines de lin, huile de colza (inflammation maîtrisée)"],
    bad: ["Protéines insuffisantes (le tendon ne se répare pas), régimes extrêmes ou yo-yo",
      "Augmenter trop vite le volume de dénivelé négatif (règle du plan : +10-15 % par mois maximum)",
      "Courir sur un tendon déjà douloureux > 3/10 deux séances de suite (règle de la douleur du plan)"],
    why: "Le tendon est un tissu lent : il adore la routine (charge progressive régulière) et les apports constants, pas les cures." }
];

/* ================= recettes (onglet Aide > Recettes) =================
   Végétariennes par défaut (la viande reste possible ailleurs), sobres en
   carbone : légumineuses, fruits de saison, séchés (transport sec), pas de
   viande ni de fromage lourd. Pensées pour l'entraînement trail : avant,
   pendant (transportable, testable en course), après (3:1, tendons). */
const RECIPES = [
  /* --- après l'effort : construire muscle + tendons (10) --- */
  { cat: "renfort", title: "Dahl de lentilles corail aux épinards",
    when: "Repas après séance (45' de préparation passive)", time: "25'",
    ing: ["150 g lentilles corail", "1 oignon + 2 gousses d'ail", "200 g tomates concassées", "200 g épinards", "1 c.à.c curcuma + cumin", "Riz basmati complet"],
    steps: ["Faire revenir oignon et ail, ajouter épices puis lentilles rincées et tomates.", "Couvrir d'eau, mijoter 20' jusqu'à ce que les lentilles fondent.", "Ajouter les épinards en fin de cuisson, saler.", "Servir sur riz complet."],
    note: "~22 g de protéines + fer (épinards) absorbé grâce à la vitamine C des tomates. Les lentilles sont la protéine la plus sobre en CO2.", eco: "A" },
  { cat: "renfort", title: "Tofu fumé curry-patate douce",
    when: "Repas après séance", time: "30'",
    ing: ["200 g tofu fumé", "300 g patate douce", "150 ml lait de coco léger", "curry, gingembre", "Riz ou millet"],
    steps: ["Cuire la patate douce en cubes vapeur 15'.", "Poêler le tofu en dés, ajouter curry et gingembre.", "Ajouter patate douce et lait de coco, 10' à feu doux."],
    note: "Protéines complètes du soja + beta-carotène. Le curry apporte de la curcumine (anti-inflammatoire) — poivrer pour l'absorption.", eco: "A" },
  { cat: "renfort", title: "Chili végétarien aux trois haricots",
    when: "Repas après séance ou veille de sortie longue (charge en glucides)", time: "35'",
    ing: ["150 g haricots rouges", "150 g pois chiches", "100 g haricots noirs", "1 poivron, 1 oignon", "400 g tomates concassées", "paprika fumé, cumin", "Riz complet"],
    steps: ["Faire revenir oignon et poivron, ajouter épices.", "Ajouter tomates et légumes secs (en conserve : rincés), mijoter 20'.", "Servir sur riz complet, coriandre fraîche."],
    note: "Gros apport protéines + fibres. Si la séance qualité est le lendemain matin, le cuisiner la veille à midi (fibres plus tolérées).", eco: "A" },
  { cat: "renfort", title: "Buddha bowl quinoa-pois chiches-avocat",
    when: "Repas après séance", time: "20'",
    ing: ["80 g quinoa", "150 g pois chiches", "1/2 avocat", "1 betterave cuite", "Graines de courge", "Huile d'olive-citron"],
    steps: ["Cuire le quinoa 12-15'.", "Assembler tiède avec pois chiches rincés, betterave en dés, avocat.", "Vinaigrette citron-huile d'olive, graines de courge torréfiées."],
    note: "Quinoa + pois chiches = protéines complètes sans viande. Betterave : nitrates naturels bénéfiques à l'endurance. C'est le « bol de récupération » végétarien recommandé par u-trail (quinoa, pois chiches, légumes rôtis, sauce tahini).", eco: "A", src: "u-trail.com" },
  { cat: "renfort", title: "Omelette tofu-légumes + patate douce rôtie",
    when: "Repas après séance (matin)", time: "20'",
    ing: ["200 g tofu soyeux", "1 patate douce", "poivron, épinards", "curcuma + poivre", "Huile d'olive"],
    steps: ["Rôtir la patate douce en quartiers 25' à 200°C (à avancer la veille).", "Écraser le tofu, poêler avec les légumes et le curcuma.", "Servir ensemble."],
    note: "Version sans œuf de l'omelette : protéines légères et digestes, curcumine + poivre pour l'inflammation.", eco: "A" },
  { cat: "renfort", title: "Pâtes complètes pois chiches-tomates (pasta e ceci)",
    when: "Repas après séance ou veille de course", time: "20'",
    ing: ["100 g pâtes complètes", "150 g pois chiches", "400 g tomates concassées", "ail, romarin", "parmesan végétal (levure maltée) optionnel"],
    steps: ["Poêler l'ail et le romarin, ajouter tomates et pois chiches, 10'.", "Cuire les pâtes, mélanger, finir à la poêle avec un peu d'eau de cuisson."],
    note: "Le classique italien du 3:1 : glucides des pâtes + protéines des pois chiches dans un seul plat. Digeste la veille d'une course.", eco: "A" },
  { cat: "renfort", title: "Tempeh sauté brocolis-sésame, riz complet",
    when: "Repas après séance", time: "25'",
    ing: ["120 g tempeh", "200 g brocoli", "1 gousse d'ail", "sauce soja, graines de sésame", "Riz complet"],
    steps: ["Vapeur le brocoli 6'.", "Poêler le tempeh en lamelles avec l'ail, déglacer à la sauce soja.", "Servir sur riz, sésame grillé."],
    note: "Le tempeh (soja fermenté) : protéines bien assimilées + isoflavones. Brocoli = vitamine C et K pour le collagène et l'os.", eco: "A" },
  { cat: "renfort", title: "Shot « tendons » : collagène + vitamine C",
    when: "30-60' avant ou après la séance de renforcement / pliométrie (RM-A/B/C, corde)", time: "2'",
    ing: ["10-15 g collagène hydrolysé ou gélatine alimentaire", "1 jus d'orange pressé (ou citron)", "200 ml d'eau"],
    steps: ["Dissoudre le collagène dans l'eau tiède (il fond sans chauffe).", "Ajouter le jus d'orange-citron et boire."],
    note: "Protocole classique de soutien du tendon : acides aminés (glycine, proline) + vitamine C au moment où le tendon travaille. À associer au travail excentrique progressif du plan, pas à la place.", eco: "B" },
  { cat: "renfort", title: "Salade de lentilles vertes, feta, betterave et noix",
    when: "Repas après séance (à préparer à l'avance)", time: "15' + repos",
    ing: ["120 g lentilles vertes", "60 g feta", "1 betterave cuite", "Une poignée de noix", "vinaigrette moutarde-huile d'olive"],
    steps: ["Cuire les lentilles 25' (ou la veille), laisser tiédir.", "Mélanger avec betterave en dés, noix, feta émiettée."],
    note: "Fer + protéines, oméga-3 des noix. Se garde 3 jours au frais — pratique pour les semaines chargées.", eco: "A" },
  { cat: "renfort", title: "Skyr-avoine-fruits rouges",
    when: "Collation/repas après séance, dans les 45'", time: "3'",
    ing: ["250 g skyr ou fromage blanc épais", "30 g flocons d'avoine", "100 g fruits rouges (surgelés acceptés)", "1 c.à.s miel", "1 noix concassée"],
    steps: ["Mélanger skyr et flocons, laisser reposer 5'.", "Ajouter fruits rouges, miel, noix."],
    note: "20-25 g de protéines rapides + le ratio 3:1 avec les fruits. Les fruits rouges (anthocyanes) limitent les douleurs musculaires post-effort.", eco: "A" },

  /* --- compotes énergétiques pendant la course (6) --- */
  { cat: "compote", title: "Purée de dattes-pomme-citron (la base)",
    when: "Pendant l'effort, en gourde souple — 1 portion = ~30 g de glucides", time: "15'",
    ing: ["200 g dattes dénoyautées", "300 g pommes", "Jus d'un citron", "1 pincée de sel"],
    steps: ["Mixer les dattes avec un peu d'eau chaude.", "Ajouter les pommes crues mixées (ou compotées 10') et le citron.", "Répartir en gourdes souples de ~80 g."],
    note: "~65 g de glucides/100 g : l'équivalent d'un gel, avec potassium et fibres douces. Se garde 4-5 jours au frais, se congèle en portions.", eco: "A", src: "Nicolas Aubineau (variations)" },
  { cat: "compote", title: "Compote énergétique pomme-lait de soja (référence du diététicien)",
    when: "Pendant l'effort — 1 portion de 200-250 g = ~42 g de glucides", time: "35'",
    ing: ["6 pommes", "1/2 L de lait de soja nature", "150 g de sucre complet", "2 c.à.c extrait de vanille", "2 c.à.c extrait de café", "4 pincées de fleur de sel"],
    steps: ["Éplucher, épépiner, couper les pommes en morceaux.", "Porter à ébullition lait de soja + sucre + extraits, ajouter les pommes, cuire 30' à feu doux en remuant.", "Mixer lisse, verser en flasques ou gourdes souples."],
    note: "La recette de référence de Nicolas Aubineau (diététicien nutritionniste) : ~202 kcal et 41,7 g de glucides par compote, sodium (95 mg) et potassium (280 mg) inclus. Version volontairement liquide (facile à assimiler) ; ajouter du sel par grosse chaleur. Se conserve plusieurs jours au frais.", eco: "A", src: "nicolas-aubineau.com" },
  { cat: "compote", title: "Compote salée patate douce-carotte (l'alternative aux gels)",
    when: "Pendant l'effort long — quand le sucré écœure ; 1 gourde/h au-delà de 2 h", time: "30'",
    ing: ["300 g patate douce", "150 g carotte", "30 g sirop de riz (ou 20 g maltodextrine)", "50 g crème d'avoine en poudre", "1/4 c.à.c sel marin", "curcuma + gingembre"],
    steps: ["Cuire les légumes vapeur 20-30', bien égoutter.", "Mixer chauds avec sirop de riz, crème d'avoine, sel et épices jusqu'à une purée lisse.", "Rectifier l'assaisonnement après refroidissement (la texture s'épaissit), remplir les gourdes à 80 %."],
    note: "Recette Mulebar : ~65 g = 25-30 g de glucides et 300-400 mg de sodium — parfait quand le sucré écœure. Prendre en petites gorgées toutes les 15' ; sur ultra, alterner compote sucrée et salée toutes les 50'. Frigo 2-3 jours, congélateur 1-3 mois.", eco: "A", src: "mulebar.com" },
  { cat: "compote", title: "Compote pomme-châtaigne-miel",
    when: "Pendant l'effort — 1 portion = ~28 g de glucides", time: "10'",
    ing: ["200 g compote de pomme nature", "90 g crème de châtaigne", "30 g miel", "1 pincée de sel"],
    steps: ["Mélanger tous les ingrédients à froid jusqu'à consistance lisse.", "Verser dans une flasque ou gourde souple — se consomme en plusieurs prises."],
    note: "Recette Raidlight : 113 kcal et 28 g de glucides par portion, très digeste. La châtaigne apporte des glucides complexes ; prête en 10 minutes.", eco: "A", src: "raidlight.com" },
  { cat: "compote", title: "Compote patate douce-orange-érable",
    when: "Pendant l'effort (le « solide » des ultras)", time: "20'",
    ing: ["400 g patate douce", "1 orange (zeste + jus)", "2 c.à.s sirop d'érable", "1 pincée de sel", "cannelle"],
    steps: ["Cuire la patate douce vapeur 20', écraser.", "Ajouter orange, érable, sel, cannelle ; mixer lisse."],
    note: "Le carburant solide des coureurs d'ultra : digère mieux que le sucre pur sur la durée. Bêta-carotène inclus. Cousine de la « sweet potato mash » salée Raidlight (300 g patate douce + 10 g huile d'olive + 4 g sel) pour les goûts salés.", eco: "A", src: "raidlight.com (variante)" },
  { cat: "compote", title: "Compote pomme-banane-miel-sel",
    when: "Pendant l'effort", time: "15'",
    ing: ["3 pommes", "2 bananes mûres", "2 c.à.s miel", "1 pincée de sel"],
    steps: ["Compoter les pommes 10' à couvert.", "Hors du feu, écraser les bananes, ajouter miel et sel, mixer."],
    note: "Potassium de la banane + sodium du sel : le duo anti-crampes. Moins sucrée que la purée de dattes — parfaite sur sortie longue en alternance avec la compote salée.", eco: "A", src: "—" },

  /* --- juste avant la course (6) --- */
  { cat: "avant", title: "Porridge avoine-dattes-chia-beurre d'amande",
    when: "Petit-déjeuner pré-course (u-trail) ou 45-60' avant", time: "5'",
    ing: ["40 g flocons d'avoine", "3 dattes émincées", "1 c.à.s graines de chia", "1 c.à.c beurre d'amande", "200 ml boisson d'amande ou lait", "cannelle"],
    steps: ["Micro-ondes 2-3' avec la boisson.", "Ajouter dattes, chia, beurre d'amande, cannelle ; laisser reposer 2'."],
    note: "Le petit-déjeuner végétarien de référence des traileurs (u-trail) : ~45 g de glucides à libération progressive, oméga-3 du chia. Rien de nouveau le jour J : le tester d'abord sur les sorties longues.", eco: "A", src: "u-trail.com" },
  { cat: "avant", title: "Pancakes avoine-banane (3 ingrédients)",
    when: "45-60' avant une séance qualité", time: "10'",
    ing: ["1 banane mûre", "40 g flocons d'avoine mixés", "1 œuf (ou 1 c.à.s de lin moulu + 3 c.à.s d'eau)"],
    steps: ["Écraser la banane, mélanger le tout.", "Cuire des petits pancakes 2' par face à la poêle sèche."],
    note: "20-30 g de glucides, léger. Version du « snack 1-2 h avant » de menu-vegetarien.com ; à tester à l'entraînement avant d'en faire le petit-déj du jour J.", eco: "A", src: "menu-vegetarien.com (timing)" },
  { cat: "avant", title: "Tartines purée d'amande-miel",
    when: "30-45' avant", time: "2'",
    ing: ["2 tranches pain complet", "2 c.à.c purée d'amande", "1 c.à.s miel"],
    steps: ["Tartiner, manger lentement, boire un verre d'eau avec."],
    note: "Le duo rapide avant une sortie courte du matin : 25 g de glucides sans poids dans l'estomac. Banane + beurre d'amande = le snack 1-2 h avant conseillé par menu-vegetarien.com.", eco: "A", src: "menu-vegetarien.com" },
  { cat: "avant", title: "Smoothie banane-fruits rouges-épinards",
    when: "1-2 h avant, quand l'appétit manque", time: "3'",
    ing: ["1 banane", "1 poignée de fruits rouges", "1 poignée d'épinards frais", "2 dattes", "250 ml lait d'amande"],
    steps: ["Mixer le tout 30 secondes."],
    note: "Liquide = vidange gastrique rapide : le snack pré-course de menu-vegetarien.com (épinards pour les nitrates, banane pour le potassium). ~40 g de glucides à index glycémique modéré.", eco: "A", src: "menu-vegetarien.com" },
  { cat: "avant", title: "Gâteau sportif pré-course (sport cake)",
    when: "Petit-déjeuner avant course ou sortie longue — cuit la veille", time: "10' + 50' de four",
    ing: ["200 g farine (sans gluten si besoin)", "80 g protéines végétales en poudre", "60 g graines de chia moulues", "40 g huile d'olive", "80 g miel", "80 g pépites de chocolat", "500 g boisson végétale", "1/2 sachet de levure", "4 g sel"],
    steps: ["Mélanger tous les ingrédients.", "Cuire 50' à 180°C dans un moule à cake."],
    note: "Le « sport cake » Raidlight : énergétique et digeste, riche en protéines (26,9 g et 84,5 g de glucides par part) — le petit-déjeuner de compétition de beaucoup de traileurs. Se congèle en tranches.", eco: "B", src: "raidlight.com" },
  { cat: "avant", title: "Riz au lait-dattes de la veille",
    when: "Avant une sortie longue (préparé la veille)", time: "5' le matin",
    ing: ["Riz cuit de la veille (100 g)", "150 ml lait d'amande", "2 dattes", "cannelle"],
    steps: ["Réchauffer riz + lait + dattes émincées 4'.", "Cannelle à volonté."],
    note: "Les coureurs de fond re-découvrent le riz avant course : digère mieux que le blé pour beaucoup d'estomacs.", eco: "A", src: "—" },

  /* --- barres pendant la course (6) --- */
  { cat: "barre", title: "Barres dattes-cacao-noisettes",
    when: "Pendant l'effort — 1 barre ≈ 25-30 g de glucides", time: "15' + 1 h au frais",
    ing: ["250 g dattes dénoyautées", "100 g noisettes", "2 c.à.s cacao", "1 pincée de sel"],
    steps: ["Mixer noisettes puis dattes en pâte — sans trop insister, garder du grain.", "Pétrir avec cacao et sel, presser fermement dans un moule, laisser reposer 1 h au frais avant de trancher."],
    note: "La barre de référence : dense, tient dans la poche, se coupe en bouchées. Cacao = magnésium. Règle de terrain (reference-trail) : bien presser la pâte, laisser le temps de repos, ne pas trop mixer — sinon la barre s'effrite.", eco: "A", src: "reference-trail.fr (méthode)" },
  { cat: "barre", title: "Barres traileur noix-pistaches-gingembre-citron",
    when: "Pendant l'effort long — la barre « digestion facile » testée sur ultras", time: "20' + 1 h au frais",
    ing: ["50 g amandes entières", "100 g noix mélangées (cajou, pécan, Grenoble)", "50 g pistaches", "100 g dattes dénoyautées", "2 c.à.s poudre de cacao maigre", "2 c.à.s éclats de fèves de cacao", "2 c.à.s huile de coco fondue", "1 c.à.s gingembre en poudre", "1 c.à.s écorces de citron en poudre", "4 pincées de sel"],
    steps: ["Mixer grossièrement noix, amandes, pistaches (texture granuleuse, pas en poudre).", "Ajouter dattes, cacao, fèves de cacao, huile de coco, gingembre, citron, sel ; pétrir.", "Presser très fermement dans un plat, 1 h au frais, trancher en 12 barres."],
    note: "La recette testée 3 ans sur tous ses trails par Quentin André (reference-trail) : ~0,45 € la barre, naturellement sans gluten, riches en potassium (pistaches), magnésium (cacao) et anti-inflammatoire (gingembre). Variantes : plus de dattes en ultra-distance, moins de fibres pour digestion facile.", eco: "A", src: "reference-trail.fr" },
  { cat: "barre", title: "Flapjacks avoine-miel",
    when: "Pendant l'effort ou au ravito", time: "25'",
    ing: ["200 g flocons d'avoine", "100 g miel", "60 g beurre de cacahuète", "1 pincée de sel"],
    steps: ["Chauffer miel + beurre de cacahuète, mélanger aux flocons.", "Presser dans un plat, four 15' à 160°C, couper froid."],
    note: "Riche et tenace : la barre « solide » qui rassasie sur les ultras. Moins collante à froid qu'à la chaleur.", eco: "A", src: "—" },
  { cat: "barre", title: "Barres avoine-noix de pécan-canneberges (cuites, style u-trail)",
    when: "Pendant l'effort ou au ravito maison", time: "35'",
    ing: ["3 verres de flocons d'avoine", "2 verres de noix de pécan", "1/2 verre de canneberges séchées", "1,5 verre de dattes dénoyautées", "1 verre d'amandes", "1/4 de verre d'huile de colza", "1/2 verre de sirop d'érable", "1/4 de verre de vergeoise brune (ou sucre roux)", "3 pincées de sel", "1 c.à.c bicarbonate (facultatif)"],
    steps: ["Mixer les noix, verser dans un saladier avec avoine, sel et bicarbonate.", "Mixer les amandes avec l'huile de colza pour une pâte lisse ; ajouter sucre, dattes et sirop d'érable.", "Mélanger le tout, étaler dans un plat, four 30' à 160°C, découper après refroidissement."],
    note: "La recette u-trail (par verres, sans balance) : avoine pour l'énergie progressive, noix de pécan et colza pour les oméga-3, canneberges pour l'acidité qui relance l'appétit en course.", eco: "A", src: "u-trail.com" },
  { cat: "barre", title: "Barres croustillantes riz-amandes",
    when: "Pendant l'effort (estomac facile)", time: "15'",
    ing: ["100 g riz soufflé", "50 g amandes concassées", "80 g miel ou sirop d'érable", "1 pincée de sel"],
    steps: ["Chauffer le miel, mélanger au riz soufflé et amandes.", "Presser, trancher, laisser durcir."],
    note: "Très digeste (peu de fibres) : à privilégier quand l'estomac se ferme en course. Moins dense : prévoir 2 barres/heure de ravito.", eco: "A", src: "runchallenge.fr (principe)" },
  { cat: "barre", title: "Barres banane-avoine-coco",
    when: "Pendant l'effort", time: "25'",
    ing: ["2 bananes très mûres", "150 g flocons d'avoine", "30 g noix de coco râpée", "1 pincée de sel"],
    steps: ["Écraser les bananes, mélanger tout.", "Étaler 1 cm, four 15' à 180°C, couper en barres."],
    note: "La plus « gâteau » des barres — bonne pour l'envie de vrai food en course. Se garde 4 jours.", eco: "A", src: "—" },

  /* --- les meilleures recettes après la course (5) --- */
  { cat: "apres", title: "Boisson de récupération dattes-skyr",
    when: "Dans les 30' suivant l'effort — la plus importante de la journée", time: "2'",
    ing: ["200 g skyr", "3 dattes", "200 ml d'eau", "1 pincée de sel"],
    steps: ["Mixer le tout 30 secondes, boire frais."],
    note: "Le 3:1 en buvant, quand l'appétit manque après l'effort. Glucides des dattes + 20 g de protéines du skyr + sodium. À garder au frais prête dans le sac pour les sorties longues.", eco: "A" },
  { cat: "apres", title: "Riz au lait d'amande-dattes-cannelle",
    when: "Repas après sortie longue", time: "20' (+ cuisson du riz)",
    ing: ["100 g riz rond cuit", "300 ml lait d'amande", "3 dattes", "cannelle", "20 g amandes concassées"],
    steps: ["Mijoter riz et lait 15'.", "Hors du feu : dattes émincées, cannelle, amandes."],
    note: "Recharge glucides douce après les efforts longs ; digère bien même fatigué. Les amandes ramènent les oméga-3.", eco: "A" },
  { cat: "apres", title: "Wrap houmous-crudités",
    when: "Déjeuner après séance du midi (SQ, EP)", time: "5'",
    ing: ["1 galette complète", "80 g houmous", "carotte, concombre, salade", "graines germées optionnelles"],
    steps: ["Tartiner la galette de houmous, ajouter les crudités, rouler."],
    note: "Les pois chiches du houmous font protéines ET glucides : un wrap suffit pour la fenêtre de récupération du mid-runner.", eco: "A" },
  { cat: "apres", title: "Pâtes complètes-lentilles-tomates express",
    when: "Dîner après séance", time: "20'",
    ing: ["80 g pâtes complètes", "70 g lentilles vertes précuites (ou conserve)", "300 g tomates concassées", "ail, laurier"],
    steps: ["Réchauffer tomates + lentilles + ail 10'.", "Mélanger aux pâtes cuites, huile d'olive crue."],
    note: "Le dîner 3:1 du coureur, en 20 minutes : glycogène pour la séance du lendemain + protéines pour la nuit.", eco: "A" },
  { cat: "apres", title: "Smoothie vert banane-épinards-dattes",
    when: "Collation après séance, avant le repas", time: "3'",
    ing: ["1 banane", "2 poignées d'épinards frais", "2 dattes", "250 ml d'eau", "Jus d'un demi-citron"],
    steps: ["Mixer le tout, boire de suite."],
    note: "Nitrates des épinards (oxygénation), potassium banane, vitamine C du citron pour le collagène. Complément du vrai repas qui suit, pas un substitut.", eco: "A" }
];
const RECIPE_CATS = [
  { id: "renfort", label: "Muscle & tendons — après l'effort", when: "à manger après une séance de renforcement, corde ou pliométrie" },
  { id: "compote", label: "Compotes énergétiques — pendant la course", when: "en gourde souple, à tester sur chaque sortie longue" },
  { id: "avant", label: "Juste avant la course", when: "20-45' avant le départ" },
  { id: "barre", label: "Barres — pendant la course", when: "1 barre ≈ 25-30 g de glucides, dans la poche" },
  { id: "apres", label: "Meilleures recettes après la course", when: "dans la fenêtre des 30-45'" }
];

/* ================= conseils post-exercice (popup fin de séance) =================
   Affiché à la fin d'un exercice (minuteur ou routine guidée) : récupération
   immédiate, étirements, et quoi/quand manger. Aligné sur les règles du plan. */
const POSTEXO = {
  now: ["Marche 5' ou vélo très léger pour redesouffler — jamais à l'arrêt brutal.",
    "Si la séance était intense : 5' d'automassage doux fessier / TFL / essuie-glace."],
  stretch: ["Étirements doux 20-30'' par groupe, sans forcer : mollets, quadriceps, ischio, fessiers, psoas.",
    "Sur tendon sensible (essuie-glace, cheville > 3/10) : pas d'étirement agressif — glace 10-15' et voir la règle de la douleur du plan.",
    "Gainage léger ou proprioception 5' si tu es frais : toujours rentable pour la cheville."],
  food: ["Dans les 30-45' : ~20 g de protéines + glucides ratio 3:1 (ex. skyr-avoine-fruits, boisson dattes-skyr — voir onglet Recettes).",
    "Bois avant d'avoir soif : réhydrate jusqu'à urines claires ; par grosse chaleur, un peu de sel avec l'eau.",
    "Si renforcement / pliométrie / corde : 10-15 g de collagène ou gélatine + vitamine C (jus d'orange) autour de la séance — le tendon en profite.",
    "Jamais d'ibuprofène autour de l'effort ; anti-inflammatoires naturels au repas suivant : fruits rouges, curcuma-poivre, oméga-3."],
  warn: "Douleur vive pendant ou après : ce n'est pas normal — ajuste la séance (règle du plan : douleur > 3/10 deux séances de suite => alléger, kiné si ça persiste)."
};
