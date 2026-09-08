FROM node:22-bookworm-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      bash ca-certificates curl zip unzip procps iproute2 dnsutils \
      iputils-ping jq coreutils util-linux sqlite3 && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY server.js ./
COPY extensions.js ./
RUN mkdir -p /work/uploads
ENV PORT=3010
ENV NODE_OPTIONS=--require=/app/extensions.js
EXPOSE 3010
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3010/ready',{headers:{'x-maintenance-token':process.env.MAINTENANCE_TOKEN}}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node","server.js"]
