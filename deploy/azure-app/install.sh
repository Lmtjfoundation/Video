#!/usr/bin/env bash
# Runs Ghost Post itself (the website, its database folder and the built-in scheduler) on an Ubuntu VM, behind HTTPS
# with Caddy and a free Let's Encrypt certificate. Safe to run again: it updates to the latest code.
#
#   curl -fsSL https://raw.githubusercontent.com/Lmtjfoundation/Video/nexus-pulse-autopilot/deploy/azure-app/install.sh | sudo bash
#   ... | sudo bash -s -- --migrate-from https://ghost-post-autopilot.up.railway.app   # then open /restore
#   ... | sudo bash -s -- --domain app.example.com                                      # your own DNS name
#
# Updates: the VM checks the branch every 2 minutes and deploys new commits by itself (ghostpost-deploy), building
# each release in its own folder so the live site never serves a half-built one.
set -euo pipefail

ROOT=/opt/ghostpost
DATA=/var/lib/ghostpost
ENV_DIR=/etc/ghostpost
DOMAIN=""
MIGRATE_FROM=""
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    --migrate-from) MIGRATE_FROM="${2%/}"; shift 2 ;;
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
printf 'import sites/*.caddy\n' > /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
systemctl reload caddy || systemctl restart caddy

say "Done"
for _ in $(seq 60); do curl -fsS -o /dev/null --max-time 5 http://127.0.0.1:3000/api/plans && break; sleep 2; done
echo "  Ghost Post : https://$DOMAIN  ($(systemctl is-active ghostpost))"
[ -n "$MIGRATE_FROM" ] && echo "  Next       : open https://$DOMAIN/restore and paste a move code from $MIGRATE_FROM (Admin -> App settings -> Move to a new server)."
echo "  Logs       : sudo journalctl -u ghostpost -n 100"
