#!/bin/sh
set -e

# Transparent host bridge for local AI backends:
# If ENABLE_HOST_BRIDGE is enabled (default: 1), background socat forwarders
# redirect loopback calls inside container (127.0.0.1:PORT) to the host machine
# (host.docker.internal:PORT). This ensures configs pointing to 127.0.0.1 (such
# as DMR Schema Proxy on 12436, DMR direct on 12434, or Ollama on 11434) work
# seamlessly inside Docker without having to reconfigure auth.json or settings.json.
if [ "${ENABLE_HOST_BRIDGE:-1}" = "1" ]; then
    echo "[docker-entrypoint] Initializing transparent host bridges to host.docker.internal..."
    
    # DMR Schema Proxy
    socat TCP-LISTEN:12436,fork,reuseaddr,bind=127.0.0.1 TCP:host.docker.internal:12436 2>/dev/null &
    
    # DMR Direct
    socat TCP-LISTEN:12434,fork,reuseaddr,bind=127.0.0.1 TCP:host.docker.internal:12434 2>/dev/null &
    
    # Ollama
    socat TCP-LISTEN:11434,fork,reuseaddr,bind=127.0.0.1 TCP:host.docker.internal:11434 2>/dev/null &
fi

# Ensure data directories exist
DATA_DIR="${LH_DATA_DIR:-/app/data}"
mkdir -p "$DATA_DIR/chats" "$DATA_DIR/graph" "$DATA_DIR/debug"

# Ensure auth file exists if mounted or specified
AUTH_FILE="${LH_AUTH_FILE:-/app/auth.json}"
if [ ! -f "$AUTH_FILE" ]; then
    echo "{}" > "$AUTH_FILE"
fi

echo "[docker-entrypoint] Starting LearnHarness on ${HOSTNAME:-0.0.0.0}:${PORT:-3000} (LH_DATA_DIR=$DATA_DIR)..."
exec "$@"
