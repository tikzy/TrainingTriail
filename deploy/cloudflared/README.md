# cloudflared — le serveur maison exposé en HTTPS

Le tunnel Cloudflare donne au serveur existant (`node server/server.js`,
port 8000) une URL HTTPS publique sans ouvrir de port ni toucher au code.
Les données restent dans `server/data/state.json` sur l'ordinateur.

## 0. Essai immédiat (5 minutes, sans compte, sans domaine)

```bash
sudo pacman -S cloudflared          # Manjaro/Arch (sinon : paquet .deb/.rpm
                                    # ou brew install cloudflared)
node server/server.js &             # dans un autre terminal si nécessaire
cloudflared tunnel --url http://localhost:8000
```

cloudflared affiche une URL du type `https://mots-aleatoires.trycloudflare.com`.
Ouvrir cette URL sur l'iPhone : HTTPS, géolocalisation OK, badge « serveur
centralisé ». Idéal pour tester aujourd'hui. Limite : l'URL change à chaque
redémarrage de cloudflared — inutilisable comme adresse permanente.

## 1. Tunnel nommé (URL stable, nécessite un domaine géré par Cloudflare)

Un domaine (~10 €/an) transféré ou enregistré chez Cloudflare (plan gratuit).

```bash
cloudflared tunnel login                     # choisit le domaine dans le navigateur
cloudflared tunnel create trainingtrail     # affiche l'ID + crée le .json d'identifiants
cloudflared tunnel route dns trainingtrail maison.mytrailcoach.stream
```

Copier ce `config.yml` dans `~/.cloudflared/config.yml`, remplacer l'ID (2
occurrences) et le hostname, puis :

```bash
cloudflared tunnel run trainingtrail        # https://maison.mytrailcoach.stream
```

## 2. Démarrage automatique (systemd)

```bash
sudo mkdir -p /etc/cloudflared
sudo cp ~/.cloudflared/config.yml /etc/cloudflared/config.yml
sudo cp ~/.cloudflared/A_REMPLACER_PAR_LE_ID_DU_TUNNEL.json /etc/cloudflared/
sudo cloudflared service install             # chemin config : /etc/cloudflared/config.yml
```

Le tunnel démarre au boot. Il reste à lancer `node server/server.js` : le
plus simple est un service utilisateur systemd ou une entrée au démarrage
de session.

## 3. Montre Polar (MyPolar) via le tunnel

`server/server.js` expose les mêmes routes `/api/polar/*` que le worker
Cloudflare (`deploy/worker/src/worker.js`) : la synchro de la montre
(sorties, FC, allure, GPX, sommeil, recharge) fonctionne donc aussi via
l'URL du tunnel. Prérequis : Node >= 18 (fetch natif).

1. Créer le client AccessLink sur https://admin.polaraccesslink.com (types
   « Exercise data », « Sleep data », « Physical information ») et noter le
   **client id** / **client secret**.
2. **Authorization redirect URL** à déclarer chez Polar (correspondance
   exacte) : `https://<hostname-du-tunnel>/api/polar/callback`
   (ex. `https://maison.mytrailcoach.stream/api/polar/callback`).
3. Renseigner les secrets sur le serveur, au choix :
   - variables d'environnement au lancement :
     `POLAR_CLIENT_ID=... POLAR_CLIENT_SECRET=... node server/server.js`
   - ou fichier `server/data/polar-secrets.json` (non committé, .gitignore) :
     `{ "clientId": "...", "clientSecret": "..." }`
4. Dans l'app (ouverte via l'URL du tunnel) : Réglages → Montre Polar →
   « Connecter ma montre Polar ». Le jeton est stocké dans
   `server/data/polar.json` (non committé) et ne sort jamais de la machine.

## Notes

- L'ordinateur doit rester allumé pour que l'URL réponde ; en cas de mise en
  veille, l'app bascule en local (localStorage) et resynchronise au réveil —
  aucune donnée n'est perdue (fusion additive).
- Aucun port à ouvrir dans la box ; le tunnel sort en 443 sortant.
- `journalctl -u cloudflared -f` pour suivre le tunnel en service.
- Rappel Polar : seules les séances téléversées sur Polar Flow **après** la
  connexion de la montre (et des 30 derniers jours) sont transmises — la
  montre doit d'abord synchroniser avec l'appli Polar Flow du téléphone.
