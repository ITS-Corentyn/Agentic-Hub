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

## 🚀 Démarrage rapide (Docker)

```bash
cp .env.example .env        # renseigner GITHUB_TOKEN / GITHUB_OWNER si besoin
docker compose -f infra/docker-compose.yml up -d --build
# Récupérer le modèle Ollama (1re fois) :
docker compose -f infra/docker-compose.yml exec ollama ollama pull qwen2.5-coder:7b
```

- Web : http://localhost:8080
- API : http://localhost:3000 (`/api/health`)

En **mode local** (sans `AUDIT_WORKFLOW_REPO`), l'API clone et scanne directement les repos
(l'image API embarque tous les scanners). Renseigner `GITHUB_TOKEN` + `GITHUB_OWNER`,
cliquer **« Synchroniser GitHub »**, puis **« Auditer »** sur un repo.

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

## 📄 Licence

MIT — © 2026 ITS-Corentyn
