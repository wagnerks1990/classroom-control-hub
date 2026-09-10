FROM eclipse-temurin:17-jdk-jammy AS android-agent-builder

ARG ANDROID_COMMANDLINE_TOOLS=11076708
ARG GRADLE_VERSION=8.9
ENV ANDROID_HOME=/opt/android-sdk
ENV ANDROID_SDK_ROOT=/opt/android-sdk

RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends curl unzip ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /opt/android-sdk/cmdline-tools \
 && curl -fsSL "https://dl.google.com/android/repository/commandlinetools-linux-${ANDROID_COMMANDLINE_TOOLS}_latest.zip" -o /tmp/android-tools.zip \
 && unzip -q /tmp/android-tools.zip -d /opt/android-sdk/cmdline-tools \
 && mv /opt/android-sdk/cmdline-tools/cmdline-tools /opt/android-sdk/cmdline-tools/latest \
 && rm /tmp/android-tools.zip \
 && yes | /opt/android-sdk/cmdline-tools/latest/bin/sdkmanager --licenses >/dev/null || true \
 && /opt/android-sdk/cmdline-tools/latest/bin/sdkmanager 'platforms;android-35' 'build-tools;35.0.0' 'platform-tools' \
 && curl -fsSL "https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip" -o /tmp/gradle.zip \
 && unzip -q /tmp/gradle.zip -d /opt \
 && ln -s "/opt/gradle-${GRADLE_VERSION}" /opt/gradle \
 && rm /tmp/gradle.zip
ENV PATH=/opt/gradle/bin:/opt/android-sdk/platform-tools:/opt/android-sdk/build-tools/35.0.0:/opt/android-sdk/cmdline-tools/latest/bin:$PATH
WORKDIR /android-agent
COPY agents/android-tv ./
RUN gradle :app:assembleDebug --no-daemon --stacktrace \
 && test -s app/build/outputs/apk/debug/app-debug.apk \
 && aapt dump badging app/build/outputs/apk/debug/app-debug.apk | grep -q "package: name='org.classroomhub.display'" \
 && VERSION_NAME="$(sed -n 's/.*versionName = "\([^"]*\)".*/\1/p' app/build.gradle.kts | head -n1)" \
 && VERSION_CODE="$(sed -n 's/.*versionCode = \([0-9][0-9]*\).*/\1/p' app/build.gradle.kts | head -n1)" \
 && test -n "$VERSION_NAME" -a -n "$VERSION_CODE" \
 && aapt dump badging app/build/outputs/apk/debug/app-debug.apk | head -n1 | grep -Fq "versionCode='$VERSION_CODE'" \
 && aapt dump badging app/build/outputs/apk/debug/app-debug.apk | head -n1 | grep -Fq "versionName='$VERSION_NAME'" \
 && SHA="$(sha256sum app/build/outputs/apk/debug/app-debug.apk | awk '{print $1}')" \
 && printf '{"package":"org.classroomhub.display","versionName":"%s","versionCode":%s,"sha256":"%s","signingMode":"ephemeral-debug-build"}\n' "$VERSION_NAME" "$VERSION_CODE" "$SHA" > /android-agent/ClassroomHub-Display-Agent.json

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
COPY tools/verify-image-permissions.js ./tools/verify-image-permissions.js
COPY --from=android-agent-builder /android-agent/app/build/outputs/apk/debug/app-debug.apk /app/bundled/ClassroomHub-Display-Agent.apk
COPY --from=android-agent-builder /android-agent/ClassroomHub-Display-Agent.json /app/bundled/ClassroomHub-Display-Agent.json
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

RUN npx esbuild public/display/sendspin-entry.js --bundle --format=esm --target=es2022 --outfile=public/display/sendspin.bundle.js

# Local Docker contexts retain file modes. A root-edited 0600 server.js must not
# produce an image that only root can start. Normalize packaged, non-secret
# application files inside the image only; never chmod host data or secrets.
RUN chmod 0755 /app /app/bundled \
 && find /app/src /app/public /app/config /app/tools -type d -exec chmod 0755 {} + \
 && find /app/src /app/public /app/config /app/tools -type f -exec chmod 0644 {} + \
 && chmod 0644 /app/VERSION /app/package.json /app/package-lock.json /app/bundled/ClassroomHub-Display-Agent.apk /app/bundled/ClassroomHub-Display-Agent.json

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
