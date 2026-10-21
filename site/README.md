# TrainingTrail — suivi du programme Trail des Forts 72 km

Site web autonome (aucune installation, aucun serveur requis) pour suivre le programme
d'entraînement du **Trail des Forts, 72 km, 2 800 m D+ — Besançon, 9 mai 2027**
(transcrit depuis `programme_entrainement_trail_des_forts.tex`).

## Lancer le site

Le plus simple — ouvrir `site/index.html` dans un navigateur.

Pour la géolocalisation GPS (enregistrement en direct), les navigateurs exigent
HTTPS ou localhost. Dans ce cas, servir le dossier en local :

    cd site
    python3 -m http.server 8000

puis ouvrir http://localhost:8000 — depuis un téléphone sur le même réseau :
http://<ip-de-l-ordinateur>:8000 (autoriser les connexions au pare-feu).
Sur mobile, utiliser plutôt l'import de fichier GPX exporté depuis une montre
ou une application GPS si l'enregistrement direct n'est pas pratique.

## Fonctions

- **Aujourd'hui** : séances du jour à cocher, aperçu de la semaine, compte à rebours,
  et lancement direct d'une séance de renforcement (RM-A, RM-B, RM-C, gainage) même
  en décalé — le site coche ensuite le premier créneau libre de la semaine.
- **Séance guidée (déroulé)** : chaque routine se déroule exercice par exercice avec
  la figure animée, la prescription et un bouton « série faite » par série ; certains
  exercices sont juste à cocher (nombre de répétitions), les gainages proposent un
  minuteur. À la fin, un bouton coche la séance dans le programme.
- **Programme** : les 29 semaines (S1 = 19/10/2026), 5 blocs, cases à cocher par séance,
  bouton « i » avec le détail de chaque type de séance.
- **Exercices** : les 13 exercices des routines RM-A / RM-B avec figures animées
  (SVG animé, équivalent GIF, fonctionne hors ligne), descriptions, prescriptions
  et minuteur intégré.
- **Sorties** : séance proposée du jour, minuteur fractionné (SQ1 : 30''/30'',
  SQ3 : seuil…), enregistrement GPS en direct (distance, vitesse, D+, altitude) avec
  **annulation** possible, import de fichiers GPX, feedback sur la séance réelle
  (sensations, douleurs essuie-glace et cheville, chaussures, notes), **correction
  des km / temps / D+ d'une sortie** sans toucher à la trace GPS, export GPX,
  profil altimétrique.
- **Chaussures** : ajout de paires, cumul des km et du D+ par paire, barre d'usure
  par rapport à la durée de vie estimée (600-900 km pour du trail).
- **Progression** : % de programme réalisé, volume hebdo planifié vs réalisé,
  D+ cumulé comparé aux 2 800 m de la course, suivi des douleurs, indicateurs
  de réussite avant le départ.
- **Coach IA (Mistral AI embarqué)** : onglet « Coach IA » avec le skill « coach
  trail ». Le coach reçoit à chaque question l'état complet du coureur (semaine,
  séances cochées, dernières sorties, douleurs, chaussures) et répond en tenant
  compte du programme. Activer dans **Réglages** avec une clé API Mistral
  (console.mistral.com — l'offre gratuite suffit) ; la clé reste dans le navigateur
  et n'est envoyée qu'à api.mistral.ai.
- **Réglages** : décalage de la date de début, clé API Mistral + modèle, export/import
  JSON de sauvegarde.

## Données

Tout est stocké dans le navigateur (localStorage) — aucun compte, aucun cloud.
Pensez à exporter une sauvegarde JSON depuis l'onglet Réglages.

## Accès depuis un téléphone (GitHub Pages)

Si le dépôt est sur GitHub :

1. Sur la page du dépôt : **Settings → Pages → Source : Deploy from a branch**,
   choisir la branche **gh-pages**, dossier **/ (root)**, puis Save.
2. Le site est alors publié en HTTPS (la géolocalisation fonctionne) :
   `https://<utilisateur>.github.io/TrainingTriail/`
3. Sur le téléphone, ouvrir cette adresse et l'ajouter à l'écran d'accueil
   (« Ajouter à l'écran d'accueil » dans le menu du navigateur).

Note : les données (localStorage) sont propres à chaque appareil — utiliser
l'export/import JSON pour synchroniser, et saisir la clé API Mistral sur chaque
appareil.
