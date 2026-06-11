# API Agentic-Hub — inclut git + tous les scanners open-source afin que le mode
# local (clone + scan) fonctionne directement via docker-compose, sans GitHub Actions.
FROM node:20-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_BREAK_SYSTEM_PACKAGES=1 \
    NODE_ENV=production \
    CI=true

# Scanners système : git, semgrep, trivy, gitleaks, osv-scanner + chromium (PDF/Lighthouse)
RUN apt-get update && apt-get install -y --no-install-recommends \
      git curl ca-certificates python3 python3-pip jq chromium \
    && pip3 install --no-cache-dir semgrep \
    && curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh -s -- -b /usr/local/bin \
    && GITLEAKS_VERSION=8.21.2 \
    && curl -sSL "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz" | tar -xz -C /usr/local/bin gitleaks \
    && OSV_VERSION=1.9.1 \
    && curl -sSL -o /usr/local/bin/osv-scanner "https://github.com/google/osv-scanner/releases/download/v${OSV_VERSION}/osv-scanner_linux_amd64" \
    && chmod +x /usr/local/bin/osv-scanner \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

ENV CHROME_PATH=/usr/bin/chromium

# Outils Node globaux (qualité / architecture / dépendances)
RUN npm install -g jscpd@4 dependency-cruiser@16 madge@8 depcheck@1 ts-prune@0.10 lighthouse@12

# Toolbox ESLint autonome (TS/Vue) : lint fiable sans dependre du repo cible.
COPY scanners/eslint /opt/eslint-audit
RUN cd /opt/eslint-audit && npm install --omit=dev --no-audit --no-fund
ENV ESLINT_BIN=/opt/eslint-audit/node_modules/.bin/eslint \
    ESLINT_CONFIG=/opt/eslint-audit/eslint.config.mjs

# Pré-cache des rulesets Semgrep pour un scan fiable hors-ligne au runtime.
ENV SEMGREP_CONFIGS=p/security-audit,p/secrets,p/owasp-top-ten
RUN mkdir -p /tmp/warm && printf 'import os\nx = eval("1")\n' > /tmp/warm/x.py \
    && semgrep scan --quiet --metrics=off --disable-version-check \
         --config p/security-audit --config p/secrets --config p/owasp-top-ten /tmp/warm \
       > /dev/null 2>&1 || true \
    && rm -rf /tmp/warm

WORKDIR /app
RUN corepack enable

# Installe les dépendances (monorepo) puis build
COPY . .
RUN pnpm install --frozen-lockfile=false \
    && pnpm --filter @agentic-hub/db build \
    && pnpm --filter @agentic-hub/shared build \
    && pnpm --filter @agentic-hub/audit-engine build \
    && pnpm --filter @agentic-hub/api build

EXPOSE 3000

# Applique les migrations puis démarre l'API.
CMD ["sh", "-c", "pnpm --filter @agentic-hub/db migrate && node apps/api/dist/server.js"]
