# syntax=docker/dockerfile:1

# ==============================================================================
# LearnHarness Production Dockerfile
#
# Packages the curated standalone Next.js server payload (.next/standalone)
# produced by `npm run build && node scripts/build-server.mjs`.
#
# Why this architecture?
# Running Turbopack compilation inside a virtualized Linux Docker VM on macOS
# causes severe VirtioFS I/O thread contention across 18 virtual cores and
# pegs the Mac CPU at 100%. Building natively on host APFS SSD takes 5 seconds,
# and this image then packages and starts the container in under 8 seconds.
# ==============================================================================

FROM node:22-bookworm-slim
WORKDIR /app

# Install lightweight bridge and healthcheck utilities
RUN apt-get update && apt-get install -y --no-install-recommends \
    socat \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV LH_DATA_DIR=/app/data
ENV LH_AUTH_FILE=/app/auth.json
ENV ENABLE_HOST_BRIDGE=1

# Copy curated standalone server distribution and static assets
COPY .next/standalone ./
COPY .next/static ./.next/static
COPY public ./public
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

VOLUME ["/app/data"]

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://127.0.0.1:3000/api/graph/status || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "server.js"]
