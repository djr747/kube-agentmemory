# Build and runtime share Google's Debian 13 Node image family.
# BusyBox and the checksum-verified npm bootstrap exist only in this build stage.
FROM gcr.io/distroless/nodejs22-debian13:debug AS dependencies
USER 0
ENV PATH=/nodejs/bin:/busybox:/usr/bin NPM_CONFIG_SCRIPT_SHELL=/busybox/sh
SHELL ["/busybox/sh", "-c"]
WORKDIR /app
COPY package.json package-lock.json ./
COPY build/bootstrap-npm.mjs /build/bootstrap-npm.mjs
COPY build/npm/package.json build/npm/package-lock.json /build/npm/
RUN ["/nodejs/bin/node", "/build/bootstrap-npm.mjs"]
# Local embeddings require optional native ONNX dependencies and their install scripts.
RUN node /opt/npm/bin/npm-cli.js ci --omit=dev --include=optional --no-fund --no-audit \
    && node -e "import('@huggingface/transformers').catch(() => { process.exit(1); })" \
    && node /opt/npm/bin/npm-cli.js cache clean --force \
    && mkdir -p /data

FROM gcr.io/distroless/nodejs22-debian13:nonroot AS runtime
ENV NODE_ENV=production HOME=/data/home PATH=/nodejs/bin:/usr/bin \
    AGENTMEMORY_DATA_DIR=/data \
    HF_HOME=/data/models \
    XDG_CACHE_HOME=/data/cache \
    AGENTMEMORY_EXPORT_ROOT=/data/exports \
    SNAPSHOT_DIR=/data/snapshots \
    STANDALONE_PERSIST_PATH=/data/local.db \
    III_ENGINE_URL=ws://127.0.0.1:49134 \
    AGENTMEMORY_URL=http://127.0.0.1:3111 \
    III_REST_PORT=3111 III_STREAM_PORT=3112 III_VIEWER_PORT=3113 \
    III_TELEMETRY_ENABLED=false
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY runtime ./runtime
COPY tests/smoke.mjs ./tests/smoke.mjs
COPY --from=dependencies --chown=65532:65532 /data /data
USER 65532:65532
ENTRYPOINT ["/nodejs/bin/node", "/app/runtime/entrypoint.mjs"]
