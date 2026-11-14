#!/bin/sh
set -e

# Route custom-provider loopback URLs to the host at request time. An explicitly
# empty LH_DOCKER_HOST disables this when the backend runs in the same container.
if [ "${LH_DOCKER_HOST+x}" != "x" ]; then
    LH_DOCKER_HOST=host.docker.internal
fi
export LH_DOCKER_HOST

# Ensure data directories exist
DATA_DIR="${LH_DATA_DIR:-/app/data}"
mkdir -p "$DATA_DIR/chats" "$DATA_DIR/graph" "$DATA_DIR/debug"

# Ensure auth file exists if mounted or specified
AUTH_FILE="${LH_AUTH_FILE:-/app/auth.json}"
if [ ! -f "$AUTH_FILE" ]; then
    echo "{}" > "$AUTH_FILE"
fi

# Ensure Downloads symlink for ~ compatibility
if [ -n "${HOME:-}" ] && [ -d "${HOME}/Downloads" ] && [ ! -e /root/Downloads ]; then
    ln -s "${HOME}/Downloads" /root/Downloads 2>/dev/null || true
fi

echo "[docker-entrypoint] Starting LearnHarness on ${HOSTNAME:-0.0.0.0}:${PORT:-3000} (LH_DATA_DIR=$DATA_DIR)..."
exec "$@"
