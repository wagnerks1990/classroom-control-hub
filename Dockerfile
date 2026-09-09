FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      libreoffice-core \
      libreoffice-writer \
      libreoffice-impress \
      fonts-dejavu-core \
      fonts-liberation \
      poppler-utils \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY VERSION ./VERSION
COPY src ./src
COPY config ./config
COPY public ./public
COPY tools/prepare-display-fonts.sh ./tools/prepare-display-fonts.sh
RUN bash tools/prepare-display-fonts.sh

# Stamp independently loaded client/runtime surfaces from the single release
# VERSION file. This prevents backend/display/controller/agent drift when a new
# alpha is cut and keeps version convergence mechanically testable.
RUN RELEASE_VERSION="$(cat VERSION)" \
 && sed -i -E "s/[0-9]+\.[0-9]+\.[0-9]+-alpha\.[0-9]+/${RELEASE_VERSION}/g" \
      public/controller/app.js \
      public/display/index.html \
      public/lab-agent/ClassroomHubAgent.ps1

RUN npx esbuild public/display/sendspin-entry.js --bundle --format=esm --target=es2022 --outfile=public/display/sendspin.bundle.js

RUN groupadd --gid 10001 classroom-hub \
 && useradd --uid 10001 --gid 10001 --home-dir /tmp/classroom-hub --no-create-home --shell /usr/sbin/nologin classroom-hub \
 && mkdir -p /app/data/media /app/data/convert-tmp /app/data/presentations /app/data/presentation-upload-tmp /tmp/classroom-hub \
 && chown -R 10001:10001 /app/data /tmp/classroom-hub

ENV NODE_ENV=production
ENV HOME=/tmp/classroom-hub
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch(require('./src/network').localHttpUrl(process.env.PORT||3000,process.env.BIND_ADDRESS)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

USER 10001:10001
CMD ["node", "--require", "./src/direct-display-compat.js", "src/startup-recovery.js"]
