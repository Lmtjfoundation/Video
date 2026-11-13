#!/bin/bash
# Installs the render worker as a systemd service. Usage: install.sh HF_CACHE_DIR RUNPY_PATH
set -e
install -d /opt/ghostpost-worker /workq
cp "$(dirname "$0")/worker.py" /opt/ghostpost-worker/worker.py
cat > /etc/systemd/system/ghostpost-worker.service <<UNIT
[Unit]
Description=Ghost Post render worker
After=docker.service network-online.target
Wants=docker.service
[Service]
Environment=HF_CACHE=$1
Environment=RUNPY=$2
ExecStart=/usr/bin/python3 /opt/ghostpost-worker/worker.py
Restart=always
RestartSec=15
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload && systemctl enable --now ghostpost-worker && systemctl is-active ghostpost-worker
