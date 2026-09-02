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
RUN npm install --omit=dev

COPY src ./src
COPY config ./config
COPY public ./public

RUN npx esbuild public/display/sendspin-entry.js --bundle --format=esm --target=es2022 --outfile=public/display/sendspin.bundle.js

RUN mkdir -p /app/data/media /app/data/convert-tmp /app/data/presentations /app/data/presentation-upload-tmp

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "src/server.js"]
