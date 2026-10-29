#!/usr/bin/env bash
# Runs Ghost Post itself (the website, its database folder and the built-in scheduler) on an Ubuntu VM, behind HTTPS
# with Caddy and a free Let's Encrypt certificate. Safe to run again: it updates to the latest code.
#
#   curl -fsSL https://raw.githubusercontent.com/Lmtjfoundation/Video/nexus-pulse-autopilot/deploy/azure-app/install.sh | sudo bash
#   ... | sudo bash -s -- --migrate-from https://OLD-SERVER   # then open /restore
#   ... | sudo bash -s -- --domain app.example.com                                      # your own DNS name
#   ... | sudo bash -s -- --no-writer                       # skip Ghost Post's own writer (an open AI model on this CPU)
#
# Ghost Post's own writer: Ollama with Qwen3-4B on this machine's processor, so writing needs no Claude or Gemini
# credits. It loads when a request comes in and unloads after 30 idle minutes. Published (with a key) at
# https://writer.<this address> so another Ghost Post server can use it too.
#
# Updates: the VM checks the branch every 2 minutes and deploys new commits by itself (ghostpost-deploy), building
# each release in its own folder so the live site never serves a half-built one.
set -euo pipefail

ROOT=/opt/ghostpost
DATA=/var/lib/ghostpost
ENV_DIR=/etc/ghostpost
DOMAIN=""
MIGRATE_FROM=""
WRITER=1
WRITER_MODEL="${GHOST_POST_WRITER_MODEL:-qwen3:4b-instruct-2507-q4_K_M}"
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    --migrate-from) MIGRATE_FROM="${2%/}"; shift 2 ;;
    --no-writer) WRITER=0; shift ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mXX  %s\033[0m\n' "$*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || die "Run it with sudo."

IP="$(curl -fsS -4 --max-time 10 https://api.ipify.org || true)"
[ -n "$DOMAIN" ] || { [ -n "$IP" ] && DOMAIN="ghostpost.${IP//./-}.sslip.io"; }
[ -n "$DOMAIN" ] || die "Couldn't find this VM's public IP. Run it again with --domain your.domain.example"

say "Packages (Node 22, ffmpeg, Caddy)"
apt-get update -q
DEBIAN_FRONTEND=noninteractive apt-get install -y -q git ffmpeg curl gnupg ca-certificates debian-keyring debian-archive-keyring apt-transport-https build-essential
if ! node --version 2>/dev/null | grep -q '^v22\.'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q nodejs
fi
if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt -o /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q && DEBIAN_FRONTEND=noninteractive apt-get install -y -q caddy
fi

say "Service account and folders"
id ghostpost >/dev/null 2>&1 || useradd --system --home "$ROOT" --shell /usr/sbin/nologin ghostpost
mkdir -p "$ROOT/releases" "$DATA" "$ENV_DIR"
chown -R ghostpost:ghostpost "$ROOT" "$DATA"
chmod 750 "$DATA"

say "Settings ($ENV_DIR/env)"
# Generated once and kept. A move from another server replaces the secrets with that server's (DATA/app.env).
if [ ! -f "$ENV_DIR/env" ]; then
  rnd() { head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c "$1"; }
  umask 077
  cat > "$ENV_DIR/env" <<ENV
NODE_ENV=production
PORT=3000
APP_URL=https://$DOMAIN
DATA_DIR=$DATA
INTERNAL_SCHEDULER=1
ENCRYPTION_KEY=$(rnd 64)
CRON_SECRET=$(rnd 40)
SETUP_CODE=$(rnd 24)
ENV
  umask 022
fi
sed -i "s|^APP_URL=.*|APP_URL=https://$DOMAIN|" "$ENV_DIR/env"
if [ -n "$MIGRATE_FROM" ]; then
  grep -q '^MIGRATE_FROM=' "$ENV_DIR/env" && sed -i "s|^MIGRATE_FROM=.*|MIGRATE_FROM=$MIGRATE_FROM|" "$ENV_DIR/env" || echo "MIGRATE_FROM=$MIGRATE_FROM" >> "$ENV_DIR/env"
fi
# The light-tools engine on this same machine (engine/azure/install.sh --cpu), when it's there.
if [ -f /etc/ghost-post-engine.env ] && ! grep -q '^VIDEO_ENGINE_URL=' "$ENV_DIR/env"; then
  TOKEN="$(sed -n 's/^ENGINE_TOKEN=//p' /etc/ghost-post-engine.env)"
  [ -n "$TOKEN" ] && printf 'VIDEO_ENGINE_URL=http://127.0.0.1:8000\nVIDEO_ENGINE_TOKEN=%s\n' "$TOKEN" >> "$ENV_DIR/env"
fi
chmod 600 "$ENV_DIR/env"

if [ "$WRITER" = 1 ]; then
  say "Ghost Post's own writer ($WRITER_MODEL on this CPU)"
  command -v ollama >/dev/null || curl -fsSL https://ollama.com/install.sh | HOME=/root sh
  mkdir -p /etc/systemd/system/ollama.service.d
  cat > /etc/systemd/system/ollama.service.d/ghostpost.conf <<'CONF'
[Service]
Environment=OLLAMA_HOST=127.0.0.1:11434
Environment=OLLAMA_KEEP_ALIVE=30m
Environment=OLLAMA_NUM_PARALLEL=2
Environment=OLLAMA_CONTEXT_LENGTH=12288
Environment=OLLAMA_FLASH_ATTENTION=1
Environment=OLLAMA_KV_CACHE_TYPE=q8_0
MemoryMax=8G
CONF
  systemctl daemon-reload
  systemctl enable -q ollama
  systemctl restart ollama
  for _ in $(seq 30); do curl -fsS -o /dev/null http://127.0.0.1:11434/api/version && break; sleep 1; done
  HOME=/root ollama pull "$WRITER_MODEL" >/dev/null
  grep -q '^OWN_WRITER_KEY=' "$ENV_DIR/env" || echo "OWN_WRITER_KEY=$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 40)" >> "$ENV_DIR/env"
  grep -q '^OWN_WRITER_URL=' "$ENV_DIR/env" || echo "OWN_WRITER_URL=http://127.0.0.1:11434/v1" >> "$ENV_DIR/env"
  grep -q '^OWN_WRITER_MODEL=' "$ENV_DIR/env" && sed -i "s|^OWN_WRITER_MODEL=.*|OWN_WRITER_MODEL=$WRITER_MODEL|" "$ENV_DIR/env" || echo "OWN_WRITER_MODEL=$WRITER_MODEL" >> "$ENV_DIR/env"
fi

say "Deploy script and service"
install -m 755 /dev/stdin /usr/local/bin/ghostpost-deploy <<'DEPLOY'
#!/usr/bin/env bash
# Builds the latest commit of the branch in its own folder, switches to it, restarts, keeps the last 3 releases.
set -euo pipefail
BRANCH="${GHOST_POST_BRANCH:-nexus-pulse-autopilot}"
REPO_URL="https://github.com/Lmtjfoundation/Video"
ROOT=/opt/ghostpost
exec 9>/run/ghostpost-deploy.lock
flock -n 9 || exit 0
SHA="$(git ls-remote "$REPO_URL" "refs/heads/$BRANCH" | cut -c1-12)"
[ -n "$SHA" ] || { echo "Couldn't reach $REPO_URL"; exit 1; }
[ "$(readlink -f "$ROOT/current" 2>/dev/null || true)" = "$ROOT/releases/$SHA" ] && [ "${1:-}" != "--force" ] && exit 0
DIR="$ROOT/releases/$SHA"
# Built where it will run (a Next.js build remembers its folder). The live release is another folder meanwhile.
rm -rf "$DIR"
sudo -u ghostpost git clone -q --depth 1 -b "$BRANCH" "$REPO_URL" "$DIR"
cd "$DIR"
sudo -u ghostpost env HOME="$ROOT" npm ci --no-audit --no-fund --loglevel=error
sudo -u ghostpost env HOME="$ROOT" NODE_OPTIONS=--max-old-space-size=4096 npx next build >/dev/null
ln -sfn "$DIR" "$ROOT/current.new" && mv -T "$ROOT/current.new" "$ROOT/current"
systemctl restart ghostpost
echo "Deployed $SHA"
ls -1dt "$ROOT"/releases/*/ | tail -n +4 | xargs -r rm -rf
DEPLOY

cat > /etc/systemd/system/ghostpost.service <<UNIT
[Unit]
Description=Ghost Post
After=network-online.target
Wants=network-online.target

[Service]
User=ghostpost
WorkingDirectory=$ROOT/current
EnvironmentFile=$ENV_DIR/env
# Settings moved from the old server (written by the move); they win over the ones above.
EnvironmentFile=-$DATA/app.env
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=3
MemoryMax=10G
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/systemd/system/ghostpost-deploy.service <<UNIT
[Unit]
Description=Deploy the latest Ghost Post commit
[Service]
Type=oneshot
ExecStart=/usr/local/bin/ghostpost-deploy
UNIT
cat > /etc/systemd/system/ghostpost-deploy.timer <<UNIT
[Unit]
Description=Check for new Ghost Post commits every 2 minutes
[Timer]
OnBootSec=2min
OnUnitActiveSec=2min
[Install]
WantedBy=timers.target
UNIT

say "First build (a few minutes)"
systemctl daemon-reload
/usr/local/bin/ghostpost-deploy --force
systemctl enable -q --now ghostpost ghostpost-deploy.timer

say "HTTPS with Caddy"
# One file per site, so the engine's own site (engine/azure/install.sh) and this one live side by side.
mkdir -p /etc/caddy/sites
if [ -f /etc/caddy/Caddyfile ] && ! grep -q 'import sites/' /etc/caddy/Caddyfile; then
  grep -q 'reverse_proxy 127.0.0.1:8000' /etc/caddy/Caddyfile && cp /etc/caddy/Caddyfile /etc/caddy/sites/engine.caddy
fi
printf '%s {\n  encode zstd gzip\n  request_body {\n    max_size 2GB\n  }\n  reverse_proxy 127.0.0.1:3000 {\n    transport http {\n      read_timeout 15m\n      write_timeout 15m\n    }\n  }\n}\n' "$DOMAIN" > /etc/caddy/sites/app.caddy
if [ "$WRITER" = 1 ]; then
  # Only the chat endpoint, and only with the key: the writer's other controls stay on this machine.
  WKEY="$(sed -n 's/^OWN_WRITER_KEY=//p' "$ENV_DIR/env")"
  umask 027
  printf 'writer.%s {\n  @key {\n    header Authorization "Bearer %s"\n    path /v1/chat/completions /v1/models\n  }\n  handle @key {\n    reverse_proxy 127.0.0.1:11434 {\n      header_up Host 127.0.0.1:11434\n      transport http {\n        read_timeout 15m\n      }\n    }\n  }\n  handle {\n    respond "Unauthorized" 401\n  }\n}\n' "${DOMAIN#ghostpost.}" "$WKEY" > /etc/caddy/sites/writer.caddy
  umask 022
  chgrp caddy /etc/caddy/sites/writer.caddy
fi
printf 'import sites/*.caddy\n' > /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
systemctl reload caddy || systemctl restart caddy

say "Done"
for _ in $(seq 60); do curl -fsS -o /dev/null --max-time 5 http://127.0.0.1:3000/api/plans && break; sleep 2; done
echo "  Ghost Post : https://$DOMAIN  ($(systemctl is-active ghostpost))"
[ -n "$MIGRATE_FROM" ] && echo "  Next       : open https://$DOMAIN/restore and paste a move code from $MIGRATE_FROM (Admin -> App settings -> Move to a new server)."
echo "  Logs       : sudo journalctl -u ghostpost -n 100"
[ "$WRITER" = 1 ] && echo "  Writer     : https://writer.${DOMAIN#ghostpost.} (key in $ENV_DIR/env as OWN_WRITER_KEY)"
