# Agentic-Hub

Plateforme d'audit **multi-repositories** — sécurité, dépendances, qualité de code,
architecture, backend, frontend et performance — **100 % open-source, sans API payante**.

> Anciennement basé sur le CLI Claude Code (API Anthropic payante). L'IA payante a été
> **retirée** : les faits sont collectés par de vrais scanners open-source, et la
> narration/synthèse est assurée par un **LLM local gratuit (Ollama)** — désactivable.

## ✨ Fonctionnalités

- **Audit « agence »** par repository : un rapport complet et détaillé avec, pour chaque
  problème, sa **criticité, le fichier:ligne, la description et le correctif** à appliquer.
- **Scanners open-source** : Semgrep, Gitleaks, Trivy, OSV-Scanner, ESLint, jscpd,
  dependency-cruiser, madge, npm audit — plus la détection/génération **Dependabot**.
- **Scoring déterministe** par dimension + score global pondéré (configurable).
- **Synthèse LLM locale (Ollama)** : executive summary, Top 10, roadmaps 7j/30j —
  avec **fallback déterministe** si Ollama est éteint.
- **Interface web** (Vue 3 + GSAP + Tailwind) : dashboard, rapport par repo, audit live (SSE), réglages.
- **Orchestration** multi-repos via l'**API GitHub** (Octokit), en **mode local** (clone + scan)
  ou **hybride** (déclenche GitHub Actions, qui pousse les résultats à l'API).

## 🧱 Stack

| Couche | Techno |
|---|---|
| Frontend | Vue 3, Vite, TypeScript, Pinia, Vue Router, TailwindCSS v4, GSAP |
| Backend | Fastify, TypeScript, Zod, Octokit, pg-boss (file de jobs), SSE |
| Données | PostgreSQL + Prisma |
| Moteur | `@agentic-hub/audit-engine` (scanners + normalisation + scoring + rapport) |
| LLM | Ollama (local, gratuit) — `qwen2.5-coder` par défaut |
| Infra | Docker Compose (postgres, ollama, api, web) |

## 📦 Structure (monorepo pnpm)

```
apps/
  api/            API Fastify (REST, SSE, ingestion, dispatch GitHub, synthèse Ollama)
  web/            Interface Vue 3 (dashboard, rapports, audit live, réglages)
packages/
  shared/         Contrats partagés (types + schémas Zod)
  db/             Schéma Prisma + client + seed
  audit-engine/   Runners scanners, normaliseurs, scoring, génération de rapport, CLI
scanners/         Image Docker "toolbox" + run-scanners.sh
.github/workflows/
  audit.yml       Audit multi-repo (dispatch → ingestion API)
  daily-audit.yml Auto-audit quotidien (open-source, artefact) — sans Claude
```

## 🚀 Installation en un clic (recommandé, sans Node/npm)

Seul **Docker Desktop** est requis. L'installeur détecte ton matériel (GPU/VRAM ou RAM),
choisit le modèle LLM adapté, build, démarre et télécharge tout le nécessaire.

- **Windows** : double-clique **`Install-Windows.cmd`**
- **macOS** : double-clique **`Install-macOS.command`**

Détails, choix du modèle et dépannage → **[INSTALL.md](INSTALL.md)**.

## 🚀 Démarrage manuel (alternative)

```bash
cp .env.example .env        # renseigner les clés GitHub OAuth (ou GITHUB_TOKEN)
docker compose --env-file .env -f infra/docker-compose.yml up -d --build
# Récupérer le modèle Ollama (1re fois) :
docker compose --env-file .env -f infra/docker-compose.yml exec ollama ollama pull qwen2.5-coder:7b
```

- Web : http://localhost:8080 (ou `WEB_PORT`)
- API : http://localhost:3000 (ou `API_HOST_PORT`) — `/api/health`

En **mode local** (sans `AUDIT_WORKFLOW_REPO`), l'API clone et scanne directement les repos
(l'image API embarque tous les scanners).

## 🔐 Connexion GitHub (récupérer ses repos + organisations)

Deux façons de connecter ton compte :

### Option A — Connexion via compte GitHub (OAuth, recommandée)
1. Va sur https://github.com/settings/developers → **New OAuth App**.
2. Renseigne :
   - **Homepage URL** : `http://localhost:8088` (ton interface web)
   - **Authorization callback URL** : `http://localhost:3200/api/auth/github/callback`
     (le port doit correspondre à `API_HOST_PORT`)
3. Copie le **Client ID**, génère un **Client secret**, et place-les dans `.env` :
   ```
   GITHUB_OAUTH_CLIENT_ID=...
   GITHUB_OAUTH_CLIENT_SECRET=...
   ```
4. Redémarre l'API, ouvre l'UI, clique **« Se connecter »** → autorise.
   Tous tes repos **et ceux de tes organisations** sont alors récupérables via **« Synchroniser GitHub »**.

### Option B — Personal Access Token (sans OAuth)
1. https://github.com/settings/tokens → **Generate new token**
   - *Classic* : cocher **`repo`** (+ `workflow` pour le mode hybride)
   - ou *Fine-grained* : **Contents: Read-only** sur les repos voulus
2. Place-le dans `.env` : `GITHUB_TOKEN=...` (et éventuellement `GITHUB_OWNER=<user-ou-org>`).

> Le token OAuth est stocké en base (outil local mono-utilisateur). « Déconnexion » le supprime.

## 🛠️ Développement (sans Docker)

```bash
pnpm install
pnpm --filter @agentic-hub/db generate
# Postgres requis (DATABASE_URL) :
pnpm --filter @agentic-hub/db migrate:dev
pnpm --filter @agentic-hub/db seed
pnpm dev          # api (:3000) + web (:5173) en parallèle
```

> Le mode local exécute les scanners présents dans le `PATH`. Sans eux, l'audit reste
> valide (outils marqués « ignorés ») ; installez Semgrep/Trivy/Gitleaks/OSV + outils npm
> pour une couverture complète. La CI (`audit.yml` / `daily-audit.yml`) les installe.

## 🔍 Audit en ligne de commande (sans serveur)

```bash
pnpm --filter @agentic-hub/audit-engine build
node packages/audit-engine/dist/cli.js scan <dossier> \
  --out result.json --report rapport.md --repo owner/name
```

## 🔁 Mode hybride (GitHub Actions)

Renseigner `AUDIT_WORKFLOW_REPO` (ce repo) + secrets `INGEST_URL`, `INGEST_TOKEN`,
`AUDIT_GITHUB_TOKEN`. L'UI déclenche `audit.yml` via `workflow_dispatch` ; le job exécute
les scanners et POST les findings sur `/api/ingest`. La synthèse Ollama tourne côté API.

## 🧮 Scoring

`score_dimension = 100 − Σ(pénalité_sévérité)` normalisé par la taille du code (baseline LOC).
`score_global = moyenne pondérée` (sécurité 30 %, deps 15 %, qualité 15 %, archi 15 %,
backend 10 %, frontend 8 %, perf 7 %). Pondérations ajustables dans **Réglages**.

## 🚦 Gouvernance & gate CI

- **Politique qualité** : seuils de score / critiques / élevés, globaux (Réglages) ou
  **par repo** (rapport du repo). Chaque audit calcule un **Gate OK/KO**.
- **Gate en CI** : le moteur peut **faire échouer un build** —
  `node packages/audit-engine/dist/cli.js scan <dir> --fail-on-score 80 --fail-on-severity high`
  (sort en code 2 si dépassé).
- **Conventions repo audité** (optionnelles) :
  - `.agentic-hub/semgrep/` → règles Semgrep **custom** ajoutées au scan ;
  - `.agentic-hub/suppress.txt` → `ruleId` à ignorer (1 par ligne, `#` = commentaire).

## 🔁 Monitoring continu

- **Audits planifiés** par repo (quotidien / hebdo) — sélecteur sur le rapport.
- **Notifications** (Réglages) vers un webhook **Slack / Mattermost / Discord** :
  à chaque audit, sur critique/gate KO, ou sur baisse de score.

## 📦 Exports & intégrations

- **Rapport** : Markdown, **PDF** (Chromium), **CSV** des findings.
- **Badge de score** SVG : `…/api/repositories/:id/badge.svg` ou `…/api/badge/:owner/:repo.svg`.
- **Check de PR** : bouton qui ouvre une PR ajoutant un workflow GitHub Actions
  (audit + commentaire + statut bloquant si findings élevés). Nécessite le secret
  `AGENTIC_HUB_TOKEN` (lecture du dépôt moteur).
- **Lighthouse** (perf / a11y / SEO) : opt-in via une URL d'app déployée, par repo.
- **Digest e-mail** hebdomadaire (SMTP) : récap des scores de tous les repos.
- **Recherche globale** des findings + **palette de commandes** (Ctrl/Cmd+K).

## 👥 Multi-utilisateur (RBAC)

- **Connexion GitHub obligatoire** dès que l'OAuth est configuré (sinon mode mono-poste ouvert).
- **Rôles** : `admin` (tout), `member` (audits + remédiation), `viewer` (lecture seule),
  `pending` (en attente d'approbation). Le **1er compte connecté devient admin**.
- **Sessions révocables** (cookie httpOnly) ; un admin peut changer les rôles / désactiver
  un compte (page **Utilisateurs**). Garde-fous : dernier admin protégé, pas d'auto-rétrogradation.
- Réglages : `AUTH_ENABLED`, `AUTH_DEFAULT_ROLE`, `AUTH_COOKIE_SECURE`, `AUTH_SESSION_DAYS`.

## 🔌 Authentification GitHub

Par ordre de priorité : **GitHub App** (token d'installation, quotas élevés —
`GITHUB_APP_*`) › **OAuth** (compte connecté) › **PAT** (`GITHUB_TOKEN`).

## ⚙️ Performance

Les scanners s'exécutent **en parallèle** (pool). Régler `SCAN_CONCURRENCY`
selon l'hôte (plus élevé sur multi-cœurs, plus bas si la machine est contrainte).

## 📄 Licence

MIT — © 2026 ITS-Corentyn
