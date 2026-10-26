#!/usr/bin/env bash
# Stops (deallocates) this engine VM after IDLE_MINUTES without an engine request, so it isn't billed while nobody
# uses it. Ghost Post starts it again on the next request (wake on use). A VM shut down from inside stays allocated
# and keeps billing; deallocating through Azure is what stops the bill. It uses the VM's own managed identity, which
# may only read and deallocate this one VM.
#
#   sudo bash idle-stop.sh --install [minutes]   # set up: Caddy access log + a check every 5 minutes
#   sudo bash idle-stop.sh                       # one check (what the timer runs)
#
# Not for a machine that also runs the Ghost Post app: the app must stay on.
set -euo pipefail
CONF=/etc/ghost-post-idle-stop.env
LOG=/var/log/caddy/engine-access.log

if [ "${1:-}" = "--install" ]; then
  MIN="${2:-20}"
  echo "IDLE_MINUTES=$MIN" > "$CONF"
  install -m 755 "$0" /usr/local/bin/ghost-post-idle-stop
  mkdir -p /var/log/caddy
  chown caddy:caddy /var/log/caddy 2>/dev/null || true
  # Log engine requests so idleness can be measured (the engine's site file, or the single-site Caddyfile).
  for f in /etc/caddy/sites/engine.caddy /etc/caddy/Caddyfile; do
    if [ -f "$f" ] && grep -q 'reverse_proxy 127.0.0.1:8000' "$f" && ! grep -q engine-access.log "$f"; then
      sed -i "s|  reverse_proxy 127.0.0.1:8000|  log {\n    output file $LOG\n  }\n  reverse_proxy 127.0.0.1:8000|" "$f"
      systemctl reload caddy || systemctl restart caddy
      break
    fi
  done
  cat > /etc/systemd/system/ghost-post-idle-stop.service <<UNIT
[Unit]
Description=Deallocate this engine VM when it has been idle
[Service]
Type=oneshot
ExecStart=/usr/local/bin/ghost-post-idle-stop
UNIT
  cat > /etc/systemd/system/ghost-post-idle-stop.timer <<UNIT
[Unit]
Description=Check every 5 minutes whether the engine is idle
[Timer]
OnBootSec=10min
OnUnitActiveSec=5min
[Install]
WantedBy=timers.target
UNIT
  systemctl daemon-reload
  systemctl enable -q --now ghost-post-idle-stop.timer
  echo "Idle stop on: this VM deallocates itself after $MIN minutes without engine requests."
  exit 0
fi

IDLE_MINUTES=20
# shellcheck disable=SC1090
[ -f "$CONF" ] && . "$CONF"
now=$(date +%s)
up=$(cut -d. -f1 /proc/uptime)
[ "$up" -ge $((IDLE_MINUTES * 60)) ] || exit 0 # just started: give the first request time to arrive

# The last real request (health checks and the capability question don't count as use).
last=0
if [ -f "$LOG" ]; then
  last=$(tail -n 5000 "$LOG" | python3 -c '
import json, sys
t = 0
for line in sys.stdin:
    try:
        r = json.loads(line)
    except ValueError:
        continue
    uri = r.get("request", {}).get("uri", "")
    if uri.startswith("/health") or uri.startswith("/v1/info"):
        continue
    t = max(t, int(r.get("ts", 0)))
print(t)')
fi
idle=$(( (now - (last > 0 ? last : now - up)) / 60 ))
[ "$idle" -ge "$IDLE_MINUTES" ] || exit 0

# Never in the middle of a job.
TOKEN="$(sed -n 's/^ENGINE_TOKEN=//p' /etc/ghost-post-engine.env 2>/dev/null || true)"
queue=$(curl -fsS --max-time 5 -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8000/v1/info 2>/dev/null | python3 -c 'import json,sys; print(int(json.load(sys.stdin).get("queue", 0) or 0))' 2>/dev/null || echo 0)
[ "$queue" = 0 ] || exit 0

meta=$(curl -fsS --max-time 5 -H Metadata:true "http://169.254.169.254/metadata/instance/compute?api-version=2021-02-01")
sub=$(echo "$meta" | python3 -c 'import json,sys; print(json.load(sys.stdin)["subscriptionId"])')
rg=$(echo "$meta" | python3 -c 'import json,sys; print(json.load(sys.stdin)["resourceGroupName"])')
vm=$(echo "$meta" | python3 -c 'import json,sys; print(json.load(sys.stdin)["name"])')
token=$(curl -fsS --max-time 10 -H Metadata:true "http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https://management.azure.com/" | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')
logger -t ghost-post-idle-stop "idle ${idle} min: deallocating $vm"
curl -fsS --max-time 30 -X POST -H "Authorization: Bearer $token" -H "Content-Length: 0" \
  "https://management.azure.com/subscriptions/$sub/resourceGroups/$rg/providers/Microsoft.Compute/virtualMachines/$vm/deallocate?api-version=2024-07-01" >/dev/null
