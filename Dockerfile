FROM node:22-bookworm-slim AS browser-build

WORKDIR /build

COPY package*.json ./
RUN npm ci --ignore-scripts

COPY public/display/sendspin-entry.js ./public/display/sendspin-entry.js
RUN npx --no-install esbuild public/display/sendspin-entry.js --bundle --format=esm --target=es2022 --outfile=public/display/sendspin.bundle.js

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
RUN npm ci --omit=dev --ignore-scripts \
 && rm -rf /usr/local/lib/node_modules/npm \
 && rm -f /usr/local/bin/npm /usr/local/bin/npx

COPY VERSION ./VERSION
COPY src ./src
COPY config ./config
COPY public ./public
COPY --from=browser-build /build/public/display/sendspin.bundle.js ./public/display/sendspin.bundle.js
COPY tools/prepare-display-fonts.sh ./tools/prepare-display-fonts.sh
COPY tools/verify-image-permissions.js ./tools/verify-image-permissions.js
RUN bash tools/prepare-display-fonts.sh

# Stamp independently loaded client/runtime surfaces from the single release
# VERSION file. This prevents backend/display/controller/agent drift when a new
# alpha is cut and keeps version convergence mechanically testable.
RUN RELEASE_VERSION="$(cat VERSION)" \
 && sed -i -E "s/[0-9]+\.[0-9]+\.[0-9]+-alpha\.[0-9]+/${RELEASE_VERSION}/g" \
      public/controller/app.js \
      public/controller/index.html \
      public/controller/display.html \
      public/display/index.html \
      public/lab-agent/ClassroomHubAgent.ps1

# Local Docker contexts retain file modes. A root-edited 0600 server.js must not
# produce an image that only root can start. Normalize packaged, non-secret
# application files inside the image only; never chmod host data or secrets.
RUN chmod 0755 /app \
 && find /app/src /app/public /app/config /app/tools -type d -exec chmod 0755 {} + \
 && find /app/src /app/public /app/config /app/tools -type f -exec chmod 0644 {} + \
 && chmod 0644 /app/VERSION /app/package.json /app/package-lock.json

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
# Fail the build, rather than the deployed container, on unreadable source/assets.
RUN node tools/verify-image-permissions.js && node --check src/server.js
CMD ["node", "--require", "./src/direct-display-compat.js", "src/startup-recovery.js"]
