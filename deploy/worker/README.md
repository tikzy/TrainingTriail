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
