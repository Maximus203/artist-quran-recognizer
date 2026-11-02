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
# ffmpeg/ffprobe : sondage des envois et photos de profil.
# python3 + pyyaml : le cœur du moteur (corpus, sous-titres, contrôle « prêt à exporter ? »), sans modèle
# ni torch ; les analyses, elles, tournent sur les agents.
# Google Chrome stable : rendu des exports vidéo sur le serveur (sans interface). Le Chromium de Debian n'a
# pas le codec H.264 qu'exige l'encodeur du rendu : on prend celui de Google.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates python3 python3-yaml wget gnupg \
    && wget -qO- https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update && apt-get install -y --no-install-recommends google-chrome-stable fonts-noto-core \
    && rm -rf /var/lib/apt/lists/* /etc/apt/sources.list.d/google-chrome.list
ENV NODE_ENV=production \
    AQR_PYTHON=python3 \
    AQR_CHROME=/usr/bin/google-chrome-stable \
    AQR_CACHE_DIR=/data/cache \
    AQR_REVIEW_DIR=/data \
    AQR_SERVER_HOST=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app/web
COPY --from=build --chown=node:node /app/web ./
COPY --chown=node:node docs /app/docs
COPY --chown=node:node src /app/src
COPY --chown=node:node scripts/fetch_corpus.py /app/scripts/fetch_corpus.py
COPY --chown=node:node data/corpus/LOCK.json /app/data/corpus/LOCK.json
COPY --chown=node:node data/translation-segments /app/data/translation-segments
RUN mkdir -p /data && chown node:node /data
USER node
# Corpus Tanzil téléchargé à la construction et vérifié par LOCK.json (jamais copié dans Git).
RUN cd /app && PYTHONPATH=src python3 scripts/fetch_corpus.py --out data/corpus
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"
# Écoute sur toutes les interfaces DU CONTENEUR ; seul Traefik, sur le réseau « web », l'atteint.
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0", "--port", "3000"]
