FROM eclipse-temurin:17-jdk-jammy

ARG ANDROID_COMMANDLINE_TOOLS=11076708
ARG GRADLE_VERSION=8.9
ENV ANDROID_HOME=/opt/android-sdk
ENV ANDROID_SDK_ROOT=/opt/android-sdk

RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends curl unzip ca-certificates openssl python3 \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /opt/android-sdk/cmdline-tools \
 && curl -fsSL "https://dl.google.com/android/repository/commandlinetools-linux-${ANDROID_COMMANDLINE_TOOLS}_latest.zip" -o /tmp/android-tools.zip \
 && unzip -q /tmp/android-tools.zip -d /opt/android-sdk/cmdline-tools \
 && mv /opt/android-sdk/cmdline-tools/cmdline-tools /opt/android-sdk/cmdline-tools/latest \
 && rm /tmp/android-tools.zip \
 && (yes | /opt/android-sdk/cmdline-tools/latest/bin/sdkmanager --licenses >/dev/null || true) \
 && /opt/android-sdk/cmdline-tools/latest/bin/sdkmanager 'platforms;android-35' 'build-tools;35.0.0' 'platform-tools' \
 && curl -fsSL "https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip" -o /tmp/gradle.zip \
 && unzip -q /tmp/gradle.zip -d /opt \
 && ln -s "/opt/gradle-${GRADLE_VERSION}" /opt/gradle \
 && rm /tmp/gradle.zip

ENV PATH=/opt/gradle/bin:/opt/android-sdk/platform-tools:/opt/android-sdk/build-tools/35.0.0:/opt/android-sdk/cmdline-tools/latest/bin:$PATH
COPY stage-current.sh /usr/local/bin/stage-current-android-agent
RUN chmod 0755 /usr/local/bin/stage-current-android-agent
WORKDIR /workspace/agents/android-tv
CMD ["/usr/local/bin/stage-current-android-agent"]
