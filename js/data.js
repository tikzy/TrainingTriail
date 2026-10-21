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
  { n: 2, vol: 4.5, light: false, days: [
    lundi(30), [], [I("midi", "EV", 45, "EV 45' + gammes"), I("midi", "GAM", 0, "Gammes de course (2-3 × 20'' de chaque)")], rmb(25),
    ep(45), v(75), [I("autre", "V", 90, "Vélo 1 h 30 ou CAP 1 h")]
  ]},
  { n: 3, vol: 5, light: false, days: [
    lundi(30), [], [I("midi", "EV", 50, "EV 50' — 300 m D+", { dplus: 300 })], rmb(25),
    ep(45), v(75), sl(90, 400)
  ]},
  { n: 4, vol: 4, light: true, days: [
    lundi(25), [], [I("midi", "EV", 45, "EV 45' souple")], rmb(20),
    ep(40), v(60), [I("autre", "V", 90, "Vélo 1 h 30"), I("autre", "LD", 0, "+ lignes droites")]
  ]},
  { n: 5, vol: 5.5, light: false, days: [
    lundi(30), [], [I("midi", "EV", 50, "EV 50' — 300 m D+", { dplus: 300 }), I("midi", "GAM", 0, "Gammes de course")], rmb(25),
    ep(45), v(90), sl(120, 500)
  ]},
  { n: 6, vol: 6, light: false, days: [
    lundi(30), [], [I("midi", "SQ4", 50, "Fartlek 20' dans EV 50'")], rmb(25),
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
    [I("matin", "RMC", 20, "RM-C 20' (pliométrie)"), I("autre", "V", 90, "Vélo 1 h 30")],
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
    [I("matin", "RMC", 20, "RM-C 20' (pliométrie)"), I("autre", "V", 105, "Vélo 1 h 45")],
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
    lundi(30), [], [I("midi", "SQ4", 50, "Fartlek vallonné 45'")], rmb(25),
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
    lundiGain(15), [], [I("midi", "SQ2", 50, "Côtes : 5 × 2' en côte"), I("midi", "DT", 0, "+ DT : 6 × 45''")], rmb(15),
    [I("midi", "EV", 50, "EV 50'"), I("midi", "GAM", 0, "+ gammes")], v(60),
    [I("autre", "V", 90, "Vélo 1 h 30"), I("autre", "CAP", 30, "+ CAP 30'")]
  ]},
  { n: 27, vol: 4.5, light: false, days: [
    lundiGain(15), [], [I("midi", "SQ3", 45, "Seuil : 3 × 8' (récup 3')")], rmb(15),
    evdt(45, "4 × 1'"), v(60),
    sl(135, 900, "à l'allure course")
  ]},
  { n: 28, vol: 2.75, light: false, days: [
    lundiGain(10, 30), [], [I("midi", "SQ2", 45, "Côtes : 6 × 1' en côte"), I("midi", "DT", 0, "+ DT : 3 × 45''")], rmb(10),
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
  { id: "squat", name: "Squat", routine: "A", muscles: "quadriceps, fessiers",
    sets: "3 séries de 12 à 20", tip: "Lestez (sac à dos) en bloc 2. Variante : squat sauté en RM-C.",
    desc: "Pieds largeur de bassin, descendez jusqu'à cuisses parallèles au sol, dos droit, talons ancrés.",
    timer: { mode: "reps", rest: 60, sets: 3 } },
  { id: "fente", name: "Fente arrière", routine: "A", muscles: "équilibre, unilatéral",
    sets: "3 séries de 8-12 par jambe", tip: "Genou avant au-dessus du pied, genou arrière descend sans toucher le sol.",
    desc: "Un grand pas en arrière, le genou arrière descend vers le sol sans le toucher, le genou avant reste au-dessus du pied.",
    timer: { mode: "reps", rest: 60, sets: 3 } },
  { id: "stepup", name: "Step-up", routine: "A", muscles: "geste de la montée",
    sets: "3 séries de 8-12 par jambe", tip: "Augmentez la hauteur puis la charge.",
    desc: "Montez sur une marche ou un banc en poussant sur la jambe d'appui, sans vous aider de la jambe libre, redescendez posé.",
    timer: { mode: "reps", rest: 60, sets: 3 } },
  { id: "bulgare", name: "Squat bulgare", routine: "A", muscles: "force unilatérale, contrôle du genou",
    sets: "3 séries de 8-10 par jambe (à partir du bloc 2)", tip: "",
    desc: "Pied arrière sur une chaise, descendez vertical, buste droit.",
    timer: { mode: "reps", rest: 60, sets: 3 } },
  { id: "pont", name: "Pont fessier", routine: "A", muscles: "fessiers, ischio-jambiers",
    sets: "3 séries de 15-20", tip: "2'' de pause en haut. Version sur une jambe en bloc 3.",
    desc: "Allongé, pieds à plat, poussez sur les talons pour lever les hanches, alignez épaules-hanches-genoux.",
    timer: { mode: "reps", rest: 60, sets: 3 } },
  { id: "mollets", name: "Montées sur pointes au bord d'une marche", routine: "A", muscles: "mollets, tendon d'Achille, cheville",
    sets: "3 séries de 12-20", tip: "Sur une jambe en bloc 2. L'exercice le plus rentable pour votre cheville.",
    desc: "Pointes de pieds sur le bord d'une marche, talon qui descend bas, montée complète, 1'' de pause en haut.",
    timer: { mode: "reps", rest: 45, sets: 3 } },
  { id: "stepdown", name: "Descente de marche lente (excentrique)", routine: "A", muscles: "quadriceps en excentrique : la clé des descentes",
    sets: "2 séries de 6 par jambe (à partir de S7)", tip: "Vous préparez les cuisses à freiner 2 800 m de descente.",
    desc: "Debout sur une marche, descendez le pied libre vers le sol en 4 secondes, sans poser le talon, puis remontez posé.",
    timer: { mode: "reps", rest: 60, sets: 2 } },
  { id: "planche", name: "Planche sur les avant-bras", routine: "B", muscles: "tronc entier",
    sets: "3 séries de 30'' à 60''", tip: "Avant-bras sous les épaules, nombrile rentré, respirez.",
    desc: "Corps aligné, nombril rentré, respirez. Ne laissez pas les hanches tomber.",
    timer: { mode: "hold", work: 45, rest: 60, sets: 3 } },
  { id: "planchelat", name: "Planche latérale", routine: "B", muscles: "obliques et fessier moyen (essuie-glace)",
    sets: "3 séries de 20'' à 45'' par côté", tip: "Montez les pieds sur un support pour durcir.",
    desc: "Sur l'avant-bras, hanche levée, corps aligné, bras libre levé vers le ciel.",
    timer: { mode: "hold", work: 30, rest: 45, sets: 3 } },
  { id: "deadbug", name: "Dead bug", routine: "B", muscles: "contrôle du bassin",
    sets: "2 séries de 10 par côté, lent", tip: "Lombaires collées au sol en permanence.",
    desc: "Sur le dos, lombaires collées au sol, tendez bras et jambe opposés sans décoller le dos.",
    timer: { mode: "reps", rest: 45, sets: 2 } },
  { id: "birddog", name: "Bird dog", routine: "B", muscles: "stabilité dos et hanches",
    sets: "2 séries de 10 par côté", tip: "1'' de pause en extension, sans basculer le bassin.",
    desc: "À quatre pattes, tendez bras et jambe opposés, sans basculer le bassin.",
    timer: { mode: "reps", rest: 45, sets: 2 } },
  { id: "proprio", name: "Proprioception unipodale", routine: "B", muscles: "cheville (entorse ancienne)",
    sets: "3 × 30'' par jambe — tous les jours en bloc 1, puis 2-3 fois/semaine", tip: "Progression : cercles de bras, yeux fermés, coussin, balle. Y compris le jour de course, à l'échauffement.",
    desc: "Debout sur une jambe, genou légèrement fléchi, tenez 30''. Ne posez pas le pied au sol.",
    timer: { mode: "hold", work: 30, rest: 15, sets: 3 } },
  { id: "monstre", name: "Marche du monstre avec élastique", routine: "B", muscles: "fessier moyen et TFL (essuie-glace)",
    sets: "2 séries de 10 pas par jambe", tip: "Si douleur : version allongée sur le côté (coquillage).",
    desc: "Élastique aux chevilles, demi-flexion, 10 pas de côté dans chaque sens en tenant la tension.",
    timer: { mode: "reps", rest: 45, sets: 2 } }
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
