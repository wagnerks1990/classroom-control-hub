FROM eclipse-temurin:17-jdk-jammy AS android-agent-build

ARG ANDROID_COMMANDLINE_TOOLS=11076708
ARG GRADLE_VERSION=8.9
ARG GRADLE_SHA256=d725d707bfabd4dfdc958c624003b3c80accc03f7037b5122c4b1d0ef15cecab
ENV ANDROID_HOME=/opt/android-sdk
ENV ANDROID_SDK_ROOT=/opt/android-sdk
# The release APK includes native ADB/Conscrypt libraries and Android's zipflinger
# can exceed Gradle's small default heap during :app:packageRelease. Keep the
# build deterministic on GitHub-hosted runners by giving the single-use Gradle
# JVM enough heap while limiting worker concurrency so total memory stays bounded.
ENV GRADLE_OPTS="-Dorg.gradle.jvmargs=-Xmx3072m\ -XX:MaxMetaspaceSize=512m\ -Dfile.encoding=UTF-8 -Dorg.gradle.workers.max=2"

RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends curl unzip ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /opt/android-sdk/cmdline-tools \
 && curl -fsSL "https://dl.google.com/android/repository/commandlinetools-linux-${ANDROID_COMMANDLINE_TOOLS}_latest.zip" -o /tmp/android-tools.zip \
 && unzip -q /tmp/android-tools.zip -d /opt/android-sdk/cmdline-tools \
 && mv /opt/android-sdk/cmdline-tools/cmdline-tools /opt/android-sdk/cmdline-tools/latest \
 && rm /tmp/android-tools.zip \
 && (yes | /opt/android-sdk/cmdline-tools/latest/bin/sdkmanager --licenses >/dev/null || true) \
 && /opt/android-sdk/cmdline-tools/latest/bin/sdkmanager 'platforms;android-35' 'build-tools;35.0.0' 'platform-tools' \
 && curl -fsSL "https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip" -o /tmp/gradle.zip \
 && echo "${GRADLE_SHA256}  /tmp/gradle.zip" | sha256sum -c - \
 && unzip -q /tmp/gradle.zip -d /opt \
 && ln -s "/opt/gradle-${GRADLE_VERSION}" /opt/gradle \
 && rm /tmp/gradle.zip
ENV PATH=/opt/gradle/bin:/opt/android-sdk/build-tools/35.0.0:/opt/android-sdk/cmdline-tools/latest/bin:$PATH
WORKDIR /android-agent
COPY agents/android-tv ./
RUN gradle :app:assembleRelease --no-daemon --stacktrace --max-workers=2 \
 && test -s app/build/outputs/apk/release/app-release-unsigned.apk \
 && BADGING="$(aapt dump badging app/build/outputs/apk/release/app-release-unsigned.apk | head -n1)" \
 && printf '%s\n' "$BADGING" | grep -Fq "package: name='org.roomgoblin.display'" \
 && VERSION_NAME="$(sed -n 's/.*versionName = "\([^"]*\)".*/\1/p' app/build.gradle.kts | head -n1)" \
 && VERSION_CODE="$(sed -n 's/.*versionCode = \([0-9][0-9]*\).*/\1/p' app/build.gradle.kts | head -n1)" \
 && test -n "$VERSION_NAME" -a -n "$VERSION_CODE" \
 && printf '%s\n' "$BADGING" | grep -Fq "versionCode='$VERSION_CODE'" \
 && printf '%s\n' "$BADGING" | grep -Fq "versionName='$VERSION_NAME'" \
 && SHA="$(sha256sum app/build/outputs/apk/release/app-release-unsigned.apk | awk '{print $1}')" \
 && printf '{"package":"org.roomgoblin.display","versionName":"%s","versionCode":%s,"unsignedSha256":"%s"}\n' "$VERSION_NAME" "$VERSION_CODE" "$SHA" > /android-agent/agent-build.json

FROM node:22-bookworm-slim

ARG TARGETARCH
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      bash ca-certificates curl zip unzip procps iproute2 dnsutils \
      iputils-ping jq coreutils util-linux sqlite3 adb openssl openjdk-17-jre-headless && \
    rm -rf /var/lib/apt/lists/* && \
    if [ "${TARGETARCH:-amd64}" = "amd64" ]; then \
      curl -fsSLo /tmp/platform-tools.zip https://dl.google.com/android/repository/platform-tools-latest-linux.zip && \
      mkdir -p /opt/android-sdk && \
      unzip -q -o /tmp/platform-tools.zip -d /opt/android-sdk && \
      ln -sf /opt/android-sdk/platform-tools/adb /usr/local/bin/adb && \
      rm -f /tmp/platform-tools.zip && \
      adb version && adb help 2>&1 | grep -q "pair HOST"; \
    fi
COPY --from=android-agent-build /opt/android-sdk/build-tools/35.0.0 /opt/android-build-tools
ENV PATH=/opt/android-build-tools:$PATH
RUN apksigner --version && keytool -help >/dev/null
WORKDIR /app
COPY maintenance-agent/package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY maintenance-agent/server.js ./
COPY maintenance-agent/extensions.js ./
COPY maintenance-agent/network.js ./
COPY maintenance-agent/backup-policy.js ./
COPY maintenance-agent/recovery-envelope.js ./
COPY maintenance-agent/android-tv-lib.js ./
COPY maintenance-agent/android-tv-extension.js ./
COPY maintenance-agent/android-tv-persistent-adb.js ./
COPY maintenance-agent/android-tv-agent-v2.js ./
COPY maintenance-agent/android-tv-agent-artifact.js ./
COPY --from=android-agent-build /android-agent/app/build/outputs/apk/release/app-release-unsigned.apk /app/android-agent/agent-release-unsigned.apk
COPY --from=android-agent-build /android-agent/agent-build.json /app/android-agent/agent-build.json
# server.js remains the audited recovery implementation. Stamp its embedded
# diagnostic/health version from package metadata at image build time so the
# wrapper can evolve without duplicating that large file.
RUN RELEASE_VERSION="$(node -p "require('./package.json').version")" \
 && sed -i -E "s/[0-9]+\.[0-9]+\.[0-9]+-alpha\.[0-9]+/${RELEASE_VERSION}/g" server.js
RUN mkdir -p /work/uploads /managed/classroom-hub/data/android-tv /app/android-agent \
 && chmod 0644 /app/android-agent/agent-release-unsigned.apk /app/android-agent/agent-build.json
ENV PORT=3010
ENV ANDROID_TV_DATA_ROOT=/managed/classroom-hub/data/android-tv
ENV ANDROID_AGENT_BUNDLE_APK=/app/android-agent/agent-release-unsigned.apk
ENV ANDROID_AGENT_BUNDLE_META=/app/android-agent/agent-build.json
ENV ANDROID_AGENT_SIGNING_ROOT=/signing
ENV VEYON_RECOVERY_ROOT=/veyon-recovery
ENV HOME=/managed/classroom-hub/data/android-tv
ENV ANDROID_USER_HOME=/managed/classroom-hub/data/android-tv
ENV NODE_OPTIONS=--require=/app/extensions.js\ --require=/app/android-tv-extension.js\ --require=/app/android-tv-persistent-adb.js\ --require=/app/android-tv-agent-v2.js\ --require=/app/android-tv-agent-artifact.js
EXPOSE 3010
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/ready',{headers:{'x-maintenance-token':process.env.MAINTENANCE_TOKEN}}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node","server.js"]
