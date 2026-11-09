# Running LearnHarness in Docker

LearnHarness can be run fully containerized inside Docker using Docker Compose or standard `docker run`.

---

## Quick Start (Production Standalone)

To build and start the standalone container:

```bash
cd /Users/shamit/Documents/learn-harness
docker compose up --build -d
```

Open your browser at **[http://localhost:3000](http://localhost:3000)**.

To check logs:
```bash
docker compose logs -f
```

To stop:
```bash
docker compose down
```

---

## Key Features & Architecture

### 1. Data Persistence
All mutable records (chats, knowledge graph ledgers, user settings, prompt overrides) are stored on your host machine under `./data` and mounted directly into `/app/data` inside the container:
* Volume: `-v ./data:/app/data`
* Volume: `-v ./auth.json:/app/auth.json`

Nothing is lost when the container is restarted or upgraded.

### 2. Transparent Local Model Bridge
When LearnHarness runs inside Docker, standard `127.0.0.1` refers to the container itself, not your host Mac. To make local AI models (such as Docker Model Runner / DMR Schema Proxy or Ollama) work without editing existing configuration files, the container entrypoint automatically bridges loopback ports to `host.docker.internal`:

| Service | Port | Container Loopback Forwarded To |
| :--- | :--- | :--- |
| **DMR Schema Proxy** | `12436` | `host.docker.internal:12436` |
| **Docker Model Runner** | `12434` | `host.docker.internal:12434` |
| **Ollama** | `11434` | `host.docker.internal:11434` |

This means your existing `auth.json` and `settings.json` configured for `http://127.0.0.1:12436/v1` will work **unmodified** both inside Docker and on the host!

---

## Customizing the Port

If port `3000` is already in use by another application on your host, specify a custom port with `LH_PORT`:

```bash
LH_PORT=3005 docker compose up -d
```
Then visit `http://localhost:3005`.

---

## Live Development Mode (Hot Reloading)

If you are developing or modifying the LearnHarness codebase and want live code reloading inside Docker:

```bash
docker compose --profile dev up --build learnharness-dev
```

This mounts the entire source repository into the container with hot module replacement (Turbopack) active.
