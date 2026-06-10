# Build du frontend Vue puis service statique via nginx.
FROM node:20-bookworm-slim AS builder
ENV CI=true
WORKDIR /app
RUN corepack enable

# VITE_API_BASE est injecté au build (URL publique de l'API, ex: http://localhost:3000)
ARG VITE_API_BASE=http://localhost:3000
ENV VITE_API_BASE=$VITE_API_BASE

COPY package.json pnpm-workspace.yaml ./
COPY apps/web ./apps/web
RUN pnpm install --filter @agentic-hub/web... --frozen-lockfile=false \
    && pnpm --filter @agentic-hub/web build

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
