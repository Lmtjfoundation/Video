#!/usr/bin/env bash
# Runs Vueio (the Ghost Post app: website, database folder, built-in scheduler and its own CPU writer) as a standalone
# application on one AWS EC2 server, with HTTPS, in one command. No Railway, Vercel or Supabase needed: the data lives
# on the server's disk. Run it in AWS CloudShell (console.aws.amazon.com → the >_ button), which already has the aws
# tool and your sign-in:
#
#   curl -sL https://raw.githubusercontent.com/Lmtjfoundation/Video/claude/vueio-aws-standalone/deploy/aws-app/deploy.sh | bash
#
# Optional settings (put them before `bash`, e.g. `... | REGION=us-west-2 bash`):
#   REGION        AWS region (default us-east-1)
#   TYPE          instance type (default m7i.xlarge: 4 vCPU, 16 GB, like the Azure D4ads app VM; t3.large works
#                 without the writer: WRITER=off)
#   DISK          disk size in GB (default 100; uploads and rendered videos live here)
#   NAME          name for the instance, firewall, address and key (default vueio-app)
#   DOMAIN        your own DNS name (point an A record at the printed address first); default <ip>.sslip.io
#   WRITER        "off" skips the app's own writer (Ollama + Qwen3-4B on the CPU) and uses Claude/Gemini keys instead
#   MIGRATE_FROM  address of an existing Vueio server to move from (then open /restore on the new one)
#   SSH_CIDR      allow SSH from this address range (e.g. 203.0.113.7/32); default: no SSH (use Session Manager)
#
# The app itself is set up by deploy/azure-app/install.sh (the same installer as the Azure VM). Like there, the server
# deploys new commits of the nexus-pulse-autopilot branch by itself every 2 minutes.
set -euo pipefail

REGION="${REGION:-us-east-1}"
TYPE="${TYPE:-m7i.xlarge}"
DISK="${DISK:-100}"
NAME="${NAME:-vueio-app}"
DOMAIN="${DOMAIN:-}"
WRITER="${WRITER:-on}"
MIGRATE_FROM="${MIGRATE_FROM:-}"
SSH_CIDR="${SSH_CIDR:-}"
INSTALL="https://raw.githubusercontent.com/Lmtjfoundation/Video/nexus-pulse-autopilot/deploy/azure-app/install.sh"
AMI_PARAM="/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id"
export AWS_DEFAULT_REGION="$REGION" AWS_PAGER=""

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

command -v aws >/dev/null || fail "The aws tool isn't installed. Run this in AWS CloudShell (console.aws.amazon.com → >_)."
command -v openssl >/dev/null || fail "openssl is needed (CloudShell has it)."
account=$(aws sts get-caller-identity --query Account --output text 2>/dev/null) || fail "You're not signed in to AWS. In CloudShell you are already; elsewhere run: aws configure"
say "Account: $account, region: $REGION"

[[ "$DISK" =~ ^[0-9]+$ ]] && [ "$DISK" -ge 40 ] || fail "DISK must be a number of GB, at least 40."
[[ "$WRITER" == on || "$WRITER" == off ]] || fail "WRITER must be on or off."
[ -z "$MIGRATE_FROM" ] || [[ "$MIGRATE_FROM" == https://* ]] || fail "MIGRATE_FROM must start with https://"
aws ec2 describe-instances --filters "Name=tag:Name,Values=$NAME" "Name=instance-state-name,Values=pending,running,stopping,stopped" \
  --query 'Reservations[].Instances[].InstanceId' --output text | grep -q . \
  && fail "An instance named $NAME already exists in $REGION. It updates itself; to make a second one use NAME=another-name."

aws ec2 describe-instance-type-offerings --location-type region --filters "Name=instance-type,Values=$TYPE" \
  --query 'InstanceTypeOfferings[0].InstanceType' --output text | grep -qx "$TYPE" \
  || fail "$TYPE isn't offered in $REGION. Try TYPE=m6i.xlarge or TYPE=t3.xlarge."
mem_mb=$(aws ec2 describe-instance-types --instance-types "$TYPE" --query 'InstanceTypes[0].MemoryInfo.SizeInMiB' --output text)
if [ "$WRITER" = on ] && [ "$mem_mb" -lt 15000 ]; then
  fail "$TYPE has $((mem_mb / 1024)) GB of memory; the app plus its own writer needs 16 GB. Use a bigger TYPE or WRITER=off."
fi

ami=$(aws ssm get-parameter --name "$AMI_PARAM" --query Parameter.Value --output text 2>/dev/null) \
  || fail "Couldn't find Canonical's Ubuntu 24.04 image in $REGION."
root_dev=$(aws ec2 describe-images --image-ids "$ami" --query 'Images[0].RootDeviceName' --output text)

# ---- Firewall, then a fixed address (so the HTTPS name survives stops and starts) --------------------------------
vpc=$(aws ec2 describe-vpcs --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text)
[ "$vpc" != None ] || fail "This region has no default VPC. Create one: aws ec2 create-default-vpc --region $REGION"
say "Opening HTTPS (443) and the certificate check (80)…"
sg=$(aws ec2 describe-security-groups --filters "Name=vpc-id,Values=$vpc" "Name=group-name,Values=$NAME" --query 'SecurityGroups[0].GroupId' --output text)
if [ "$sg" = None ]; then
  sg=$(aws ec2 create-security-group --group-name "$NAME" --description "Vueio app: HTTPS" --vpc-id "$vpc" --query GroupId --output text)
  aws ec2 authorize-security-group-ingress --group-id "$sg" --ip-permissions \
    'IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges=[{CidrIp=0.0.0.0/0}]' \
    'IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0}]' >/dev/null
fi
key_args=()
if [ -n "$SSH_CIDR" ]; then
  aws ec2 authorize-security-group-ingress --group-id "$sg" --protocol tcp --port 22 --cidr "$SSH_CIDR" >/dev/null 2>&1 || true
  key_file="$HOME/.ssh/$NAME.pem"
  if [ ! -f "$key_file" ]; then
    mkdir -p "$HOME/.ssh"
    aws ec2 create-key-pair --key-name "$NAME" --query KeyMaterial --output text > "$key_file"
    chmod 600 "$key_file"
  fi
  key_args=(--key-name "$NAME")
fi

# Session Manager (a browser shell from the EC2 console, no SSH or open port) needs this role on the instance.
profile_args=()
if aws iam get-instance-profile --instance-profile-name "$NAME" >/dev/null 2>&1; then
  profile_args=(--iam-instance-profile "Name=$NAME")
elif aws iam create-role --role-name "$NAME" --assume-role-policy-document \
       '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null 2>&1; then
  aws iam attach-role-policy --role-name "$NAME" --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
  aws iam create-instance-profile --instance-profile-name "$NAME" >/dev/null
  aws iam add-role-to-instance-profile --instance-profile-name "$NAME" --role-name "$NAME"
  sleep 10  # a new instance profile takes a few seconds before EC2 accepts it
  profile_args=(--iam-instance-profile "Name=$NAME")
else
  say "(Couldn't create an IAM role for Session Manager; continuing without it.)"
fi

say "Reserving a fixed public address…"
read -r alloc ip < <(aws ec2 allocate-address --domain vpc \
  --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=$NAME}]" --query '[AllocationId, PublicIp]' --output text)
[ -n "$DOMAIN" ] || DOMAIN="vueio.${ip//./-}.sslip.io"

# ---- Settings, made here so the setup code can be printed at the end ---------------------------------------------
# install.sh keeps an existing /etc/ghostpost/env and only updates APP_URL in it.
rnd() { openssl rand -base64 96 | tr -dc 'A-Za-z0-9' | head -c "$1"; }
setup_code=$(rnd 24)
args="--domain '$DOMAIN'"
[ "$WRITER" = on ] || args="$args --no-writer"
[ -z "$MIGRATE_FROM" ] || args="$args --migrate-from '$MIGRATE_FROM'"
userdata=$(mktemp)
cat > "$userdata" <<EOF
#!/bin/bash
set -e
mkdir -p /etc/ghostpost
umask 077
cat > /etc/ghostpost/env <<ENV
NODE_ENV=production
PORT=3000
APP_URL=https://$DOMAIN
DATA_DIR=/var/lib/ghostpost
INTERNAL_SCHEDULER=1
ENCRYPTION_KEY=$(rnd 64)
CRON_SECRET=$(rnd 40)
SETUP_CODE=$setup_code
ENV
umask 022
# A 4 GB swap file, so a Next.js build never runs out of memory next to the running app.
if [ ! -f /swapfile ]; then fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab; fi
# Ubuntu's automatic updates can hold the package lock on a first boot; the installer needs it.
systemctl stop unattended-upgrades apt-daily.timer apt-daily-upgrade.timer 2>/dev/null || true
while fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1; do sleep 5; done
# Wait until the fixed address is attached, so Let's Encrypt can reach this server at $DOMAIN.
for _ in \$(seq 60); do [ "\$(curl -fsS -4 --max-time 5 https://checkip.amazonaws.com || true)" = "$ip" ] && break; sleep 5; done
curl -fsSL '$INSTALL' | bash -s -- $args
systemctl start unattended-upgrades apt-daily.timer apt-daily-upgrade.timer 2>/dev/null || true
EOF

say "Creating the server ($TYPE, ${DISK} GB)… this takes a minute."
instance=$(aws ec2 run-instances --image-id "$ami" --instance-type "$TYPE" --security-group-ids "$sg" "${key_args[@]}" "${profile_args[@]}" \
  --block-device-mappings "DeviceName=$root_dev,Ebs={VolumeSize=$DISK,VolumeType=gp3,Encrypted=true,DeleteOnTermination=false}" \
  --metadata-options HttpTokens=required \
  --user-data "file://$userdata" \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$NAME}]" "ResourceType=volume,Tags=[{Key=Name,Value=$NAME}]" \
  --query 'Instances[0].InstanceId' --output text) \
  || { aws ec2 release-address --allocation-id "$alloc" || true; rm -f "$userdata"; fail "AWS couldn't create the instance (see the message above). The reserved address was released."; }
rm -f "$userdata"
aws ec2 wait instance-running --instance-ids "$instance"
aws ec2 associate-address --instance-id "$instance" --allocation-id "$alloc" >/dev/null

say "Done. Vueio is installing now (allow 10–15 minutes for the first build$( [ "$WRITER" = on ] && echo " and the writer model download"))."
cat <<EOF

  Vueio:       https://${DOMAIN}
  Setup code:  ${setup_code}

Open the address, sign up with the setup code (the first account is the admin), then in Admin → App settings
connect Stripe and add your service keys. Each platform's redirect URL is APP_URL/api/connect/<platform>/callback.
$( [ -n "$MIGRATE_FROM" ] && echo "Moving from $MIGRATE_FROM: open https://${DOMAIN}/restore and paste a move code from the old server (Admin → App settings → Move to a new server)." )
Keep the setup code private. Settings are on the server in /etc/ghostpost/env; data in /var/lib/ghostpost.
The server deploys new commits of the nexus-pulse-autopilot branch by itself every 2 minutes.

Shell on the server: EC2 console → Instances → ${NAME} → Connect → Session Manager. Install log:
  sudo tail -n 50 /var/log/cloud-init-output.log      App log:  sudo journalctl -u ghostpost -n 100
Stop it (the disk and the fixed address keep a small charge):
  aws ec2 stop-instances --region ${REGION} --instance-ids ${instance}
Start it again (same address and data):
  aws ec2 start-instances --region ${REGION} --instance-ids ${instance}
Back up the data disk:
  aws ec2 create-snapshot --region ${REGION} --volume-id \$(aws ec2 describe-instances --region ${REGION} --instance-ids ${instance} --query 'Reservations[0].Instances[0].BlockDeviceMappings[0].Ebs.VolumeId' --output text) --description "${NAME} backup"
Delete the server (the disk is kept on purpose; delete it in EC2 → Volumes when you're sure):
  aws ec2 terminate-instances --region ${REGION} --instance-ids ${instance} && aws ec2 wait instance-terminated --region ${REGION} --instance-ids ${instance} \\
    && aws ec2 release-address --region ${REGION} --allocation-id ${alloc} && aws ec2 delete-security-group --region ${REGION} --group-id ${sg}
EOF
