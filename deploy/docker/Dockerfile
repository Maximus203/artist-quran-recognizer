# Image de l'atelier SEUL (sans moteur Python, sans GPU), pour Alpha derrière Traefik.
# Construire depuis la racine du dépôt :  docker build -f deploy/docker/Dockerfile -t atelier:<sha> .
# NODE_VERSION : une ligne corrigée de CVE-2026-111497 (24.22.2 ou plus). Vérifier que le tag existe à la
# construction ; l'hôte, lui, a Node 22.22.1 (touché) : c'est l'image qui apporte le bon Node.
ARG NODE_VERSION=24.22.2

FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build && npm prune --omit=dev

FROM node:${NODE_VERSION}-bookworm-slim
# ffmpeg/ffprobe : sondage des envois et photos de profil. Pas de Chromium : l'export vidéo n'est pas servi ici.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    AQR_REVIEW_DIR=/data \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app/web
COPY --from=build --chown=node:node /app/web ./
COPY --chown=node:node docs /app/docs
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"
# Écoute sur toutes les interfaces DU CONTENEUR ; seul Traefik, sur le réseau « web », l'atteint.
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0", "--port", "3000"]
