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
- **Exercices** : les 13 exercices des routines RM-A / RM-B **plus 5 exercices de corde à
  sauter** (routine « Corde », séance guidée comme les autres), avec figures animées
  (SVG animé, équivalent GIF, fonctionne hors ligne), description, étapes d'exécution
  détaillées, erreurs à éviter, prescriptions et minuteur intégré.
- **Fractionné dès le bloc 1** : les séances endurance du mercredi de S2, S3 et S5 sont
  remplacées par du fractionné (VMA 30''/30'', côtes 1', VMA 45''/45''), et la corde à
  sauter apparaît 10 semaines du programme (S2-S6, S10, S14, S18, S26, S28).
- **Sorties** : séance proposée du jour, minuteur fractionné (SQ1 : 30''/30'',
  SQ3 : seuil…), enregistrement GPS en direct (distance, vitesse, D+, altitude) avec
  **annulation** possible, import de fichiers GPX, feedback sur la séance réelle
  (sensations, douleurs essuie-glace et cheville, notes), **sélection de la paire de
  chaussures obligatoire** — la dernière paire utilisée est présélectionnée et le cumul
  de km de la paire est mis à jour et affiché après chaque sortie —, correction
  des km / temps / D+ d'une sortie sans toucher à la trace GPS, export GPX,
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
  JSON de sauvegarde, **synchronisation des cochages entre appareils** (voir plus bas).

## Données

Tout est stocké dans le navigateur (localStorage) — aucun compte, aucun cloud.
Le pied de page affiche « Enregistré à … » après chaque sauvegarde : si cette mention
n'apparaît pas, la sauvegarde a échoué. Les traces GPS sont compressées automatiquement
si le stockage s'approche du quota ; en cas de blocage, le site te prévient et te
suggère d'exporter une sauvegarde JSON depuis l'onglet Réglages.
Pense à exporter une sauvegarde JSON régulièrement.

## Synchroniser les cochages entre appareils

Le localStorage est propre à chaque appareil. Pour retrouver les séances cochées du
programme sur le téléphone et l'ordinateur sans compte ni cloud, utilise
**Réglages → Synchronisation des cochages entre appareils** :

1. Sur l'appareil le plus à jour : **Générer le code**, puis copie-le (message, e-mail…),
   ou télécharge le fichier `cochages-AAAA-MM-JJ.txt`, ou copie un **lien de
   synchronisation** (`…#sync=…`) à ouvrir sur l'autre appareil.
2. Sur l'autre appareil : colle le code dans le champ prévu et clique **Fusionner**,
   ou ouvre le fichier reçu, ou ouvre simplement le lien — la fusion est proposée
   automatiquement.

La fusion est **additive** : les cochages manquants sont ajoutés, rien n'est jamais
effacé (les cochages cochés manuellement sur l'appareil receveur sont conservés). Un
même code peut être importé plusieurs fois sans effet de bord. Le code ne contient
ni les sorties GPS, ni les chaussures, ni la clé API. Si les deux appareils utilisent
des dates de début de programme différentes, un avertissement s'affiche (vérifie dans
Réglages). Pour tout transférer (sorties, GPS, chaussures), utilise l'export JSON
complet, qui remplace l'intégralité des données.

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
