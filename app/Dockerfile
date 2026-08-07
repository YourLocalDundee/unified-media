FROM node:24-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      intel-media-va-driver \
    && rm -rf /var/lib/apt/lists/*

# iHD is the Intel Media Driver backend (Gen12 / Alder Lake and newer, including N100).
# Without this env var libva probes all drivers and may silently fail on a headless container.
ENV LIBVA_DRIVER_NAME=iHD

RUN groupadd --system --gid 1001 nodejs && \
    useradd --uid 1001 --gid nodejs nextjs && \
    mkdir -p /data /transcode && \
    chown nextjs:nodejs /data /transcode

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

VOLUME ["/data", "/transcode"]

USER nextjs
EXPOSE 3001
ENV PORT=3001
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
