# TrainingTrail — suivi du programme Trail des Forts 72 km

Site web autonome (aucune installation, aucun serveur requis) pour suivre le programme
d'entraînement du **Trail des Forts, 72 km, 2 800 m D+ — Besançon, 9 mai 2027**
(transcrit depuis `programme_entrainement_trail_des_forts.tex`).

## Lancer le site

### Recommandé : site dynamique (données centralisées, partagées entre appareils)

Le site embarque un petit serveur de stockage (Node pur, **aucune dépendance à
installer**) :

    node server/server.js

puis ouvrir http://localhost:8000 — depuis un téléphone sur le même réseau :
http://<ip-de-l-ordinateur>:8000 (autoriser le port 8000 au pare-feu).

Dans ce mode, les données (cochages, sorties, GPS, chaussures, conversation)
sont enregistrées dans **`server/data/state.json`** : elles sont partagées par
tous les appareils connectés, survivent au cache et aux navigateurs. Le site
affiche « Stockage : serveur centralisé » en bas de page ; en cas de serveur
injoignable, le navigateur continue de travailler sur sa copie locale
(localStorage) et resynchronise tout seul au retour du serveur (fusion sans
perte : union des cochages, sorties fusionnées par identifiant, l'état le plus
récent gagne).

### Chiffrement de bout en bout (Réglages → Chiffrement des données)

Après activation (mot de passe du coffre, le même sur tous les appareils) :

- les données sont chiffrées **dans le navigateur** (AES-GCM 256, clé dérivée
  du mot de passe par PBKDF2-SHA256, 600 000 itérations) avant tout envoi et
  avant toute écriture dans localStorage : le serveur ne stocke qu'un blob
  illisible `{enc, salt, iv, ct}` ;
- sans le mot de passe, le serveur **refuse l'accès** (en-tête `X-TT-Key`,
  SHA-256 stocké — jamais le mot de passe ni la clé) et le navigateur ne garde
  aucune copie en clair ;
- le mot de passe est demandé à chaque chargement (les clés n'existent qu'en
  mémoire) et il n'est récupérable par personne : perdu = données illisibles.
  Les traces GPS (R2 / fichiers `tracks/`) sont chiffrées de la même façon ;
- le serveur limite en outre les requêtes par IP (fenêtre glissante, blocage
  après échecs répétés de clé), refuse les états plus anciens que sa copie
  (anti-rollback, 409) et envoie les en-têtes de sécurité (CSP, nosniff…).

Le serveur peut tourner partout où Node tourne : PC de la maison, mini-serveur,
ou hébergeur gratuit (Render, Railway, Fly.io…). Sur GitHub Pages seul, le site
retombe automatiquement en mode statique (localStorage).

### Mode statique (repli)

Ouvrir `site/index.html` directement dans un navigateur. Pour la
géolocalisation GPS en direct, les navigateurs exigent HTTPS ou localhost :

    cd site
    python3 -m http.server 8000

Sur mobile, utiliser plutôt l'import de fichier GPX exporté depuis une montre
ou une application GPS si l'enregistrement direct n'est pas pratique.

### Montre Polar (Vantage M3)

Avec le worker Cloudflare, la montre se connecte directement (Réglages →
Montre Polar) : les sorties sont importées automatiquement via l'API officielle
Polar AccessLink, trace GPX et D+ compris, avec FC moy/max et Running Index.
La vue Aujourd'hui affiche aussi une carte « Récupération » (sommeil, recharge
ANS/VFC, charge cardio) alimentée par la montre. Sans worker, exporter les GPX
depuis Polar Flow et les importer dans l'onglet Sorties. Mise en place : voir
`deploy/worker/README.md`.

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

- **Mode dynamique (recommandé)** : tout est enregistré sur le serveur
  (`server/data/state.json`) et partagé entre appareils — plus de perte de
  données liée au navigateur. Le navigateur garde une copie de secours
  (localStorage) et resynchronise automatiquement (toutes les 60 s et à
  l'ouverture), avec fusion sans perte.
- **Mode statique (repli)** : tout est stocké dans le navigateur
  (localStorage) — aucun compte, aucun cloud, mais propre à chaque appareil.
  Dans ce cas, utilise la synchronisation des cochages et l'export JSON
  (onglet Réglages), et ouvre toujours le site depuis la même adresse
  (fichier local, `localhost:8000` ou GitHub Pages : ce sont trois stockages
  différents).

Le pied de page affiche le mode de stockage actif et « Enregistré à … » après
chaque sauvegarde. Les traces GPS sont compressées automatiquement si le
stockage du navigateur s'approche du quota.

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
