FROM node:24-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# next.config.ts is evaluated at BUILD time, and NEXT_PUBLIC_* values are inlined into the client
# bundle then too — the runtime env_file is far too late for either. The CSP connect-src for the
# party-play WebSocket is derived from this, so without it the build silently bakes the localhost
# fallback and the socket is blocked in the browser at runtime with nothing visible server-side.
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
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
