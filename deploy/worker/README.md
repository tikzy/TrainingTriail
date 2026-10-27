# Worker Cloudflare + D1 — stockage central sans machine dédiée

Même API que `server/server.js`, mais exécutée sur l'infrastructure
Cloudflare (gratuit) : le site et l'état sont servis sur une URL HTTPS
permanente, joignable depuis l'iPhone en Wi-Fi comme en 4G, même PC éteint.
L'application n'a **aucune modification** : `ServerSync` appelle `api/ping` et
`api/state` en URLs relatives (same-origin).

```
├── wrangler.toml    config (liaison ASSETS -> ../../site, liaison D1)
├── schema.sql       table `state` (une ligne : l'état complet en JSON)
└── src/worker.js    GET /api/ping, GET/PUT /api/state, sinon fichiers statiques
```

## Mise en route

Prérequis : compte Cloudflare gratuit, Node 18+, `npx` (wrangler >= 4).

```bash
cd deploy/worker
npx wrangler login                                   # ouvre le navigateur
npx wrangler d1 create trainingtrail                  # copier database_id -> wrangler.toml
npx wrangler d1 execute trainingtrail --local  --file=schema.sql
npx wrangler dev                                     # http://localhost:8787
```

Vérifier en local : `http://localhost:8787/api/ping` répond `{"ok":true,...}`
et le bandeau de pied de page du site affiche « Stockage : serveur
centralisé » (l'onglet Sorties conserve une trace enregistrée après rechargement).

## Déploiement

```bash
npx wrangler d1 execute trainingtrail --remote --file=schema.sql
npx wrangler deploy
```

URL obtenue : `https://mytrailcoach.stream` (domaine personnalisé déclaré
dans `wrangler.toml`) et en secours
`https://trainingtrail.<votre-sous-domaine>.workers.dev`.
Sur l'iPhone : ajouter à l'écran d'accueil (Safari > Partager > Sur l'écran
d'accueil) pour un accès direct. La géolocalisation live fonctionne (HTTPS).

## Montre Polar (Vantage M3) — API AccessLink

L'app importe les sorties de la montre directement depuis Polar (API officielle
AccessLink v3), via le worker : client id/secret et jeton d'accès restent côté
serveur (table D1 `polar`), jamais dans le navigateur.

### 1. Créer le client AccessLink (une fois)

1. Compte Polar Flow + montre appairée (app mobile Polar Flow, Bluetooth).
2. Sur https://admin.polaraccesslink.com, se connecter avec ce compte et créer
   un client : accepter la licence, activer les types de données
   « Exercise data », « Sleep data » et « Physical information ».
3. Noter le **client id** et le **client secret** (affichés une seule fois).
4. Authorization redirect URL : `https://<domaine>/api/polar/callback`
   (ex. `https://mytrailcoach.stream/api/polar/callback`) — correspondance
   exacte exigée.

### 2. Configurer le worker

```bash
cd deploy/worker
npx wrangler secret put POLAR_CLIENT_ID
npx wrangler secret put POLAR_CLIENT_SECRET
npx wrangler d1 execute trainingtrail --remote --file=schema.sql   # crée la table polar
npx wrangler d1 execute trainingtrail --local  --file=schema.sql   # pour wrangler dev
npx wrangler deploy
```

### 3. Dans l'app

Réglages → Montre Polar → « Connecter ma montre Polar » : autorisation sur
polar.com, retour automatique (`/#polar=ok`). Ensuite l'import se lance à chaque
chargement de l'app et via « Importer les sorties Polar » ; « Actualiser le
profil » copie FC max, FC repos, poids et VO2max depuis Polar Flow.

Sont aussi synchronisés à chaque ouverture ( carte « Récupération » de la vue
Aujourd'hui, et contexte du coach IA) : sommeil (score, durée, profond/REM),
Nightly Recharge (recharge ANS, VFC RMSSD, respiration nocturne) et charge
cardio quotidienne (strain/tolérance/statut). Ces données nécessitent
« Sleep data » activé chez Polar et se limitent aux 28-30 derniers jours côté
API ; l'app en garde 120 jours.

Limites Polar (documentation AccessLink) : la liste `/v3/exercises` ne couvre que
les **30 derniers jours** et seulement les exercices téléversés **après** la
connexion ; le jeton est longue durée (pas de refresh, ~1 an) ; les traces sont
récupérées en GPX quand la séance en contient une (sinon résumé seul : distance,
durée, FC moy/max, Running Index). Sans worker (hébergement statique),
l'import n'est pas disponible : exporter les GPX depuis Polar Flow et les
importer dans l'onglet Sorties.

## Limites et notes

- `directory = "../../site"` pointe hors du dossier `deploy/worker`. Si votre
  version de wrangler le refuse, copier `site/` à côté (ou ajuster le chemin
  dans `wrangler.toml`).
- **Limite gratuite Workers** : 100 000 requêtes/jour — largement suffisant
  (l'app synchronise toutes les 60 s).
- **Prototype** : l'état est plafonné à 2 Mo (`MAX_BODY` dans `worker.js`).
  Sur 29 semaines avec traces GPX compactes ça tient ; si ça grossit, stocker
  les traces dans R2 et ne garder que les métadonnées dans D1.
- **Écritures concurrentes** : dernier PUT gagnant, comme sur le serveur Node.
  La fusion additive côté client (`mergeStates`) gère la concurrence entre
  appareils.
- La base D1 se sauvegarde : `npx wrangler d1 export trainingtrail --remote
  --output=backup.sql`.
