# Iris

Studio vidéo IA. Une page web locale pour générer une image ou une vidéo, éditer une vidéo, créer un avatar ou une vidéo publicitaire, avec l'API Higgsfield,
puis télécharger le résultat sur votre PC.
Chaque utilisateur a son compte, sa clé API et sa bibliothèque. Chaque résultat est enregistré automatiquement sur
le serveur, dans le dossier de son compte, et reste consultable dans la page.

## Contenu

| Fichier      | Rôle                                                        |
|--------------|-------------------------------------------------------------|
| `index.html` | L'application (interface)                                   |
| `server.js`  | Mini-serveur relais entre la page et l'API (aucune dépendance) |
| `README.md`  | Ce fichier                                                  |
| `INSTALLATION.md` | Guide d'installation sur un VPS (Caddy, systemd, sauvegardes), pour l'administrateur système |
| `donnees/`   | Créé au premier lancement : comptes, sessions, clé de chiffrement et fichiers de chaque utilisateur (voir « Comptes ») |

## 1. Installer Node.js

1. Téléchargez la version **LTS** sur <https://nodejs.org> (Node 18 minimum).
2. Installez-la avec les options par défaut.
3. Vérifiez dans un terminal : `node --version` doit afficher `v18` ou plus.

Aucun `npm install` n'est nécessaire.

## 2. Lancer l'application

Dans un terminal, placez-vous dans ce dossier puis lancez :

```
node server.js
```

Ouvrez ensuite <http://localhost:3999> dans votre navigateur.
Laissez le terminal ouvert pendant l'utilisation. `Ctrl+C` arrête le serveur.

> N'ouvrez pas `index.html` par double-clic : l'API Higgsfield bloque les appels faits directement depuis le navigateur. La page doit passer par le serveur.

**Changer de port** (si le 3999 est déjà pris) :

- PowerShell : `$env:PORT=4000; node server.js`
- Bash / macOS : `PORT=4000 node server.js`

## 3. Comptes et clé API

### Premier lancement : compte administrateur

1. Lancez `node server.js`. Le terminal affiche un **code d'installation** (ex. `3E57-FB71`).
2. Ouvrez la page : l'écran **Installer Iris** demande ce code, votre nom, votre e-mail, un mot de passe
   (10 caractères minimum) et, si vous voulez, votre clé API.
3. Si une ancienne bibliothèque existe (dossier `bibliotheque/` d'avant les comptes), elle est rattachée à ce compte.
   Une clé gardée dans le navigateur par l'ancienne version est proposée puis effacée du navigateur.

Le code d'installation empêche qu'une autre personne crée le compte administrateur à votre place si le serveur est
en ligne. Il ne sert qu'une fois.

### Créer les comptes des autres (administrateur)

Menu compte (vos initiales, en haut à droite) → **Gérer les comptes** :

- **Créer le compte** : nom, e-mail, rôle. Un **mot de passe provisoire** s'affiche une seule fois : **Copier les
  identifiants** et transmettez-les. La personne choisit son propre mot de passe à sa première connexion.
- **Réinitialiser le mot de passe** : nouveau mot de passe provisoire (mot de passe oublié). Ses sessions sont fermées.
- **Rendre admin / Retirer admin**, **Désactiver / Réactiver** (un compte désactivé est déconnecté aussitôt).
- **Supprimer** (deux clics) : supprime le compte **et tous ses fichiers**.

Il reste toujours au moins un administrateur actif. Il n'y a pas d'inscription libre ni d'envoi d'e-mail.

### Sa clé API Higgsfield

1. Console Higgsfield : <https://console.higgsfield.ai> (section des clés API). Créez une clé et copiez-la en entier :
   une seule chaîne de la forme `identifiant:secret`.
2. Dans la page, carte **Clé API** : collez-la puis **Enregistrer**. Le serveur la vérifie auprès de Higgsfield.

La clé est **liée à votre compte et gardée chiffrée sur le serveur** (AES-256). Elle n'est jamais renvoyée au
navigateur : c'est le serveur qui l'ajoute à chaque appel vers Higgsfield. **Effacer** la supprime de votre compte.

### Mon compte

Menu compte : changer de mot de passe (vos autres appareils sont alors déconnectés), gérer sa clé, **Se déconnecter**,
**Déconnecter tous mes appareils**. « Rester connecté » garde la session 30 jours, sinon 12 heures. Si la session
expire pendant le travail, la page redemande le mot de passe sans perdre ce qui est en cours.

### Où sont les données

```
donnees/
  comptes.json        comptes (mots de passe hachés, clés API chiffrées)
  sessions.json       sessions ouvertes (empreintes des jetons seulement)
  secret.key          clé de chiffrement des clés API : à sauvegarder avec le reste, à ne jamais partager
  utilisateurs/<id>/bibliotheque/
    fichiers/  entrees/  historique.json  storyboards.json  projets.json
```

**Sauvegarde** : copiez tout le dossier `donnees/`. Sans `secret.key`, les clés API enregistrées ne peuvent plus
être lues (chaque utilisateur devra alors la saisir à nouveau).

### Réglages du serveur (variables d'environnement)

| Variable      | Rôle | Par défaut |
|---------------|------|------------|
| `PORT`        | Port d'écoute | `3999` |
| `HOST`        | Adresse d'écoute. `0.0.0.0` pour accepter les connexions venant d'ailleurs que ce PC | `127.0.0.1` |
| `PUBLIC_URL`  | Adresse publique (ex. `https://iris.mondomaine.fr`) : seul ce nom d'hôte est accepté en plus de localhost | — |
| `TRUST_PROXY` | `1` si un proxy HTTPS (Caddy, Nginx, Cloudflare Tunnel…) est devant le serveur. **Ne pas activer sans proxy** | — |
| `DATA_DIR`    | Dossier des données | `./donnees` |
| `IRIS_SECRET` | Clé de chiffrement (32 octets en base64), à la place de `secret.key` | — |

## 4. Utilisation

1. Choisissez **Image**, **Vidéo**, **Édition**, **Avatar**, **Pub** ou **Storyboard** (voir plus bas pour ces quatre derniers).
2. Écrivez le prompt, choisissez le modèle (liste avec recherche, prix et capacités de chaque modèle) puis ses options
   en cliquant sur les pastilles. Le cadre à droite prend le format choisi.
3. En vidéo, ajoutez si besoin :
   - une **image de départ** : la première image de la vidéo ;
   - des **images de référence** : personnages, objets, décor ou style à reprendre dans la vidéo. Dans le
     prompt, désignez-les par leur numéro affiché sur la vignette (« le personnage de l'image 1… »). Un clic sur
     une vignette insère « l'image N » dans le prompt.

   Formats acceptés : JPEG, PNG, WebP ou GIF, 20 Mo max par image. Clic, glisser-déposer ou coller (`Ctrl+V`).
4. Cliquez sur **Générer** (ou `Ctrl+Entrée`). Le bouton affiche une estimation du coût. Dès que Higgsfield a accepté
   la demande, le formulaire se libère : vous pouvez lancer une autre génération sans attendre (voir « File d'attente »).
5. Une fois terminé, le résultat s'affiche et s'ajoute à la **Bibliothèque**. **Télécharger** l'enregistre sous `higgsfield_AAAA-MM-JJ-HH-MM.ext`.
   **Ouvrir** l'affiche dans un nouvel onglet. Pour une image, **Animer en vidéo** la reprend comme image de départ
   d'une vidéo.

### Éditer une vidéo existante (onglet Édition)

1. Choisissez le type d'édition dans la liste **Modèle** (voir le tableau « Édition » plus bas).
2. Déposez la **vidéo source**, ou prenez-en une dans la bibliothèque avec **Choisir dans la bibliothèque** : **MP4 uniquement**, 200 Mo maximum. Une autre vidéo (MOV, WebM…) doit d'abord
   être convertie en MP4. Le cadre à droite affiche la vidéo et son format.
3. Selon le modèle : choisissez un **style** (vignettes chargées depuis Higgsfield), ajoutez les **images** demandées,
   écrivez le prompt (obligatoire pour Seedance, facultatif pour Genjutsu).
4. Cliquez sur **Éditer la vidéo**. L'envoi de la vidéo affiche une barre de progression, puis le suivi est le même
   qu'une génération. Le coût estimé se base sur la durée de la vidéo source (30 s max).
5. **Éditer cette vidéo**, sous un résultat vidéo, reprend ce résultat comme vidéo source : pratique pour enchaîner
   (changer le style, puis prolonger…).

### Créer et utiliser un avatar (onglet Avatar)

Un avatar est un personnage entraîné chez Higgsfield à partir de vos photos (Soul ID). Il peut ensuite apparaître
dans n'importe quelle scène, avec le même visage.

1. Cliquez sur **+ Nouvel avatar**, donnez-lui un nom et choisissez le modèle d'image (Soul V2, Soul ou Soul Cinema).
   Ce choix est définitif pour cet avatar.
2. Ajoutez **10 à 20 photos** nettes de la même personne (1 à 100 acceptées) : de face, de profil, expressions,
   tenues et lumières variées, une seule personne par photo.
3. Cliquez sur **Entraîner l'avatar**. L'entraînement prend plusieurs minutes. La carte affiche « En attente » puis
   « Entraînement », et la page vous prévient quand l'avatar est prêt (vérification toutes les 15 s, page ouverte).
4. Sélectionnez l'avatar prêt, décrivez la scène, puis **Générer avec l'avatar**. Options : format, résolution,
   1 ou 4 images, ressemblance (50 à 100 %) et amélioration du prompt.
5. Avec 4 images, cliquez sur celle à garder avant **Télécharger**. **Animer en vidéo** la transforme ensuite en vidéo.

La page mémorise dans le navigateur l'identifiant et le nom des avatars créés ici (pas les photos), pour les
retrouver à la prochaine visite. Un avatar créé ailleurs s'ajoute avec **Ajouter un avatar existant (ID)**.
Le prix de l'entraînement n'est pas publié dans le catalogue : vérifiez-le dans la console Higgsfield.

**Avatar rapide (sans entraînement)** : dans l'onglet Avatar, choisissez **Avatar rapide**. Ajoutez 1 à 3 photos
(Qwen Image 3 · Édition) ou jusqu'à 10 (Grok Imagine Image 2.0), puis décrivez la scène en désignant la personne :
« la personne de l'image 1 en costume sur un toit de Paris ». Un clic sur une vignette insère ce texte.
Rien à payer d'avance (dès 0,04 $ par image), mais la ressemblance est moins fidèle et moins régulière qu'avec un
avatar entraîné, et les photos sont renvoyées à chaque génération.

| Modèle                  | Route API                      | Photos | Format                                         | Résolution | Option |
|-------------------------|--------------------------------|--------|------------------------------------------------|------------|--------|
| Grok Imagine Image 2.0  | `/xai/grok-imagine-image-2.0`  | 1–10   | Auto, 1:1, 1:2, 2:1, 3:2, 2:3, 4:3, 3:4, 16:9, 9:16 | 1K, 2K | Qualité standard ou rapide |
| Qwen Image 3 · Édition  | `/alibaba/qwen-image-3/edit`   | 1–3    | 1:1, 2:3, 3:2, 3:4, 4:3, 7:9, 9:7, 9:16, 16:9, 21:9 | 1K, 2K | Améliorer le prompt |

### Créer une vidéo publicitaire (onglet Pub)

1. Déposez les images dans les trois zones : **Personnages** (4 max), **Produits** (4 max) et **Lieu** (2 max).
   Il en faut au moins une. Le numéro sur chaque vignette est sa place dans l'envoi.
2. Facultatif : la **marque**, un **slogan** (affiché à l'écran, dit en voix off, ou les deux) et le **ton**
   (UGC, Premium, Dynamique, Chaleureux, Fun, Minimaliste).
3. Racontez la **scène** : ce qui se passe, l'émotion, le moment où le produit apparaît.
4. Choisissez le modèle, la durée (8 s par défaut), le format (9:16 par défaut, pour les réseaux sociaux), puis
   **Créer la pub**. Le bouton affiche le coût estimé.

La page rédige le prompt complet à partir de ces éléments : chaque image y est désignée par son rôle
(« Personnages : image 1, image 2 · Produit : image 3 · Lieu : image 4 »). Il est visible avant l'envoi dans
**Voir le prompt envoyé au modèle**.

| Modèle            | Images max | Durée   | Prix          | Désignation des images dans le prompt |
|-------------------|------------|---------|---------------|---------------------------------------|
| Cinema Studio 4.0 | 30         | 4–30 s  | dès 0,206 $/s | Repères officiels `<<<image_1>>>` (recommandé). Options : rythme, mouvement de caméra |
| Seedance 2.5      | 30         | 4–30 s  | dès 0,144 $/s | « l'image 1 » (syntaxe non documentée) |
| Wan 3.0           | 10         | 2–30 s  | dès 0,020 $/s | « l'image 1 » (syntaxe non documentée). Accepte le lien de la page produit |

Les modèles vidéo rendent souvent mal le texte : si le slogan à l'écran est déformé, préférez la voix off et
ajoutez le texte au montage.

### Modèles de prompts

Au-dessus du champ Prompt (ou Scène), des boutons « Partir de : » remplissent le texte avec une scène prête à adapter :

| Onglet  | Modèles |
|---------|---------|
| Pub (19) | **UGC** : Avis face caméra, Unboxing, Get Ready With Me, Avant / après, Problème → solution · Unboxing, Témoignage client, Produit en studio, Story Instagram, Avant / après, Démo en 3 étapes, Teaser de lancement, Promo / soldes, Lifestyle en extérieur, Food / restaurant, Mode / collection, Visite immobilière, Sketch humoristique, Signature de marque |
| Image (12) | **Influenceur**, Photo produit studio, Lifestyle, Affiche publicitaire, Portrait pro, Flat lay, Bannière site web, Miniature YouTube, Photo culinaire, Intérieur / déco, Mascotte 3D, Visuel événement |
| Vidéo (15) | **Influenceur** · **UGC** : Avis face caméra, Unboxing, Get Ready With Me, Avant / après, Problème → solution · Produit 360°, Scène cinématique, Story verticale, Face caméra, Vue de drone, Timelapse, Plat qui fume, Jour → nuit, Ralenti produit |
| Avatar (10) | Portrait LinkedIn, Voyage, Shooting mode, Influenceur produit, Photo de profil, Conférencier, Sport, Soirée élégante, Personnage costumé, Illustration |
| Édition (19) | **Modifier** : ciel, saison, tenue, ambiance de nuit, effacer un élément, ajouter un objet, look rétro · **Prolonger** : suite de la scène, plan final produit, prise de recul, sortie de champ · **Changer de style** : garder un visage, préciser le rendu · **Remplacer un objet** : produit, personnage, décor · **Transfert de mouvement** : danse, défilé de vêtement, mascotte |

Les 6 premiers modèles sont affichés ; « + N autres » déplie la liste.

- Les parties entre **[crochets]** sont à remplacer : la première est sélectionnée, **Tab** passe à la suivante.
- Le modèle règle aussi le format, la durée et, en Pub, le ton, le rythme et la caméra adaptés à la scène
  (ex. Story Instagram : 9:16, 15 s, ton dynamique, caméra épaule), si le modèle d'IA choisi les propose.
- Si un texte était déjà écrit, la notification propose **Annuler** pour le récupérer.
- **Influenceur** (Image et Vidéo) : crée un personnage identique à la personne de vos images de référence. Si le
  modèle d'IA choisi n'accepte pas de références, il passe sur Grok Imagine Image 2.0 (image) ou Seedance 2.5
  (vidéo). Ajoutez 3 à 5 photos nettes de la personne (de face, de profil, en pied) : plus elles sont variées,
  plus la ressemblance tient. Pour une ressemblance encore plus stable d'une génération à l'autre, un avatar
  entraîné (onglet Avatar) reste le plus fiable.
- **UGC** (Pub et Vidéo) : vidéos façon contenu client, filmées au smartphone, face caméra, ton spontané.
  - En **Pub** : déposez la personne dans « Personnages » et le produit dans « Produits ». Le modèle choisit le ton
    **UGC**, qui remplace la finition « publicité professionnelle » par un rendu smartphone réaliste.
  - En **Vidéo** : la personne et le produit viennent des **images de référence**. Passage sur Seedance 2.5 si le
    modèle choisi n'en accepte pas, et son activé.
  - Les phrases à dire sont entre guillemets. Le modèle peut faire parler le personnage, mais la synchronisation
    des lèvres et le texte exact ne sont pas garantis.
- Pour ajouter ou modifier un modèle : objet `TEMPLATES` dans le script de `index.html`.

### Coût et annulation

- **Confirmation de la dépense, avant chaque lancement** (génération, édition, pub ou entraînement d'avatar),
  quel que soit le montant : la page demande le prix exact à Higgsfield (`POST /estimate/<modèle>`, avec les mêmes
  paramètres que la génération), puis une fenêtre affiche le montant et demande de confirmer.
  Si un modèle ne fournit pas d'estimation, la page affiche le prix du catalogue (approximatif) ou
  « Prix non communiqué » (cas de l'entraînement d'avatar).
- **Annuler** : le bouton apparaît dans le cadre pendant l'attente.
  - Pendant l'envoi des fichiers ou la confirmation : rien n'est lancé, aucun frais.
  - En file d'attente chez Higgsfield : la génération est annulée et remboursée automatiquement.
  - Une fois la génération démarrée, Higgsfield ne permet plus de l'annuler : elle va au bout et elle est facturée.
- Les générations en échec ou refusées par la modération ne sont pas facturées.

### Solde affiché

L'API Higgsfield ne permet pas de lire le solde du compte. La pastille **Solde** en haut de la page fonctionne donc ainsi :

1. Cliquez dessus et recopiez le solde affiché dans la console Higgsfield.
2. La page relève ensuite vos dépenses chez Higgsfield depuis cette saisie (`GET /models/usage`) : au chargement,
   toutes les 5 minutes, et 1 min 30 après chaque génération. Ce relevé compte aussi les dépenses faites ailleurs
   (autre PC, console).
3. En attendant ce relevé (Higgsfield le met à jour avec un peu de retard), la page retire elle-même le coût de
   chaque génération réussie. Le solde affiché retient la plus grande des deux dépenses.
4. La fenêtre de confirmation affiche le solde restant après la dépense, en orange s'il est insuffisant.

Cliquez sur la pastille pour le détail (montant saisi, dépenses comptées, dépenses relevées) et le bouton
**Relever maintenant**. Le relevé est une analyse, pas une facture : recopiez le solde de la console de temps en
temps pour le recaler. Si le relevé n'est pas disponible pour votre compte, la page l'indique et se contente de
son propre décompte.

### File d'attente : plusieurs générations à la fois

- Après la confirmation du prix, la génération part chez Higgsfield et apparaît dans une pastille sous le cadre
  (« En cours · 2 »…). Le formulaire est aussitôt libre : changez de prompt, de mode ou de modèle et relancez.
- Cliquez sur une pastille pour suivre cette génération dans le cadre (étape, temps écoulé, bouton **Annuler**).
- À la fin, une notification **Voir** affiche le résultat. Le titre de l'onglet indique le nombre en cours.
- Si vous rechargez ou fermez la page, le suivi reprend à la réouverture (même navigateur, clé enregistrée).
- Higgsfield limite le nombre de demandes simultanées par compte : au-delà, le message « Trop de demandes » s'affiche.

### Projets

Un projet = un client ou une campagne. La pastille en haut à gauche (« Aucun projet » ou le nom du projet actif)
ouvre la fenêtre **Projets**. Les projets sont propres à chaque compte.

**Quand un projet est actif :**
- tout ce que vous générez y est **rangé automatiquement** (images, vidéos, éditions, pubs, plans de storyboard) ;
- la **bande « Kit »** apparaît en haut du formulaire : un clic sur « Léa » ou « Sérum ambré » ajoute ses photos en
  images de référence (en Pub : dans Personnages, Produits ou Lieu, avec la marque et le slogan préremplis). Si le
  modèle n'accepte qu'une image de départ, la première photo devient l'image de départ. La notification propose de
  citer l'élément dans le prompt (« Léa (les images 1 à 2) ») ;
- la case **Ajouter le style du projet au prompt** ajoute « Style : … » à la fin du prompt envoyé ;
- le **format par défaut** du projet (ex. 9:16) est choisi à l'activation ;
- la **bibliothèque** n'affiche que ce projet (liste déroulante : tous les projets, sans projet, ou un autre projet) ;
- l'onglet **Storyboard** ne montre que les storyboards du projet ; un nouveau storyboard reprend son style ;
- la confirmation du prix rappelle le **budget** du projet, en orange s'il serait dépassé.

**Dans la fenêtre d'un projet :**
- **Contenus et livraison** : les éléments du projet, **+ Ajouter depuis la bibliothèque** (pour y ranger des éléments
  déjà générés), **Retirer** (l'élément reste dans « Sans projet »), cases **À livrer**, et **Exporter la sélection en
  ZIP** : un dossier au nom du projet, fichiers numérotés et nommés (`01_kling-3-0-turbo_20261028-1951.mp4`,
  `03_plan-2-accroche_….mp4`). Dépenses par modèle en bas (montants confirmés au lancement).
- **Kit** : personnages, produits (avec slogan) et lieux, chacun avec un nom et jusqu'à 10 photos (fichier, glisser-
  déposer ou bibliothèque) ; style du projet ; format par défaut.
- **Réglages** : nom, client, budget, notes, couleur ; **Archiver** (masqué et désactivé, rien n'est supprimé) ;
  **Supprimer le projet** en gardant ses éléments (ils passent dans « Sans projet ») ou avec ses éléments.

Les photos du kit ne sont jamais effacées quand on supprime une génération qui les utilisait (pas plus que les images
de départ des plans de storyboard). La dépense d'un projet est la somme des montants confirmés au lancement :
Higgsfield ne sait pas à quel projet appartient une génération.

### Storyboard (onglet Storyboard)

Pour raconter une histoire ou une pub en plusieurs plans, générés d'un coup.

1. **Partir de :** un modèle (UGC · 3 raisons, UGC · Day in my life, Pub produit, Histoire en 3 actes, Tutoriel, Teaser de lancement) crée un storyboard
   prêt à adapter : remplacez les parties entre [crochets]. Ou **+ Nouveau** pour partir de zéro.
2. **Style commun** (facultatif) : ajouté à la fin du prompt de chaque plan (« Style : … »). Décrivez-y ce qui doit
   rester identique d'un plan à l'autre : rendu, lumière, et surtout le personnage (âge, tenue…).
3. Chaque **plan** a un titre, un prompt, une **durée** et une **image de départ** facultative (obligatoire pour
   les modèles qui ne partent pas d'un texte). Boutons ↑ ↓ pour réordonner, ⧉ pour dupliquer, ✕ pour supprimer.
4. Choisissez le **modèle** et les options (format, résolution, son) : ils s'appliquent à tous les plans.
5. **Générer les N plans** lance tous les plans pas encore générés. Une seule confirmation affiche le prix total.
   Les plans partent dans la file d'attente, en parallèle. Chaque plan affiche son état.
6. **Regénérer** sur un plan lance une nouvelle prise (facturée). Les flèches **‹ prise 2/3 ›** choisissent celle à
   garder. **Générer ce plan** ne lance que lui.
7. **▶ Lire la séquence** enchaîne dans le cadre les prises choisies, dans l'ordre des plans.

Les vidéos des plans vont dans la bibliothèque comme les autres (badge « plan N »). **Réutiliser** sur l'une d'elles
la reprend dans l'onglet Vidéo. Le texte des storyboards est enregistré dans `bibliotheque/storyboards.json`.
Supprimer un storyboard ne supprime pas ses vidéos.

Pas encore inclus : l'assemblage des plans en un seul fichier MP4 (montage), et l'enchaînement automatique de la
dernière image d'un plan vers le suivant.

### Variantes

Au-dessus du bouton **Générer**, **Variantes ×1 / ×2 / ×4** lance le même prompt plusieurs fois, en parallèle, pour
garder le meilleur résultat. Les fichiers ne sont envoyés qu'une fois ; la confirmation affiche le prix total
(prix d'une génération × nombre de variantes). Chaque variante est une génération facturée.

Dans la file d'attente et la bibliothèque, elles portent leur numéro (« 1/4 », « 2/4 »…). Pour choisir, utilisez
**Comparer**. Si Higgsfield refuse une partie des variantes (trop de demandes), celles déjà parties continuent et
les autres ne sont pas facturées.

Le choix revient à ×1 à chaque ouverture de la page, pour éviter une dépense par mégarde.

### Bibliothèque

Tout résultat terminé est **téléchargé automatiquement** par le serveur dans le dossier de votre compte (`donnees/utilisateurs/<id>/bibliotheque/fichiers/`), avec
son prompt, son modèle, ses options, sa date et son coût (`bibliotheque/historique.json`). Il n'expire donc plus
au bout des 7 jours de Higgsfield.

- **Afficher** : cliquez sur une vignette (une vidéo se lit au survol). Le résultat s'ouvre dans le cadre, avec
  **Télécharger**, **Ouvrir**, **Animer en vidéo** ou **Éditer cette vidéo**.
- **Réutiliser** : reprend le mode, le modèle, les options, le prompt **et les fichiers joints** (image de départ,
  images de référence, vidéo source, images et textes d'une pub). Ces fichiers sont gardés dans
  `bibliotheque/entrees/`, une seule fois même s'ils servent à plusieurs générations. Pour les générations faites
  avant cette fonction, la page indique les fichiers à ajouter à nouveau.
- **★ Favoris** : l'étoile d'une carte (ou le bouton **Favori** sous le cadre) la marque ; le filtre **★ Favoris**
  n'affiche qu'elles.
- **Comparer** : cliquez sur **Comparer** sur deux cartes. Une fenêtre les montre côte à côte, avec leurs réglages ;
  ce qui diffère est marqué « ≠ ». Pour deux vidéos, **Lire les deux depuis le début** les lance ensemble.
  Depuis cette fenêtre : mettre en favori, **Afficher** dans le cadre, ou **Réutiliser**.
- **Réutiliser une image ou une vidéo comme entrée** : la **vidéo source** de l'onglet Édition, et partout où l'on ajoute une image (images de référence, image de départ,
  éléments d'une pub, photos d'avatar, image de départ d'un plan du storyboard), la tuile ou le bouton
  **Bibliothèque** ouvre vos images générées. Recherche et filtre **★ Favoris**. Cliquez dans l'ordre voulu (les
  numéros affichés seront ceux des images dans le prompt), puis **Ajouter**. Double-clic pour une image seule.
- **Filtrer** (Tout, Vidéos, Images, Favoris) et **rechercher** dans les prompts et les modèles.
- **Supprimer** (corbeille, deux clics) : retire l'élément et efface ses fichiers du disque. Les fichiers joints sont
  effacés quand plus aucune génération ne les utilise.
- **Ouvrir le dossier** : ouvre ce dossier dans l'explorateur (seulement quand le serveur tourne sur votre PC).
- Sauvegarde : copiez le dossier `bibliotheque/` entier. Ne renommez pas les fichiers à l'intérieur.
- Si l'enregistrement échoue (disque plein, serveur arrêté…), la pastille devient rouge « Non enregistrée » :
  cliquez dessus pour réessayer. Le résultat reste visible depuis Higgsfield pendant 7 jours.

La page retient dans le navigateur le mode et le modèle choisis, le solde saisi et les générations en cours.

## 5. Modèles disponibles

**Prix** : affiché à côté de chaque modèle dans la liste (ex. « dès 0,042 $/s »). Il vient du
catalogue public Higgsfield au 26/10/2026 et inclut les promotions en cours. « dès » signifie que le prix
augmente avec la qualité, la résolution ou le son. Pour une vidéo, multipliez par la durée : 5 s à 0,042 $/s ≈ 0,21 $.
Le prix réel fait foi dans la console Higgsfield. Pour le mettre à jour, modifiez `price: PRICE(...)` dans `MODELS`.

Options d'après la doc officielle au 26/10/2026. Les options peuvent changer selon qu'une image de départ
est fournie ou non (souvent, le format suit alors l'image) : la page s'adapte automatiquement.

**Image**

| Modèle                      | Images de référence | Format                                        | Résolution | Options |
|-----------------------------|---------------------|-----------------------------------------------|------------|---------|
| Soul (standard)             | Non (texte seul)    | 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3           | 720p, 1080p | Améliorer le prompt |
| Marketing Studio Image 2.0  | 0 à 16              | Auto, 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 21:9 | 1K, 2K, 4K | Qualité |
| Grok Imagine Image 2.0      | 0 à 10              | Auto, 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 2:1, 1:2 | 1K, 2K | Qualité |
| Qwen Image 3                | 0 à 3 (mode édition)| 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 7:9, 9:7, 21:9 | 1K, 2K | Améliorer le prompt |
| Ideogram 4.0                | 0 ou 1              | 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 4:5, 5:4, 2:1, 1:2 | — | Rendu, fidélité à l'image |

**Créer une image à partir d'une image de référence** : choisissez un modèle qui en accepte (tous sauf Soul), puis
ajoutez vos images dans **Images de référence** (clic, glisser-déposer ou `Ctrl+V`). Citez-les dans le prompt par leur
numéro : « le personnage de l'image 1 dans le décor de l'image 2 ». Sans image, ces modèles partent du texte seul.

- **Grok** mélange librement plusieurs images (personnage + décor + objet).
- **Qwen** passe en mode édition : décrivez la modification (« remplace le fond par une plage »).
- **Ideogram** part d'une seule image. **Fidélité à l'image** (25 à 100 %) règle la ressemblance ; il écrit bien le
  texte dans l'image (affiches).
- **Marketing Studio** compose des visuels publicitaires à partir de photos de produit (JPEG, PNG ou WebP).

Les prix d'Ideogram et de Marketing Studio ne sont pas publiés dans le catalogue : le montant exact s'affiche à la
confirmation, avant toute dépense.

**Vidéo** (25 modèles)

| Modèle                       | Durée      | Format                    | Résolution             | Son | Image de départ |
|------------------------------|------------|---------------------------|------------------------|-----|-----------------|
| Seedance 2.5                 | 4–30 s     | 16:9, 9:16, 1:1, 4:3, 3:4, 21:9 | 480p, 720p, 1080p | ✓ | Facultative |
| Seedance 2.0                 | 4–15 s     | idem                      | 480p, 720p, 1080p, 4K  | ✓   | Facultative     |
| Kling 4.0                    | défaut     | défaut                    | défaut                 |     | Non             |
| Kling 3.0 Turbo              | 3–15 s     | 16:9, 9:16, 1:1           | 720p, 1080p            |     | Facultative     |
| Kling 3.0 Standard / Pro / 4K| 3–15 s     | 16:9, 9:16, 1:1           | —                      | ✓   | Facultative     |
| Kling O3 (première image)    | 3–15 s     | 16:9, 9:16, 1:1           | Qualité : Standard, Pro, 4K | ✓ | Obligatoire |
| Kling O1 Omni (première image)| 5 ou 10 s | 16:9, 9:16, 1:1           | Qualité : Standard, Pro | —  | Obligatoire     |
| Kling 2.6 Pro                | 5 ou 10 s  | 16:9, 9:16, 1:1           | —                      | ✓   | Facultative     |
| Kling 2.5 Turbo Pro          | 5 ou 10 s  | —                         | —                      |     | Facultative     |
| Kling 2.5 Turbo Standard     | 5 ou 10 s  | —                         | —                      |     | Obligatoire     |
| MiniMax H3                   | 5–15 s     | Auto, 16:9, 9:16, 1:1, 4:3, 3:4, 21:9 | 2K (fixe)  |     | Facultative     |
| MiniMax Hailuo 2.3           | 6 ou 10 s  | —                         | —                      |     | Facultative     |
| Wan 3.0 Prime / Wan 3.0      | 2–30 s     | Adaptatif, 16:9, 9:16, 1:1, 4:3, 3:4 | 480p, 720p, 1080p | ✓ | Facultative |
| Wan 2.7                      | 2–15 s     | 16:9, 9:16, 1:1, 4:3, 3:4 | 720p, 1080p            |     | Facultative     |
| Wan 2.6                      | 5, 10, 15 s| —                         | 720p, 1080p (+480p avec image) | | Facultative |
| Happy Horse 1.1 / 1.0        | 3–15 s     | 16:9, 9:16, 1:1, 4:3, 3:4 | 720p, 1080p            |     | Facultative     |
| LTX 2.5 Fast                 | 6, 8, 10 s | 16:9, 9:16                | 720p, 1080p, 2K, 4K    | ✓   | Facultative     |
| LTX 2.5 Pro                  | 6, 8, 10 s | 16:9, 9:16                | 720p, 1080p            | ✓   | Facultative     |
| PixVerse 6                   | 1–15 s     | 16:9, 9:16, 1:1, 4:3, 3:4 | 360p à 1080p           | ✓   | Facultative     |
| Grok Imagine Video 1.5       | 1–15 s     | Auto, 16:9, 9:16, 1:1, 4:3, 3:4, 3:2, 2:3 | 480p, 720p, 1080p | | Facultative |
| Cinema Studio 4.0            | 4–30 s     | 16:9, 9:16, 1:1, 4:3, 3:4, 21:9 | 480p, 720p       | ✓   | Facultative     |

**Images de référence** (plusieurs images) — modèles compatibles et nombre maximum :

| Modèle                  | Max | Combinable avec une image de départ |
|-------------------------|-----|-------------------------------------|
| Seedance 2.5            | 30  | Non |
| Seedance 2.0            | 9   | Non |
| Kling O3                | 7   | Oui |
| Kling O1 Omni           | 7   | Non |
| MiniMax H3              | 9   | Non |
| Wan 3.0 Prime / Wan 3.0 | 10  | Non |
| Wan 2.7                 | 5   | Non |
| Happy Horse 1.1 / 1.0   | 9   | Non |
| Grok Imagine Video 1.5  | 7   | Non (résolution limitée à 480p/720p) |
| Cinema Studio 4.0       | 30  | Oui |

Avec des références, la page bascule sur l'endpoint « référence » du modèle : les options proposées
peuvent changer. Si une combinaison n'est pas possible, un message orange l'indique sous les options.

**Kling 4.0** vient de sortir et n'est pas encore documenté : seul le prompt est envoyé, avec les réglages
par défaut du modèle. Ajoutez ses options dans `MODELS` dès qu'elles seront publiées.

**Édition** (vidéo source MP4, 200 Mo max ; au-delà de 30 s, seul le début est traité)

| Type d'édition          | Modèle (route API)                         | Prompt      | Images jointes                  | Options |
|-------------------------|--------------------------------------------|-------------|---------------------------------|---------|
| Modifier la vidéo       | Seedance 2.5 (`video-edit`)                | Obligatoire | Facultatives, 30 max            | Résolution 480p/720p/1080p, débit, son. Durée = celle de la source |
| Prolonger la vidéo      | Seedance 2.5 (`video-extend`)              | Obligatoire | Facultatives, 30 max            | Durée ajoutée 4–30 s, résolution, débit, son |
| Changer de style        | Genjutsu Restyle                           | Facultatif  | Personnages, 5 max              | Style (obligatoire), résolution. Vidéo de 4 s min. |
| Remplacer un objet      | Genjutsu Object swap                       | Facultatif  | Nouvel objet, 1 à 8 (obligatoire) | Résolution. Vidéo de 4 s min., 640×640 px min. |
| Transfert de mouvement  | Genjutsu Motion transfer                   | Facultatif  | Sujets à animer, 1 à 8 (obligatoire) | Résolution. Vidéo de 4 s min. |

Les styles de Restyle viennent de `GET /models/higgsfield/genjutsu/restyle/v1.0/presets` (chargés à l'ouverture,
avec votre clé).

**Prix des éditions** (tarifs renvoyés par Higgsfield le 28/10/2026, avant remise éventuelle), par seconde, durée
arrondie à la seconde supérieure :

| Édition | 480p | 720p | 1080p | Durée facturée |
|---------|------|------|-------|----------------|
| Genjutsu (style, objet, mouvement) | 0,318 $ | 0,681 $ | 1,632 $ | Durée de la vidéo source |
| Seedance 2.5 · Modifier | ≈ 0,123 $ | ≈ 0,277 $ | ≈ 0,682 $ | Source **+** vidéo produite (même durée) : 10 s de source = 20 s facturées |
| Seedance 2.5 · Prolonger | ≈ 0,123 $ | ≈ 0,277 $ | ≈ 0,682 $ | Source **+** durée ajoutée |

Pour ces modèles, Higgsfield ne renvoie pas un montant mais un tarif décrit en texte : la page le lit et calcule le prix
d'après la résolution et la durée de votre vidéo. Seedance dépend aussi du format de sortie (« ≈ »). Higgsfield
**réserve le prix complet** sur votre solde avant de lancer : si le solde ne le couvre pas, la demande est refusée
(« Solde insuffisant »).

**Non inclus** : Kling Motion Control, Kling O3 / Omni avec vidéo de référence, et les références audio ou vidéo
supplémentaires de Seedance (`audio_urls`, `video_urls`).

### Ajouter ou modifier un modèle

Tout se trouve dans l'objet `MODELS` en haut du script de `index.html`. Exemple :

```js
{
  group: 'Mon éditeur',
  label: 'Mon modèle vidéo',
  // sans image de départ
  text:  { path: '/editeur/modele/text-to-video',  params: { duration: DUR([5, 10], 5), aspect_ratio: AR(['16:9', '9:16'], '16:9') } },
  // avec image de départ (imageField facultatif, "image_url" par défaut)
  image: { path: '/editeur/modele/image-to-video', params: { duration: DUR([5, 10], 5) } },
}
```

Raccourcis disponibles : `DUR` (durée), `AR` (format), `RES` (résolution), `AUDIO` (son, paramètre
`generate_audio`), `SOUND` (son, paramètre `sound`), `MODE` (qualité) et `range(a, b)` pour une plage de durées.
Le nom de chaque paramètre (`duration`, `aspect_ratio`…) doit être exactement celui attendu par l'API.
La page de chaque modèle dans la doc donne son schéma complet (section « Input schema »).
La liste des modèles et de leurs paramètres se trouve dans la console Higgsfield et sur <https://docs.higgsfield.ai>.

## 6. Messages d'erreur

| Message                     | Cause                                       | Que faire                               |
|-----------------------------|---------------------------------------------|-----------------------------------------|
| Clé invalide                | Clé API incorrecte ou incomplète (401)      | Vérifier et réenregistrer la clé        |
| Solde insuffisant           | Le solde ne couvre pas le prix complet, réservé par Higgsfield avant de lancer (403) | Recharger, ou baisser la résolution ou la durée |
| Paramètres refusés          | Option non acceptée par le modèle (400/422) | Changer les options                     |
| Trop de demandes            | File d'attente pleine (429)                 | Patienter                               |
| Modèle indisponible         | Modèle bloqué ou en maintenance (423/503)   | Réessayer plus tard ou changer de modèle|
| Refusé par la modération    | Contenu jugé inapproprié                    | Reformuler le prompt                    |
| Serveur injoignable         | Serveur arrêté ou connexion coupée          | Relancer le serveur, vérifier la connexion |
| Session expirée             | Session terminée ou compte désactivé        | Se reconnecter                          |
| Clé API manquante           | Aucune clé sur votre compte                 | Carte « Clé API » : enregistrer sa clé  |

## 7. Sécurité (résumé)

- **Connexion obligatoire** pour tout, sauf la page elle-même et l'écran de connexion.
- **Mots de passe** hachés avec scrypt (jamais stockés en clair). Après 5 essais ratés, la connexion est bloquée
  15 minutes pour ce compte et cette adresse IP. Message identique que le compte existe ou non.
- **Sessions** : jeton aléatoire dans un cookie `HttpOnly`, `SameSite=Strict` (et `Secure` en HTTPS). Le serveur
  ne garde que son empreinte. Déconnexion et changement de mot de passe ferment les sessions.
- **Clés API** chiffrées (AES-256-GCM, liées au compte), jamais renvoyées au navigateur, jamais écrites dans les logs.
- **Séparation** : chaque utilisateur n'accède qu'à ses propres fichiers. Les routes d'administration sont
  réservées aux administrateurs.
- Contrôle des en-têtes `Host` et `Origin` (aucun autre site ne peut appeler le serveur), en-têtes de sécurité
  (CSP, interdiction d'affichage dans un cadre, HSTS en HTTPS).
- `/download` ne télécharge que le résultat d'une génération (retrouvé via l'API avec la clé du compte), jamais une
  URL arbitraire. La bibliothèque ne sert que ses propres fichiers, par leur nom exact.
- Les logs ne contiennent que la méthode, le chemin, le code de réponse et l'e-mail du compte.
- **Sur internet, utilisez toujours HTTPS** (proxy devant le serveur, `TRUST_PROXY=1`, `PUBLIC_URL` en `https://`).
  Sans HTTPS, mots de passe et cookies circuleraient en clair.

## Routes du serveur (référence)

Toutes les routes demandent d'être connecté, sauf `/`, `/auth/state`, `/auth/setup`, `/auth/login` et `/auth/logout`.

| Méthode    | Route                              | Rôle                                                         |
|------------|------------------------------------|--------------------------------------------------------------|
| GET        | `/auth/state`                      | Compte connecté (sans la clé), installation à faire ou non |
| POST       | `/auth/setup`                      | Premier compte administrateur (code d'installation) |
| POST       | `/auth/login` · `/auth/logout` · `/auth/logout-all` | Connexion, déconnexion, déconnexion de tous les appareils |
| POST       | `/auth/password`                   | Changer son mot de passe |
| PUT / DELETE | `/auth/key`                      | Enregistrer (après vérification) ou supprimer sa clé API |
| GET / POST | `/admin/users`                     | Liste des comptes, création (renvoie le mot de passe provisoire) |
| POST       | `/admin/users/<id>/reset` · `/disable` · `/role` | Réinitialiser le mot de passe, désactiver, changer le rôle |
| DELETE     | `/admin/users/<id>`                | Supprimer un compte et ses fichiers |
| GET        | `/`                                | Sert `index.html`                                            |
| GET / POST | `/hf/*`                            | Relaie vers `https://api.higgsfield.ai/*`, avec la clé du compte connecté |
| POST       | `/upload`                          | Envoie une image (20 Mo max) ou une vidéo MP4 (200 Mo max) chez Higgsfield, renvoie `public_url` |
| GET        | `/download?request_id=…&name=…&index=…` | Renvoie le fichier généré en pièce jointe (`index` : image choisie dans un lot de 4) |
| GET        | `/library`                         | Historique de la bibliothèque (du plus récent au plus ancien) |
| POST       | `/library/save`                    | `{ request_id, meta }` : télécharge le résultat terminé dans `bibliotheque/` et l'ajoute à l'historique |
| GET        | `/library/file/<nom>?dl=…`         | Sert un fichier enregistré (lecture vidéo avec Range ; `dl` = en pièce jointe) |
| DELETE     | `/library/<id>`                    | Supprime un élément, ses fichiers et ses fichiers joints devenus inutiles |
| POST       | `/library/<id>/fav`                | `{ fav: true }` ou `{ fav: false }` : ajoute ou retire des favoris |
| POST       | `/library/input`                   | Garde un fichier joint (corps brut, image 20 Mo ou MP4 200 Mo), renvoie `{ name }` |
| GET        | `/library/input/<nom>`             | Sert un fichier joint gardé |
| POST       | `/library/open`                    | Ouvre le dossier des fichiers dans l'explorateur (serveur sur ce PC seulement) |
| GET / PUT  | `/storyboards`                     | Lit ou remplace la liste des storyboards (`{ boards: [...] }`, 2 Mo max) |
| GET / PUT  | `/projects`                        | Lit ou remplace la liste des projets (`{ projects: [...] }`, 2 Mo max) |
| POST       | `/library/move`                    | `{ ids, project_id }` : range des éléments dans un projet (`null` : sans projet) |
| GET        | `/library/export?ids=…&name=…`     | ZIP des éléments choisis, avec des noms de fichiers lisibles (3,5 Go max) |
