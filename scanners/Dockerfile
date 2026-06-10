# Image "toolbox" regroupant tous les scanners open-source + le moteur d'audit (audit-engine).
# Utilisée par GitHub Actions (et en fallback local) pour exécuter la suite de scans.
FROM node:20-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_BREAK_SYSTEM_PACKAGES=1 \
    CI=true

# Dépendances système + Semgrep (via pip) + Trivy + Gitleaks + OSV-Scanner
RUN apt-get update && apt-get install -y --no-install-recommends \
      git curl ca-certificates python3 python3-pip jq \
    && pip3 install --no-cache-dir semgrep \
    # Trivy
    && curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh \
        | sh -s -- -b /usr/local/bin \
    # Gitleaks
    && GITLEAKS_VERSION=8.21.2 \
    && curl -sSL "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz" \
        | tar -xz -C /usr/local/bin gitleaks \
    # OSV-Scanner
    && OSV_VERSION=1.9.1 \
    && curl -sSL -o /usr/local/bin/osv-scanner \
        "https://github.com/google/osv-scanner/releases/download/v${OSV_VERSION}/osv-scanner_linux_amd64" \
    && chmod +x /usr/local/bin/osv-scanner \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Outils Node globaux (qualité / architecture)
RUN npm install -g \
      eslint@9 \
      jscpd@4 \
      dependency-cruiser@16 \
      madge@8

WORKDIR /app

# Build du moteur d'audit (audit-engine + shared)
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY packages/audit-engine ./packages/audit-engine
RUN corepack enable \
    && pnpm install --filter @agentic-hub/audit-engine... --prod=false \
    && pnpm --filter @agentic-hub/shared build \
    && pnpm --filter @agentic-hub/audit-engine build

COPY scanners/run-scanners.sh /usr/local/bin/run-scanners
RUN chmod +x /usr/local/bin/run-scanners

ENTRYPOINT ["run-scanners"]
