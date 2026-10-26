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

## Notes

- L'ordinateur doit rester allumé pour que l'URL réponde ; en cas de mise en
  veille, l'app bascule en local (localStorage) et resynchronise au réveil —
  aucune donnée n'est perdue (fusion additive).
- Aucun port à ouvrir dans la box ; le tunnel sort en 443 sortant.
- `journalctl -u cloudflared -f` pour suivre le tunnel en service.
