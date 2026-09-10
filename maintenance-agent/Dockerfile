FROM node:22-bookworm-slim

ARG TARGETARCH
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      bash ca-certificates curl zip unzip procps iproute2 dnsutils \
      iputils-ping jq coreutils util-linux sqlite3 adb && \
    rm -rf /var/lib/apt/lists/* && \
    if [ "${TARGETARCH:-amd64}" = "amd64" ]; then \
      curl -fsSLo /tmp/platform-tools.zip https://dl.google.com/android/repository/platform-tools-latest-linux.zip && \
      mkdir -p /opt/android-sdk && \
      unzip -q -o /tmp/platform-tools.zip -d /opt/android-sdk && \
      ln -sf /opt/android-sdk/platform-tools/adb /usr/local/bin/adb && \
      rm -f /tmp/platform-tools.zip && \
      adb version && adb help 2>&1 | grep -q "pair HOST"; \
    fi
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY server.js ./
COPY extensions.js ./
COPY network.js ./
COPY android-tv-lib.js ./
COPY android-tv-extension.js ./
COPY android-tv-persistent-adb.js ./
COPY android-tv-agent-v2.js ./
# server.js remains the audited recovery implementation. Stamp its embedded
# diagnostic/health version from package metadata at image build time so the
# wrapper can evolve without duplicating that large file.
RUN RELEASE_VERSION="$(node -p "require('./package.json').version")" \
 && sed -i -E "s/[0-9]+\.[0-9]+\.[0-9]+-alpha\.[0-9]+/${RELEASE_VERSION}/g" server.js
RUN mkdir -p /work/uploads /managed/classroom-hub/data/android-tv
ENV PORT=3010
ENV ANDROID_TV_DATA_ROOT=/managed/classroom-hub/data/android-tv
ENV HOME=/managed/classroom-hub/data/android-tv
ENV ANDROID_USER_HOME=/managed/classroom-hub/data/android-tv
ENV NODE_OPTIONS=--require=/app/extensions.js\ --require=/app/android-tv-extension.js\ --require=/app/android-tv-persistent-adb.js\ --require=/app/android-tv-agent-v2.js
EXPOSE 3010
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/ready',{headers:{'x-maintenance-token':process.env.MAINTENANCE_TOKEN}}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node","server.js"]
