# Installation — Agentic-Hub

Installation **en un clic**, **sans Node ni npm** : tout s'exécute dans Docker.
L'installeur détecte ton matériel (GPU/VRAM ou RAM) et choisit automatiquement le
modèle LLM adapté, puis télécharge tout le nécessaire.

## 📤 Partager l'installeur (un seul fichier suffit)

Le fichier d'installation est **autonome** : tu peux l'envoyer seul à un collègue.
Au double-clic, il installe Docker et Git si besoin, **clone le projet**, puis lance tout.

- **Windows** → partage **`Install-Windows.cmd`**
- **macOS** → partage **`Install-macOS.command`**

> Le dépôt est **privé** : au premier clonage, ton collègue devra **s'authentifier à
> GitHub** (une fenêtre de connexion Git s'ouvre automatiquement). Il lui faut donc un
> accès au dépôt `ITS-Corentyn/Agentic-Hub`. Aucun autre fichier, ni Node/npm, n'est requis.

Le même fichier fonctionne aussi **à l'intérieur d'un dépôt déjà cloné** (il l'utilise sur place).

## Prérequis unique : Docker Desktop

C'est le **seul** logiciel à avoir (il embarque tout le reste). Si tu ne l'as pas,
l'installeur te proposera de l'installer (via `winget` sur Windows, `brew` sur macOS)
ou t'enverra vers : https://www.docker.com/products/docker-desktop/

> Lance Docker Desktop **avant** l'installation et attends qu'il soit « running ».

## Windows

1. Double-clique **`Install-Windows.cmd`**.
2. Laisse faire : vérification Docker → détection matériel → build → téléchargement du modèle.
3. Le navigateur s'ouvre sur l'interface. ✅

Arrêter : double-clique **`Stop-Windows.cmd`**. Redémarrer : re-double-clique `Install-Windows.cmd` (idempotent).

## macOS

1. Double-clique **`Install-macOS.command`**.
   - Au premier lancement, macOS peut bloquer le script : **clic droit → Ouvrir → Ouvrir**,
     ou autorise-le dans *Réglages Système → Confidentialité et sécurité*.
2. Laisse faire l'installation.
3. Le navigateur s'ouvre sur l'interface. ✅

Arrêter : double-clique **`Stop-macOS.command`**.

> Sur Mac, Docker n'accède pas au GPU (Metal) : l'inférence LLM tourne sur CPU.
> Pour accélérer, tu peux installer Ollama nativement (`brew install ollama`) et mettre
> `OLLAMA_URL=http://host.docker.internal:11434` dans `.env`.

## Choix automatique du modèle (cohérence matérielle)

| Matériel détecté | Modèle choisi |
|---|---|
| GPU NVIDIA < 5 Go VRAM | `qwen2.5-coder:1.5b` |
| GPU NVIDIA 5–9 Go | `qwen2.5-coder:3b` |
| GPU NVIDIA 9–18 Go | `qwen2.5-coder:7b` |
| GPU NVIDIA ≥ 18 Go | `qwen2.5-coder:14b` |
| Sans GPU (CPU) | `1.5b` / `3b` / `7b` selon la RAM (plafonné à 7b) |

- GPU NVIDIA détecté → l'accélération GPU est activée automatiquement
  (`infra/docker-compose.gpu.yml`), avec repli CPU si indisponible.
- Tu peux forcer un autre modèle en éditant `OLLAMA_MODEL` dans `.env`.
- Le LLM est **optionnel** : sans modèle, les rapports restent complets (synthèse en
  gabarit déterministe, sans coût).

## Connexion à GitHub (pour auditer tes repos)

Une fois l'app lancée, pour récupérer **tes repos et ceux de tes organisations** :

1. Crée une OAuth App : https://github.com/settings/developers → **New OAuth App**
   - **Homepage URL** : `http://localhost:<WEB_PORT>` (affiché en fin d'installation)
   - **Authorization callback URL** : `http://localhost:<API_HOST_PORT>/api/auth/github/callback`
2. Mets le **Client ID** et le **Client secret** dans `.env` :
   ```
   GITHUB_OAUTH_CLIENT_ID=...
   GITHUB_OAUTH_CLIENT_SECRET=...
   ```
3. Relance l'installeur (idempotent) → clique **« Se connecter »** → **« Synchroniser GitHub »**.

> Alternative sans OAuth : `GITHUB_TOKEN=<PAT>` dans `.env` (scope `repo`).

## Dépannage

- **« Docker n'est pas disponible »** : lance Docker Desktop et attends qu'il soit prêt.
- **Ports occupés** : l'installeur choisit automatiquement des ports libres (et réutilise
  ceux d'une install existante).
- **Logs** : `docker compose --env-file .env -f infra/docker-compose.yml logs -f api`
- **Repartir de zéro** (efface la base) :
  `docker compose --env-file .env -f infra/docker-compose.yml down -v`
