# radioassist.open-rag.ai

Demo front end for an OpenRAG instance, designed to be embedded as a hosted
URL inside the Radio Assist Windows application (WebView).

- Streamed answers, simplified chat UX, no login.
- Source documents (PDF / audio / video / image) with an inline player; audio
  gets a waveform strip.
- A partition listbox selects the OpenRAG knowledge base (model `openrag-<partition>`).
- Slash command-palette to save / recall / delete demo prompts (`/`, `/+`, `/--`).

## Architecture

```
Browser (React SPA) ── /api ──► Node/Express proxy ──► OpenRAG /v1
                                 (holds OPENRAG_API_TOKEN, binds 127.0.0.1)
```

The API token lives only in the backend `.env` and is **never** sent to the
browser. The proxy also fetches source files (which require the token as a query
param) and streams them back, fixing both auth and HTTP/HTTPS mixed-content
issues. In production the proxy binds to loopback and Caddy terminates HTTPS.

| Route                                          | Purpose                                          |
| ---------------------------------------------- | ------------------------------------------------ |
| `GET /api/partitions`                          | Partitions for the listbox                       |
| `POST /api/chat`                               | Streams the OpenAI-style SSE chat completion     |
| `GET /api/asset?u=`                            | Proxies a source file with token + `Range`       |
| `GET /api/extract/:id`                         | Cited chunk's text snippet                       |
| `GET/POST /api/prompts`, `.../delete`, `.../clear` | Saved demo prompts (persisted to JSON)       |

## Requirements

- **Node.js ≥ 23.6** (Node 24 LTS recommended). The server is TypeScript and is
  run directly by Node's built-in type-stripping — no runtime transpiler.
- For HTTPS in production: **Caddy**.

## Setup

```bash
cp .env.example .env      # then set OPENRAG_API_TOKEN
npm install
```

## Develop

```bash
npm run dev               # Vite (5173) + proxy (127.0.0.1:8787), Vite forwards /api
npm run typecheck         # optional
```

Open http://localhost:5173.

---

## Production deployment (Linux · systemd · Caddy)

Tested on Debian/Ubuntu; adapt paths and the package manager as needed. The app
runs under a **dedicated, non-privileged system user** (no shell, not a sudoer),
listens only on loopback, and is fronted by Caddy for automatic HTTPS.

Install Node system-wide (e.g. from NodeSource), not via `nvm` — a system
service needs a stable absolute `node` path. Confirm it with `which node`
(below assumes `/usr/bin/node`).

### 1. Create the service user

The user's home goes in `/var/lib/radioassist` (standard for system services and
needed by `npm` for its cache during deploy); the application itself lives in
`/opt/radioassist.open-rag.ai`.

```bash
sudo useradd --system --create-home --home-dir /var/lib/radioassist \
     --shell /usr/sbin/nologin radioassist
```

`--system` + `nologin` = no interactive login, and the account is **not** added
to any sudo/admin group.

### 2. Deploy the code (owned by the service user)

```bash
sudo git clone https://github.com/linagora/radioassist.open-rag.ai.git \
     /opt/radioassist.open-rag.ai
sudo chown -R radioassist:radioassist /opt/radioassist.open-rag.ai
sudo -u radioassist mkdir -p /opt/radioassist.open-rag.ai/data   # writable dir for prompts.json
```

### 3. Install dependencies and build (as the service user)

```bash
sudo -u radioassist bash -c 'cd /opt/radioassist.open-rag.ai && npm ci && npm run build'
```

`npm ci` needs a committed `package-lock.json` (commit it); use `npm install`
otherwise. The build needs the dev dependencies (Vite) — that's expected.

### 4. Create the secret `.env` (locked down)

```bash
sudo -u radioassist tee /opt/radioassist.open-rag.ai/.env >/dev/null <<'EOF'
OPENRAG_API_URL=https://domain.tld
OPENRAG_API_TOKEN=PASTE_YOUR_TOKEN_HERE
PORT=8787
HOST=127.0.0.1
EOF
sudo chmod 600 /opt/radioassist.open-rag.ai/.env
```

`chmod 600` + service-user ownership means only that user (and root) can read
the token.

### 5. systemd unit — `/etc/systemd/system/radioassist.service`

```ini
[Unit]
Description=Open-RAG.ai demo front end (Express proxy + SPA)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=radioassist
Group=radioassist
WorkingDirectory=/opt/radioassist.open-rag.ai
Environment=NODE_ENV=production
ExecStart=/usr/bin/node server/index.ts
Restart=on-failure
RestartSec=5

# ---- Sandboxing / hardening (Node-compatible) ----
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/radioassist.open-rag.ai/data
ProtectControlGroups=true
ProtectKernelModules=true
ProtectKernelTunables=true
ProtectKernelLogs=true
ProtectClock=true
ProtectHostname=true
ProtectProc=invisible
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
RestrictNamespaces=true
RestrictSUIDSGID=true
RestrictRealtime=true
LockPersonality=true
SystemCallFilter=@system-service
SystemCallErrorNumber=EPERM
CapabilityBoundingSet=
AmbientCapabilities=
UMask=0077
# Do NOT set MemoryDenyWriteExecute=true — it breaks V8's JIT and Node crashes.

[Install]
WantedBy=multi-user.target
```

`ProtectSystem=strict` mounts the whole filesystem read-only; the app can read
its code and `.env` but only `data/` (via `ReadWritePaths`) is writable. The
empty `CapabilityBoundingSet`/`AmbientCapabilities` drop all Linux capabilities
(the proxy needs none — it binds a high port, not <1024).

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now radioassist
systemctl status radioassist          # check it's running
journalctl -u radioassist -f          # follow logs
```

> If startup fails with a syscall/address-family error on an unusual kernel,
> relax `SystemCallFilter`/`RestrictAddressFamilies` first to confirm the cause.

### 6. Caddy — `/etc/caddy/Caddyfile`

```caddy
radioassist.open-rag.ai {
    encode zstd gzip
    reverse_proxy 127.0.0.1:8787

    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "strict-origin-when-cross-origin"
        -Server
    }

    # Optional Content-Security-Policy. The app only talks to its own origin, so
    # this is a good baseline — test before enforcing, then tighten as possible:
    # header Content-Security-Policy "default-src 'self'; img-src 'self' data:; media-src 'self'; object-src 'self'; frame-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; base-uri 'self'; form-action 'self'"
}
```

```bash
sudo systemctl reload caddy
```

Caddy obtains and renews the TLS certificate automatically (point the DNS
A/AAAA record at the server first, and open ports 80/443).

> **Embedding note:** the app is loaded in Radio Assist's WebView, so we
> deliberately do **not** send `X-Frame-Options`/`frame-ancestors` that would
> block embedding. If you ever serve it standalone, add clickjacking protection
> via a `frame-ancestors` CSP directive scoped to the allowed embedders.

### 7. Firewall

```bash
sudo ufw allow 80,443/tcp
sudo ufw enable
```

The Node proxy binds `127.0.0.1:8787`, so it is unreachable from the network
even without a firewall rule — Caddy is the only public entry point.

### Updating

```bash
sudo -u radioassist bash -c 'cd /opt/radioassist.open-rag.ai && git pull && npm ci && npm run build'
sudo systemctl restart radioassist
```

Run `npm audit` periodically and keep Node/Caddy patched.

---

## Configuration (`.env`)

| Variable             | Default                    | Description                                         |
| -------------------- | -------------------------- | --------------------------------------------------- |
| `OPENRAG_API_URL`    | —                          | OpenRAG base URL (required)                         |
| `OPENRAG_API_TOKEN`  | —                          | API token (required, server-side only)              |
| `OPENRAG_PARTITIONS` | _(empty = all)_            | Comma-separated allowlist for the listbox           |
| `PORT`               | `8787`                     | Proxy port                                          |
| `HOST`               | `127.0.0.1`                | Bind address (use `0.0.0.0` only to expose directly)|
| `PROMPTS_FILE`       | `data/prompts.json`        | Where saved demo prompts are stored (relative to CWD)|

## License

Free software, licensed under the [GNU Affero General Public License v3.0
or later](LICENSE).
Copyright © 2026 Linagora — source: <https://github.com/linagora/radioassist.open-rag.ai>.

Because the AGPL applies, users interacting with a deployed instance over the
network must be able to obtain the corresponding source code; the small
**AGPLv3** link in the top bar points back to this repository to satisfy that
requirement.
