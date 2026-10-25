#!/usr/bin/env bash
# Installs (or updates) the Ghost Post engine on a GPU VM you already have: Ubuntu 22.04/24.04 with an NVIDIA GPU.
# It runs the same steps as cloud-init.yaml (read from that file, so the two never drift apart), keeps the engine
# token between runs, and puts the engine behind HTTPS with Caddy and a free Let's Encrypt certificate.
#
#   curl -fsSL https://raw.githubusercontent.com/Lmtjfoundation/Video/nexus-pulse-autopilot/engine/azure/install.sh | sudo bash
#   ... | sudo bash -s -- --check            # only report what's ready and what isn't
#   ... | sudo bash -s -- my.domain.example  # use your own DNS name instead of <ip>.sslip.io
#
# Safe to run again: finished steps are skipped, and the services restart on the latest code.
set -euo pipefail

BRANCH="${GHOST_POST_BRANCH:-nexus-pulse-autopilot}"
REPO_URL="https://github.com/Lmtjfoundation/Video"
REPO=/opt/ghost-post/repo
ENV_FILE=/etc/ghost-post-engine.env
MIN_FREE_GB=250 # the video, picture, writing, speech and lip-sync models together
CHECK=0
DOMAIN=""
for a in "$@"; do
  case "$a" in
    --check) CHECK=1 ;;
    --force-disk) MIN_FREE_GB=0 ;;
    -*) echo "Unknown option: $a" >&2; exit 2 ;;
    *) DOMAIN="$a" ;;
  esac
done

say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!!  %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mXX  %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "Run it with sudo."
. /etc/os-release
[ "${ID:-}" = ubuntu ] || warn "This was written for Ubuntu; you have ${PRETTY_NAME:-an unknown system}."

# ---- What's there --------------------------------------------------------------------------------------------
IP="$(curl -fsS -4 --max-time 10 https://api.ipify.org || true)"
[ -n "$DOMAIN" ] || { [ -n "$IP" ] && DOMAIN="${IP//./-}.sslip.io"; }
[ -n "$DOMAIN" ] || die "Couldn't find this VM's public IP. Run it again with your DNS name: ... | sudo bash -s -- my.domain.example"
GPU="$(lspci 2>/dev/null | grep -i nvidia | head -1 || true)"
DRIVER=0
nvidia-smi >/dev/null 2>&1 && DRIVER=1
VRAM_GB=0
[ "$DRIVER" = 1 ] && VRAM_GB=$(( $(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits | head -1) / 1024 ))
mkdir -p /opt/ghost-post
FREE_GB=$(( $(df --output=avail -k /opt/ghost-post | tail -1) / 1024 / 1024 ))

say "This VM"
echo "  Public address : ${IP:-unknown}  ->  https://$DOMAIN"
echo "  GPU            : ${GPU:-none found}"
echo "  NVIDIA driver  : $([ "$DRIVER" = 1 ] && nvidia-smi --query-gpu=name,driver_version --format=csv,noheader | head -1 || echo 'not installed')"
echo "  GPU memory     : ${VRAM_GB} GB"
echo "  Free disk      : ${FREE_GB} GB on /opt (needs about ${MIN_FREE_GB} GB for all the models)"
echo "  Engine         : $(systemctl is-active ghost-post-engine 2>/dev/null || echo 'not installed')"
[ -n "$GPU" ] || warn "No NVIDIA GPU found. The engine needs one (Azure NC A100/H100 or NV A10 sizes)."
if [ "$CHECK" = 1 ]; then
  [ -f "$ENV_FILE" ] && echo "  Token          : set (in $ENV_FILE)"
  curl -fsS --max-time 10 "https://$DOMAIN/health" >/dev/null 2>&1 && echo "  HTTPS          : answering" || echo "  HTTPS          : not answering yet"
  exit 0
fi
[ -n "$GPU" ] || die "Stopping: there is no NVIDIA GPU on this VM."
[ "$FREE_GB" -ge "$MIN_FREE_GB" ] || die "Only ${FREE_GB} GB free on /opt; the models need about ${MIN_FREE_GB} GB. In Azure: VM -> Disks -> resize the OS disk (or attach a data disk mounted at /opt/ghost-post), then run this again. (--force-disk skips this check.)"

# ---- NVIDIA driver -------------------------------------------------------------------------------------------
if [ "$DRIVER" = 0 ]; then
  say "Installing the NVIDIA driver"
  apt-get update -q
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q ubuntu-drivers-common
  ubuntu-drivers install --gpgpu || ubuntu-drivers autoinstall
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q "nvidia-utils-$(ubuntu-drivers devices 2>/dev/null | awk '/recommended/ {print $3}' | grep -o '[0-9]\+' | head -1)-server" 2>/dev/null || true
  warn "The driver is installed. Restart the VM now (sudo reboot), wait a minute, SSH in again and run the same command."
  exit 0
fi

# ---- Packages, code ------------------------------------------------------------------------------------------
say "Packages"
apt-get update -q
DEBIAN_FRONTEND=noninteractive apt-get install -y -q git ffmpeg curl gnupg debian-keyring debian-archive-keyring apt-transport-https python3-yaml

say "Ghost Post code ($BRANCH)"
if [ -d "$REPO/.git" ]; then
  git -C "$REPO" fetch -q --depth 1 origin "$BRANCH"
  git -C "$REPO" checkout -q -B "$BRANCH" FETCH_HEAD
else
  git clone -q --depth 1 -b "$BRANCH" "$REPO_URL" "$REPO"
fi

# ---- Settings: keep the token from an earlier run ------------------------------------------------------------
TOKEN="$(sed -n 's/^ENGINE_TOKEN=//p' "$ENV_FILE" 2>/dev/null || true)"
[ -n "$TOKEN" ] || TOKEN="$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 40)"
# The A14B "best" models want an 80 GB card; smaller cards run the fast profile.
QUALITY=fast
[ "$VRAM_GB" -ge 70 ] && QUALITY=best

# ---- Files and steps from cloud-init.yaml ----------------------------------------------------------------------
say "Services (from cloud-init.yaml)"
STEPS="$(mktemp)"
python3 - "$REPO/engine/azure/cloud-init.yaml" "$TOKEN" "$QUALITY" "$DOMAIN" "$BRANCH" "$STEPS" <<'PY'
import os, sys, yaml
src, token, quality, domain, branch, steps = sys.argv[1:]
root = os.environ.get("GHOST_POST_TEST_ROOT", "")  # tests write the files under a scratch folder instead of /
cfg = yaml.safe_load(open(src))
fill = lambda s: s.replace("__TOKEN__", token).replace("__QUALITY__", quality).replace("__DOMAIN__", domain).replace("__BRANCH__", branch)
for f in cfg["write_files"]:
    path = root + f["path"]
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as out:
        out.write(fill(f["content"]))
    os.chmod(path, int(str(f.get("permissions", "0644")), 8))
with open(steps, "w") as out:
    for c in cfg["runcmd"]:
        c = fill(c if isinstance(c, str) else " ".join(c))
        if c.startswith("git clone"):
            continue  # done above (and kept up to date on later runs)
        if " uv venv " in f" {c} ":
            venv = c.split()[-1]
            c = f"[ -x {venv}/bin/python ] || {{ {c}; }}"  # keep an environment made by an earlier run
        out.write(c + "\n")
PY
while IFS= read -r step; do
  echo "  \$ ${step:0:110}"
  bash -c "$step"
done < "$STEPS"
rm -f "$STEPS"
systemctl restart ghost-post-engine ghost-post-audio ghost-post-speech ghost-post-lipsync ghost-post-voicedesign

# ---- Ready? -----------------------------------------------------------------------------------------------------
say "Waiting for https://$DOMAIN (the certificate and the first model load can take a few minutes)"
for _ in $(seq 1 60); do
  curl -fsS --max-time 10 "https://$DOMAIN/health" >/dev/null 2>&1 && break
  sleep 10
done
if curl -fsS --max-time 10 "https://$DOMAIN/health" >/dev/null 2>&1; then
  say "Done. In Ghost Post: Admin -> App settings -> Integrations -> Ghost Post Video Engine"
  echo "  Engine URL   : https://$DOMAIN"
  echo "  Engine token : $TOKEN"
  echo
  echo "  The first picture, clip and voice each load their model (several minutes, once)."
  echo "  Progress: sudo journalctl -fu ghost-post-engine   (also -audio, -speech, -lipsync, -voicedesign)"
else
  warn "https://$DOMAIN isn't answering yet."
  echo "  1. In Azure: VM -> Networking -> add inbound rules for TCP 80 and 443 (Caddy needs both for the certificate)."
  echo "  2. Check: sudo journalctl -u caddy -n 50   and   sudo journalctl -u ghost-post-engine -n 50"
  echo "  Engine token (keep it): $TOKEN"
fi
