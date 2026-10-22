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
  { n: 15, vol: 7.75, light: false, days: [
    lundi(35), [], [I("midi", "SQ2", 50, "Côtes : 4 × 3' en côte")], rmb(25),
    evdt(55, "6 × 1'"), v(105), sl(195, 1300, "(premier test ravitaillement complet)")
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
  { n: 19, vol: 8.25, light: false, days: [
    lundi(30), [], [I("midi", "SQ2", 50, "Côtes : 5 × 3' en côte + descentes vives")], rmb(25),
    evdt(55, "10 × 1'"), v(120), sl(225, 1600, "(ou trail 28-32 km en course)")
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
    sl(270, 1900, "(la plus grosse sortie du programme)")
  ]},
  { n: 24, vol: 4.5, light: true, days: [
    lundi(20), [], [I("midi", "EV", 45, "EV 45'")], rmb(15),
    ep(40), v(75), [I("autre", "CAP", 75, "CAP 1 h 15")]
  ]},
  { n: 25, vol: 7.5, light: false, days: [
    lundi(20), [], [I("midi", "SQ3", 50, "Seuil : 3 × 10' (récup 3')")], rmb(15),
    evdt(55, "6 × 1'"), v(90),
    sl(210, 1500, "à l'allure course — répétition générale : ravitaillement complet, matériel de course")
  ]},
  { n: 26, vol: 5, light: false, days: [
    lundiGain(15), [I("matin", "CORDE", 10, "Corde à sauter 10' : 3 × 1'")], [I("midi", "SQ2", 50, "Côtes : 5 × 2' en côte"), I("midi", "DT", 0, "+ DT : 6 × 45''")], rmb(15),
    [I("midi", "EV", 50, "EV 50'"), I("midi", "GAM", 0, "+ gammes")], v(60),
    [I("autre", "V", 90, "Vélo 1 h 30"), I("autre", "CAP", 30, "+ CAP 30'")]
  ]},
  { n: 27, vol: 4.5, light: false, days: [
    lundiGain(15), [], [I("midi", "SQ3", 45, "Seuil : 3 × 8' (récup 3')")], rmb(15),
    evdt(45, "4 × 1'"), v(60),
    sl(135, 900, "à l'allure course")
  ]},
  { n: 28, vol: 2.75, light: false, days: [
    lundiGain(10, 30), [I("matin", "CORDE", 8, "Corde à sauter 8' douce")], [I("midi", "SQ2", 45, "Côtes : 6 × 1' en côte"), I("midi", "DT", 0, "+ DT : 3 × 45''")], rmb(10),
    [I("midi", "EV", 40, "EV 40'")], v(45),
    [I("autre", "CAP", 60, "CAP 1 h dont 3 × 2' à l'allure course")]
  ]},
  { n: 29, vol: 6.3, light: false, days: [
    [I("autre", "NAT", 20, "Natation 20' souple"), I("midi", "YOGA", 45, "Yoga doux")],
    [I("matin", "GAING", 10, "Gainage 10'"), I("matin", "PROP", 5, "Proprioception")],
    [I("midi", "EP", 30, "EP 30' + 4 lignes droites")],
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
Appuie-toi sur l'état du programme et des sorties fourni ci-dessous ; si une information manque, demande-la.
Ne donne jamais de conseil médical : en cas de douleur persistante, oriente vers un kiné ou un médecin.
Contexte en temps réel ci-dessous (mis à jour à chaque question) :`;

function coachContext() {
  const w = currentWeek(), week = WEEKS[w - 1], blk = blockOf(w);
  const idx = todayIdx();
  const today = week.days[idx].map(it => "- [" + (isDone(w, idx, week.days[idx].indexOf(it)) ? "x" : " ") + "] " + TYPES[it.c].label + " : " + it.t).join("\n");
  const donePct = weekProgressPct();
  const wDone = doneMinutes(week), wPlan = plannedMinutes(week);
  const runs = state.runs.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6)
    .map(r => "- " + r.date + " (" + (TYPES[r.code] || { label: r.code }).label + ") : " +
      (r.dist ? r.dist.toFixed(1) + " km, " : "") + (r.dur ? Math.round(r.dur) + " min, " : "") +
      (r.dplus ? r.dplus + " m D+, " : "") +
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
  const km = state.runs.reduce((a, r) => a + (r.dist || 0), 0);
  const dp = state.runs.reduce((a, r) => a + (r.dplus || 0), 0);
  const j = daysBetween(isoDate(new Date()), RACE.date);
  return [
    COACH_SKILL,
    "\n[ÉTAT DU COUREUR]",
    "Date du jour : " + fmtDate(new Date()),
    "Semaine en cours : S" + w + " (" + blk.name + (week.light ? ", allégée" : "") + "), J-" + j + " avant la course.",
    "Programme réalisé : " + donePct + " % des séances cochées ; volume semaine : " + fmtHours(wDone) + " / " + fmtHours(wPlan) + " h.",
    "Séances prévues aujourd'hui :\n" + today,
    "Distance totale courue (enregistrée) : " + km.toFixed(1) + " km, D+ cumulé : " + dp + " m.",
    "Dernières sorties :\n" + runs,
    "Chaussures :\n" + shoes
  ].join("\n");
}
