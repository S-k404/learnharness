# Running LearnHarness in Docker

LearnHarness can be run fully containerized inside Docker using Docker Compose or standard `docker run`.

---

## Quick Start (Production Standalone)

To build and start the standalone container:

```bash
cd ~/Documents/learn-harness
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

Docker Desktop can block direct mounts from macOS `Downloads`. To make selected files available without granting Docker access to the whole folder, copy them into the ignored `./learner-files` directory in this repository. Compose mounts that staging directory read-only at `~/Downloads` inside the container, so existing paths such as `~/Downloads/report.pdf` resolve. Original files remain untouched. Other host folders are not mounted; add a read-only bind mount for a specific folder if needed, and add its container-visible path under **Settings → Agent → Tools → File access** when access is restricted.

### 2. Local Model Endpoints
When LearnHarness runs inside Docker, `localhost`, `127.0.0.1`, and `::1` refer to the container. For custom model endpoints, LearnHarness keeps the configured URL in settings and routes loopback URLs to `host.docker.internal` for both model discovery and inference. This works with any endpoint port, including Ollama, LM Studio, and Docker Model Runner.

Use the same complete API base URL you use on the host, such as `http://127.0.0.1:1234/v1` or `http://localhost:11434/v1`. Docker Compose configures the host alias. On Linux with a direct `docker run`, add `--add-host=host.docker.internal:host-gateway`. Set `LH_DOCKER_HOST` to a different hostname to override the target, or set it to an empty value when the model server runs inside the LearnHarness container.

The model server must accept connections from Docker. If it only listens on the host's loopback interface and the host's Docker networking cannot reach it, configure the server to listen on a host interface and allow its port through the host firewall.

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
