# Iris · Guide d'installation sur VPS

Iris (studio vidéo IA) tourne en service systemd sous un utilisateur dédié, derrière Caddy qui fournit le HTTPS
automatiquement. Comptez environ 30 minutes sur Ubuntu 24.04 ou Debian 12. Aucune base de données ni dépendance
npm : un serveur Node.js et un dossier de données. Ce guide décrit une **installation neuve**, sans reprise de
données.

## Valeurs à adapter

Les commandes de ce guide utilisent les valeurs ci-dessous. Remplacez-les partout où elles apparaissent.

| Élément | Valeur du guide | À remplacer par |
| --- | --- | --- |
| Nom de domaine | `iris.example.fr` | Le domaine choisi |
| Code de l'application | `/opt/iris` | — (conseillé tel quel) |
| Données de l'application | `/var/lib/iris` | — (conseillé tel quel) |
| Utilisateur système | `iris` | — |
| Port interne de Node | `3999` | Un autre port libre si 3999 est pris |
| Dépôt Git | `git@github.com:moucby/iris.git` | — (dépôt privé) |

## Architecture

```
                         VPS (Ubuntu ou Debian) — pare-feu : 22, 80, 443 ouverts, 3999 fermé
                        ┌──────────────────────────────────────────────┐
┌──────────────┐ HTTPS  │ ┌─────────────┐  HTTP   ┌──────────────────┐ │  HTTPS sortant  ┌────────────────┐
│  Navigateur  │──443──►│ │    Caddy    │────────►│  Iris (Node.js)  │─┼────────────────►│   Higgsfield   │
│ utilisateurs │        │ │ HTTPS auto  │  local  │ service systemd  │ │ clé du compte   │ API et stockage│
└──────────────┘        │ │Let's Encrypt│         │ 127.0.0.1:3999   │ │                 │ des résultats  │
                        │ └─────────────┘         │ utilisateur iris │ │                 └────────────────┘
                        │                         └────────┬─────────┘ │
                        │                                  │ lit, écrit │
                        │                         ┌────────▼─────────┐ │
                        │                         │  /var/lib/iris   │ │
                        │                         │ comptes, sessions│ │
                        │                         │ secret.key       │ │
                        │                         │ fichiers générés │ │
                        │                         └──────────────────┘ │
                        └──────────────────────────────────────────────┘
```

Les navigateurs ne parlent qu'à Caddy, en HTTPS. Iris n'écoute que sur la machine, ajoute la clé API du compte
connecté aux appels vers Higgsfield, et télécharge les résultats dans `/var/lib/iris`. Le code, lui, est dans
`/opt/iris`, en lecture seule.

## Prérequis

| Besoin | Minimum | Conseillé | Pourquoi |
| --- | --- | --- | --- |
| Système | Linux 64 bits avec systemd | Ubuntu 24.04 LTS ou Debian 12 | Les commandes du guide visent ces deux systèmes |
| Processeur, mémoire | 1 vCPU, 1 Go | 2 vCPU, 2 à 4 Go | Les vidéos envoyées (jusqu'à 200 Mo) passent par la mémoire du serveur |
| Disque | 20 Go | 40 à 80 Go, extensible | Les images et vidéos générées sont stockées sur le serveur : 5 à 15 Mo par vidéo de 10 s |
| Node.js | 18 | 22 LTS | Version 18 au minimum (fetch intégré) |
| DNS | Enregistrement A (et AAAA si IPv6) de `iris.example.fr` vers l'IP du VPS | — | Caddy en a besoin pour obtenir le certificat HTTPS |
| Ports ouverts | 22, 80, 443 | — | SSH, validation du certificat, HTTPS |
| Accès | Un compte avec `sudo` | — | Installation et service |
| Sortie internet | `api.higgsfield.ai` et les stockages de fichiers Higgsfield en HTTPS | — | Iris relaie les demandes et télécharge les résultats |

Aucune base de données, aucun `npm install` : l'application n'a pas de dépendance.

## Étape 1 · Installer Node.js 22 LTS et git

Les dépôts Ubuntu et Debian fournissent souvent une version trop ancienne de Node.js : passez par le dépôt officiel
NodeSource.

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl ca-certificates
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # doit afficher v22.x (v18 au minimum)
```

## Étape 2 · Utilisateur système et dossiers

Iris tourne sous un utilisateur sans shell ni droits particuliers. Le code et les données sont séparés : le code se
remplace à chaque mise à jour, les données jamais.

```bash
sudo useradd --system --home-dir /var/lib/iris --shell /usr/sbin/nologin iris
sudo mkdir -p /opt/iris /var/lib/iris
sudo chown iris:iris /var/lib/iris
sudo chmod 700 /var/lib/iris
```

| Dossier | Contenu | Propriétaire, droits |
| --- | --- | --- |
| `/opt/iris` | Le code (`server.js`, `index.html`, `README.md`) | root, lecture seule pour `iris` |
| `/var/lib/iris` | Comptes, sessions, clé de chiffrement, fichiers générés de chaque utilisateur | `iris`, 700 |

## Étape 3 · Récupérer le code

Le dépôt `moucby/iris` est privé. Donnez au VPS une **clé de déploiement** en lecture seule : elle n'ouvre que ce
dépôt, et rien d'autre du compte GitHub.

1. Sur le VPS, créez la clé :

   ```bash
   sudo ssh-keygen -t ed25519 -N "" -C "iris-vps" -f /root/.ssh/iris_deploy
   sudo cat /root/.ssh/iris_deploy.pub
   ```

2. Le propriétaire du dépôt l'ajoute sur GitHub : dépôt `iris` → Settings → Deploy keys → Add deploy key, coller la
   clé publique, **sans** cocher « Allow write access ».
3. Clonez :

   ```bash
   sudo GIT_SSH_COMMAND="ssh -i /root/.ssh/iris_deploy -o StrictHostKeyChecking=accept-new" \
     git clone git@github.com:moucby/iris.git /opt/iris
   sudo git -C /opt/iris config core.sshCommand "ssh -i /root/.ssh/iris_deploy"
   ls /opt/iris   # server.js  index.html  README.md
   ```

Le dépôt ne contient aucune donnée ni aucun secret : comptes, clés et fichiers sont dans `/var/lib/iris` (étape 4).

## Étape 4 · Données : installation neuve

Rien à copier : Iris démarre sans aucun compte. Au premier démarrage (étape 8), il crée seul dans `/var/lib/iris` la
clé de chiffrement `secret.key`, et affiche dans ses journaux un **code d'installation** qui sert à créer le compte
administrateur.

Vérifiez seulement que le dossier est vide et appartient à `iris` :

```bash
sudo ls -la /var/lib/iris   # vide, propriétaire iris
```

## Étape 5 · Service systemd

Créez `/etc/systemd/system/iris.service` :

```ini
[Unit]
Description=Iris - studio video IA
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=iris
Group=iris
WorkingDirectory=/opt/iris
ExecStart=/usr/bin/node /opt/iris/server.js
Restart=on-failure
RestartSec=5

# Reglages d'Iris
Environment=HOST=127.0.0.1
Environment=PORT=3999
Environment=PUBLIC_URL=https://iris.example.fr
Environment=TRUST_PROXY=1
Environment=DATA_DIR=/var/lib/iris

# Durcissement : seul /var/lib/iris est accessible en ecriture
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/iris
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
UMask=0077

[Install]
WantedBy=multi-user.target
```

| Variable | Rôle | Attention |
| --- | --- | --- |
| `HOST=127.0.0.1` | Node n'écoute que sur la machine : seul Caddy le joint | Ne jamais mettre `0.0.0.0` sur ce VPS |
| `PORT=3999` | Port interne | Le même que dans la configuration de Caddy |
| `PUBLIC_URL` | Seul ce nom d'hôte est accepté (en plus de localhost) | `https://` et le domaine exact, sans `/` final |
| `TRUST_PROXY=1` | Lit l'IP du client et le HTTPS dans les en-têtes de Caddy | Uniquement derrière un proxy, sinon l'IP se falsifie |
| `DATA_DIR` | Dossier des données | Celui de l'étape 2 |

N'utilisez pas `MemoryDenyWriteExecute=true` : Node.js a besoin d'exécuter du code compilé à la volée. Activez le
service sans le démarrer encore (le démarrage vient à l'étape 8) :

```bash
sudo systemctl daemon-reload
sudo systemctl enable iris
```

## Étape 6 · HTTPS avec Caddy

Caddy obtient et renouvelle seul le certificat HTTPS (Let's Encrypt). Le HTTPS est obligatoire : sans lui, mots de
passe et cookies de session circulent en clair.

Installation depuis le dépôt officiel de Caddy :

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

Remplacez le contenu de `/etc/caddy/Caddyfile` :

```
iris.example.fr {
	encode zstd gzip
	reverse_proxy 127.0.0.1:3999
}
```

```bash
sudo systemctl reload caddy
```

Caddy transmet déjà le nom d'hôte d'origine et les en-têtes `X-Forwarded-For` et `X-Forwarded-Proto` dont Iris a
besoin. Il n'impose ni taille maximale d'envoi ni délai de réponse : les vidéos de 200 Mo et les traitements de
plusieurs minutes passent sans réglage.

**Variante Nginx** (si Nginx est déjà en place, avec un certificat Certbot) — ces réglages sont **obligatoires**,
sinon les envois de vidéos et les longs traitements échouent :

```nginx
server {
    listen 443 ssl http2;
    server_name iris.example.fr;
    # ssl_certificate et ssl_certificate_key : ceux de Certbot

    client_max_body_size 250m;      # videos envoyees jusqu'a 200 Mo
    proxy_request_buffering off;
    proxy_buffering off;            # lecture video en flux, export ZIP
    proxy_read_timeout 900s;        # telechargements et envois jusqu'a 15 min
    proxy_send_timeout 900s;

    location / {
        proxy_pass http://127.0.0.1:3999;
        proxy_set_header Host $host;                   # indispensable (controle PUBLIC_URL)
        proxy_set_header X-Forwarded-For $remote_addr; # ecrase toute valeur envoyee par le client
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Étape 7 · Pare-feu

Seuls SSH, HTTP (validation du certificat et redirection) et HTTPS restent ouverts. Le port 3999 ne doit **jamais**
être joignable de l'extérieur.

```bash
sudo apt install -y ufw
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

Si l'hébergeur propose aussi un pare-feu dans son interface, appliquez-y les mêmes règles.

## Étape 8 · Premier démarrage et vérifications

```bash
sudo systemctl start iris
sudo systemctl status iris --no-pager
sudo journalctl -u iris -n 20 --no-pager
```

Les journaux doivent afficher `Iris prêt : https://iris.example.fr`. Ils affichent aussi
`Code d'installation à saisir : XXXX-XXXX` : transmettez ce code à la personne qui créera le compte administrateur,
et faites cette création **sans attendre**. Sans ce code, personne ne peut créer ce compte à sa place.

Vérifications :

```bash
# Iris répond en local et se sait en ligne ("local":false)
curl -s -H "Host: iris.example.fr" http://127.0.0.1:3999/auth/state

# HTTPS en place, avec les en-têtes de sécurité
curl -sI https://iris.example.fr | grep -iE "^HTTP|strict-transport|content-security"

# Le port interne n'est pas joignable depuis l'extérieur (à lancer depuis un autre poste : doit échouer)
curl -m 5 http://IP-DU-VPS:3999/
```

- [ ] `systemctl status iris` indique `active (running)`
- [ ] `/auth/state` répond avec `"local":false`
- [ ] `https://iris.example.fr` s'ouvre avec le cadenas, sans alerte de certificat
- [ ] Le port 3999 est injoignable depuis l'extérieur
- [ ] Compte administrateur créé avec le code d'installation
- [ ] Une génération test arrive dans la bibliothèque (vérifie la sortie vers Higgsfield)

## Mises à jour de l'application

Une mise à jour remplace le code dans `/opt/iris` et ne touche jamais aux données de `/var/lib/iris`.

```bash
sudo git -C /opt/iris pull --ff-only
sudo systemctl restart iris
sudo journalctl -u iris -n 5 --no-pager   # doit afficher "Iris prêt"
```

Le redémarrage prend une seconde. Les générations en cours continuent chez Higgsfield, et les navigateurs reprennent
leur suivi tout seuls. Les utilisateurs rechargent la page pour voir la nouvelle version.

Revenir à la version précédente en cas de problème :

```bash
sudo git -C /opt/iris log --oneline -5          # repérer le commit voulu
sudo git -C /opt/iris checkout <commit>
sudo systemctl restart iris
```

## Sauvegardes et restauration

Tout ce qui compte est dans `/var/lib/iris` : sauvegarder ce dossier suffit. Le code se récupère sur GitHub.

Sauvegarde quotidienne, 7 jours gardés — créez `/etc/cron.daily/iris-backup` :

```bash
#!/bin/sh
set -e
DEST=/var/backups/iris
mkdir -p "$DEST" && chmod 700 "$DEST"
tar -cf "$DEST/iris-$(date +%F).tar" -C /var/lib iris
find "$DEST" -name 'iris-*.tar' -mtime +7 -delete
```

```bash
sudo chmod 755 /etc/cron.daily/iris-backup
sudo /etc/cron.daily/iris-backup && sudo ls -lh /var/backups/iris
```

Pas de compression : les images et vidéos le sont déjà. Les fichiers d'Iris sont écrits de façon atomique, la
sauvegarde peut donc tourner avec le service démarré.

**Une copie hors du VPS est indispensable** : une sauvegarde sur le même disque ne protège pas d'une panne du
serveur. Activez les sauvegardes de l'hébergeur, ou envoyez `/var/backups/iris` vers un stockage externe (rclone vers
S3, Backblaze B2…), **chiffré** : l'archive contient `secret.key`, qui déchiffre les clés API des utilisateurs.

Restauration :

```bash
sudo systemctl stop iris
sudo mv /var/lib/iris /var/lib/iris.ancien
sudo tar -xf /var/backups/iris/iris-AAAA-MM-JJ.tar -C /var/lib
sudo chown -R iris:iris /var/lib/iris && sudo chmod 700 /var/lib/iris
sudo systemctl start iris
```

Avant de supprimer `/var/lib/iris.ancien`, vérifiez qu'on peut se connecter et que la bibliothèque s'affiche.

## Surveillance

| À surveiller | Commande | Seuil d'alerte |
| --- | --- | --- |
| Le service tourne | `systemctl is-active iris` | Autre chose que `active` |
| Journaux (requêtes, erreurs) | `sudo journalctl -u iris -f` | Lignes `Erreur :` répétées |
| Espace disque | `df -h /var/lib` | Plus de 80 % utilisés |
| Volume par utilisateur | `sudo du -sh /var/lib/iris/utilisateurs/*` | Croissance anormale d'un compte |
| Certificat HTTPS | `sudo journalctl -u caddy --since "1 day ago" \| grep -i error` | Erreur de renouvellement |

Chaque ligne de journal donne l'heure, la méthode, le chemin, le code de réponse et l'e-mail du compte. Elle ne
contient jamais de mot de passe, de clé API ni de contenu de requête. Les dossiers de `/var/lib/iris/utilisateurs/`
portent l'identifiant de chaque compte : la correspondance avec les e-mails est dans `comptes.json`.

## Sécurité : règles à respecter

- **Toujours en HTTPS**, derrière Caddy ou Nginx. Node n'écoute que sur `127.0.0.1` ; le port 3999 reste fermé vers
  l'extérieur.
- **`TRUST_PROXY=1` uniquement derrière le proxy.** Sinon un client peut falsifier son adresse IP et contourner le
  blocage après 5 mots de passe faux.
- **`/var/lib/iris` en 700, propriété de `iris`.** Il contient les comptes (mots de passe hachés), les sessions et
  `secret.key`.
- **`secret.key`** chiffre les clés API Higgsfield des utilisateurs. Ne jamais le copier hors des sauvegardes
  chiffrées. Variante : le fournir par la variable `IRIS_SECRET` (32 octets en base64), par exemple via un fichier
  d'environnement systemd en 600.
- **Le code d'installation** ne sert qu'une fois : créez le compte administrateur dès la mise en ligne.
- **Système à jour** : `sudo apt install unattended-upgrades` pour les correctifs de sécurité, et Node.js mis à jour
  dans sa branche 22.
- **Ce qu'Iris fait déjà** : mots de passe hachés (scrypt), cookies `HttpOnly`, `Secure`, `SameSite=Strict`, contrôle
  des en-têtes `Host` et `Origin`, en-têtes CSP, HSTS et anti-iframe, blocage de 15 minutes après 5 essais ratés,
  fichiers séparés par compte. Un fail2ban n'est pas nécessaire pour l'application.

## Dépannage

| Symptôme | Cause probable | Solution |
| --- | --- | --- |
| « Hôte non autorisé » | `PUBLIC_URL` différent du domaine utilisé, ou Nginx sans `proxy_set_header Host $host` | Corriger `PUBLIC_URL` (domaine exact, `https://`), recharger systemd, redémarrer |
| « Origine non autorisée » | Page ouverte par une autre adresse (IP, `http://`, autre sous-domaine) | Ouvrir `https://iris.example.fr` |
| 502 Bad Gateway | Service arrêté, ou port différent entre systemd et le proxy | `systemctl status iris`, `journalctl -u iris`, aligner `PORT` |
| La connexion ne tient pas (retour à l'écran de connexion) | Site ouvert en `http://` alors que le cookie est réservé au HTTPS | Toujours passer par `https://` ; Caddy redirige seul |
| Envoi de vidéo refusé (413) | Limite de taille du proxy (Nginx) | `client_max_body_size 250m;` |
| Long traitement coupé (504) | Délai du proxy (Nginx) | `proxy_read_timeout 900s;` et `proxy_send_timeout 900s;` |
| Pas de certificat HTTPS | DNS pas encore propagé, ou port 80 fermé | `dig iris.example.fr`, ouvrir le port 80, `journalctl -u caddy` |
| Le service ne démarre pas : `EACCES` | Droits sur `/var/lib/iris`, ou dossier absent de `ReadWritePaths` | `chown -R iris:iris /var/lib/iris`, vérifier `DATA_DIR` et `ReadWritePaths` |
| Le service ne démarre pas : port déjà utilisé | Un autre programme écoute sur 3999 | Changer `PORT` dans le service **et** dans le proxy |
| Code d'installation introuvable | Le compte administrateur existe déjà (le code n'est plus affiché) | `journalctl -u iris \| grep -i installation` ; sinon se connecter avec le compte existant |
| « Clé API illisible » pour tous les comptes | `secret.key` perdu ou remplacé (données restaurées sans lui) | Restaurer le bon `secret.key` ; à défaut, chacun ressaisit sa clé |
| Générations en échec « Problème réseau » | Le VPS ne joint pas `api.higgsfield.ai` en HTTPS | Tester `curl -I https://api.higgsfield.ai` depuis le VPS, vérifier le pare-feu sortant |
