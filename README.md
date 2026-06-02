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

### Installing Node.js + npm (Debian)

Debian's own `nodejs` package is too old. Follow the official installer from
<https://nodejs.org/en/download> (nvm method) — `npm` comes bundled with Node:

```bash
# Download and install nvm:
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh | bash

# in lieu of restarting the shell
\. "$HOME/.nvm/nvm.sh"

# Download and install Node.js:
nvm install 24

# Verify the Node.js version:
node -v # Should print "v24.16.0".

# Verify npm version:
npm -v # Should print "11.13.0".
```

> This installs Node under **your** home. On a production server you instead
> install nvm + Node under the dedicated service user — see
> [§2 of the production guide](#2-install-nodejs-as-the-service-user-nvm).

## Setup (development)

Run as **your normal user** (not `root`, not the production service user). Pick a
working directory you own — e.g. `~/src` — and clone the repo into it:

```bash
mkdir -p ~/src && cd ~/src
git clone https://github.com/linagora/radioassist.open-rag.ai.git
cd radioassist.open-rag.ai
```

Create your local config from the template and set the two required values:

```bash
cp .env.example .env
# Edit .env and set:
#   OPENRAG_API_URL=https://your-openrag-host.tld
#   OPENRAG_API_TOKEN=<your token>
nano .env                 # or your editor of choice
```

Install dependencies (run from the repo root, i.e. `~/src/radioassist.open-rag.ai`):

```bash
npm install
```

## Develop

From the same repo root:

```bash
npm run dev               # Vite (5173) + proxy (127.0.0.1:8787), Vite forwards /api
npm run typecheck         # optional, in a second terminal
```

Open <http://localhost:5173>. The dev server reads the `.env` you just created;
the API token stays in the proxy and is never sent to the browser.

---

## Production deployment (Linux · systemd · Caddy)

Tested on Debian/Ubuntu; adapt paths and the package manager as needed. The app
runs under a **dedicated, non-privileged system user** (no shell, not a sudoer),
listens only on loopback, and is fronted by Caddy for automatic HTTPS.

Run every command below as a user with `sudo` (e.g. your own admin account).
The service account `radioassist` owns the whole runtime — its own nvm, its own
Node, the code, and the data dir. It has no shell and no sudo rights; you never
log in as it, you act on its behalf with `sudo -u radioassist`.

### 1. Create the service user

The user's home goes in `/var/lib/radioassist` (this is where its nvm/Node and
npm cache live — outside `/home`, so the systemd `ProtectHome=true` below does
not mask it); the application itself lives in `/opt/radioassist.open-rag.ai`.

```bash
sudo useradd --system --create-home --home-dir /var/lib/radioassist \
     --shell /usr/sbin/nologin radioassist
```

`--system` + `nologin` = no interactive login, and the account is **not** added
to any sudo/admin group.

### 2. Install Node.js as the service user (nvm)

Install nvm + Node 24 **into the service user's home**, per the official
installer at <https://nodejs.org/en/download>. The account is `nologin`, so we
invoke `bash` explicitly and set `HOME` — `sudo -u … -i` (a login shell) will
not work.

The nvm installer needs `curl` (and CA certs for HTTPS):

```bash
sudo apt-get update && sudo apt-get install -y curl ca-certificates
```

```bash
sudo -u radioassist env HOME=/var/lib/radioassist bash -c '
  export NVM_DIR="$HOME/.nvm"
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh | bash
  . "$NVM_DIR/nvm.sh"
  nvm install 24
  nvm alias default 24
  node -v            # v24.16.0
  command -v node    # ← COPY THIS ABSOLUTE PATH into ExecStart (step 6)
'
```

The last line prints something like
`/var/lib/radioassist/.nvm/versions/node/v24.16.0/bin/node`. That exact path is
what the systemd unit runs — note it down.

### 3. Deploy the code (owned by the service user)

```bash
sudo git clone https://github.com/linagora/radioassist.open-rag.ai.git \
     /opt/radioassist.open-rag.ai
sudo chown -R radioassist:radioassist /opt/radioassist.open-rag.ai
sudo -u radioassist mkdir -p /opt/radioassist.open-rag.ai/data   # writable dir for prompts.json
```

### 4. Install dependencies and build (as the service user)

Because Node lives in the service user's nvm, source nvm before running `npm`
(this is why a bare `sudo -u radioassist … npm …` gives `npm: command not found`):

```bash
sudo -u radioassist env HOME=/var/lib/radioassist bash -c '
  export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"
  cd /opt/radioassist.open-rag.ai && npm ci && npm run build'
```

`npm ci` needs a committed `package-lock.json` (commit it); use `npm install`
otherwise. The build needs the dev dependencies (Vite) — that's expected.

### 5. Create the secret `.env` (locked down)

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

### 6. systemd unit — `/etc/systemd/system/radioassist.service`

Set `ExecStart` to the absolute `node` path you copied in step 2 (shown below
with the typical value — change the version if `command -v node` differed).

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
ExecStart=/var/lib/radioassist/.nvm/versions/node/v24.16.0/bin/node server/index.ts
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
its code, its `.env`, and the nvm `node` under `/var/lib/radioassist`, but only
`data/` (via `ReadWritePaths`) is writable. `ProtectHome=true` masks `/home`,
`/root`, and `/run/user` only — it does **not** touch `/var/lib`, so the
service user's nvm `node` stays reachable. The empty
`CapabilityBoundingSet`/`AmbientCapabilities` drop all Linux capabilities (the
proxy needs none — it binds a high port, not <1024).

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now radioassist
systemctl status radioassist          # check it's running
journalctl -u radioassist -f          # follow logs
```

> If startup fails with a syscall/address-family error on an unusual kernel,
> relax `SystemCallFilter`/`RestrictAddressFamilies` first to confirm the cause.

### 7. Caddy

Debian's `caddy` package is often stale; install from Caddy's official apt repo
(per <https://caddyserver.com/docs/install#debian-ubuntu-raspbian>), as `root`:

```bash
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update
sudo apt-get install -y caddy
```

Installing the package also creates and enables a `caddy` systemd service that
reads `/etc/caddy/Caddyfile`. Replace that file's contents with:

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

### 8. Firewall

```bash
sudo ufw allow 80,443/tcp
sudo ufw enable
```

The Node proxy binds `127.0.0.1:8787`, so it is unreachable from the network
even without a firewall rule — Caddy is the only public entry point.

### Updating

```bash
sudo -u radioassist env HOME=/var/lib/radioassist bash -c '
  export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"
  cd /opt/radioassist.open-rag.ai && git pull && npm ci && npm run build'
sudo systemctl restart radioassist
```

Run `npm audit` periodically and keep Node/Caddy patched. If you bump the Node
major (`nvm install …` then `nvm alias default …`), the versioned path changes —
update `ExecStart` in the unit and `systemctl daemon-reload` + `restart`.

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
