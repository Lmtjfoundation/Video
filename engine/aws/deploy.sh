#!/usr/bin/env bash
# Starts Ghost Post's video engine on an AWS GPU instance (EC2), with HTTPS, in one command.
# Run it in AWS CloudShell (console.aws.amazon.com → the >_ button), which already has the aws tool and your sign-in:
#
#   curl -sL https://raw.githubusercontent.com/Lmtjfoundation/Video/nexus-pulse-autopilot/engine/aws/deploy.sh | bash
#
# Optional settings (put them before `bash`, e.g. `... | REGION=us-west-2 bash`):
#   REGION     AWS region (default us-east-1)
#   TYPE       instance type (default p5.4xlarge: one H100 80 GB, runs the "best" setting; g6e.2xlarge: one L40S 48 GB,
#              runs "fast"). The installer picks the setting from the GPU's memory.
#   NAME       name for the instance and its firewall, address and key (default ghost-post-engine)
#   SHUTDOWN   daily automatic stop, UTC hhmm (default 0700: 1 AM in Dallas in winter, 2 AM in summer); "off" to skip
#   SSH_CIDR   allow SSH from this address range (e.g. 203.0.113.7/32); default: no SSH
#
# The engine itself is set up by engine/azure/install.sh (the same installer as on Azure), on AWS's Deep Learning
# AMI, which comes with the NVIDIA driver, so no restart is needed.
set -euo pipefail

REGION="${REGION:-us-east-1}"
TYPE="${TYPE:-p5.4xlarge}"
NAME="${NAME:-ghost-post-engine}"
SHUTDOWN="${SHUTDOWN:-0700}"
SSH_CIDR="${SSH_CIDR:-}"
BRANCH="nexus-pulse-autopilot"
INSTALL="https://raw.githubusercontent.com/Lmtjfoundation/Video/${BRANCH}/engine/azure/install.sh"
AMI_PARAM="/aws/service/deeplearning/ami/x86_64/base-oss-nvidia-driver-gpu-ubuntu-22.04/latest/ami-id"
export AWS_DEFAULT_REGION="$REGION" AWS_PAGER=""

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

command -v aws >/dev/null || fail "The aws tool isn't installed. Run this in AWS CloudShell (console.aws.amazon.com → >_)."
account=$(aws sts get-caller-identity --query Account --output text 2>/dev/null) || fail "You're not signed in to AWS. In CloudShell you are already; elsewhere run: aws configure"
say "Account: $account, region: $REGION"

[[ "$SHUTDOWN" == off || "$SHUTDOWN" =~ ^([01][0-9]|2[0-3])[0-5][0-9]$ ]] || fail "SHUTDOWN must be hhmm in UTC (e.g. 0700) or off."
aws ec2 describe-instances --filters "Name=tag:Name,Values=$NAME" "Name=instance-state-name,Values=pending,running,stopping,stopped" \
  --query 'Reservations[].Instances[].InstanceId' --output text | grep -q . \
  && fail "An instance named $NAME already exists in $REGION. Start it with the command below, or use NAME=another-name.
  aws ec2 start-instances --region $REGION --instance-ids \$(aws ec2 describe-instances --region $REGION --filters Name=tag:Name,Values=$NAME --query 'Reservations[].Instances[].InstanceId' --output text)"

# ---- The instance type, and the quota for it -------------------------------------------------------------------
aws ec2 describe-instance-type-offerings --location-type region --filters "Name=instance-type,Values=$TYPE" \
  --query 'InstanceTypeOfferings[0].InstanceType' --output text | grep -qx "$TYPE" \
  || fail "$TYPE isn't offered in $REGION. For p5.4xlarge try REGION=us-east-2 or us-west-2."
read -r vcpus gpu_mb < <(aws ec2 describe-instance-types --instance-types "$TYPE" \
  --query 'InstanceTypes[0].[VCpuInfo.DefaultVCpus, GpuInfo.TotalGpuMemoryInMiB]' --output text)
[ "${gpu_mb:-None}" != None ] || fail "$TYPE has no GPU."

# New accounts start with a GPU quota of 0 vCPUs. P and G instances have separate quotas.
case "$TYPE" in
  p*) quota_code=L-417A185B; quota_name="Running On-Demand P instances" ;;
  g*) quota_code=L-DB2E81BA; quota_name="Running On-Demand G and VT instances" ;;
  *) quota_code=""; quota_name="" ;;
esac
if [ -n "$quota_code" ]; then
  limit=$(aws service-quotas get-service-quota --service-code ec2 --quota-code "$quota_code" --query 'Quota.Value' --output text 2>/dev/null || echo unknown)
  if [ "$limit" != unknown ] && [ "${limit%.*}" -lt "$vcpus" ]; then
    fail "Your account's quota for \"$quota_name\" in $REGION is ${limit%.*} vCPUs; $TYPE needs $vcpus.
Request more: console.aws.amazon.com/servicequotas → AWS services → Amazon EC2 → \"$quota_name\" → Request increase → $vcpus.
Or here: aws service-quotas request-service-quota-increase --region $REGION --service-code ec2 --quota-code $quota_code --desired-value $vcpus
Say it is for a nonprofit's AI video generation. Approval can take from minutes to a few days. Then run this again."
  fi
fi

ami=$(aws ssm get-parameter --name "$AMI_PARAM" --query Parameter.Value --output text 2>/dev/null) \
  || fail "Couldn't find AWS's Deep Learning AMI (Ubuntu 22.04, NVIDIA driver) in $REGION."
root_dev=$(aws ec2 describe-images --image-ids "$ami" --query 'Images[0].RootDeviceName' --output text)

# ---- A fixed address (so the HTTPS name survives stops and starts) and a firewall ------------------------------
say "Reserving a fixed public address…"
read -r alloc ip < <(aws ec2 allocate-address --domain vpc \
  --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=$NAME}]" --query '[AllocationId, PublicIp]' --output text)
domain="${ip//./-}.sslip.io"

say "Opening HTTPS (443) and the certificate check (80)…"
vpc=$(aws ec2 describe-vpcs --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text)
[ "$vpc" != None ] || fail "This region has no default VPC. Create one: aws ec2 create-default-vpc --region $REGION"
sg=$(aws ec2 describe-security-groups --filters "Name=vpc-id,Values=$vpc" "Name=group-name,Values=$NAME" --query 'SecurityGroups[0].GroupId' --output text)
if [ "$sg" = None ]; then
  sg=$(aws ec2 create-security-group --group-name "$NAME" --description "Ghost Post engine: HTTPS" --vpc-id "$vpc" --query GroupId --output text)
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

# ---- What the instance runs on its first start -----------------------------------------------------------------
token=$(openssl rand -hex 24)
stop_line=""
[ "$SHUTDOWN" = off ] || stop_line="echo '$((10#${SHUTDOWN:2:2})) $((10#${SHUTDOWN:0:2})) * * * root /sbin/shutdown -h now' > /etc/cron.d/ghost-post-stop"
userdata=$(mktemp)
cat > "$userdata" <<EOF
#!/bin/bash
# The installer keeps an existing token, so the one printed by deploy.sh stays valid.
printf 'ENGINE_TOKEN=%s\n' '$token' > /etc/ghost-post-engine.env
chmod 600 /etc/ghost-post-engine.env
# Ubuntu's automatic updates can hold the package lock on a first boot; the installer needs it.
systemctl stop unattended-upgrades apt-daily.timer apt-daily-upgrade.timer 2>/dev/null || true
while fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1; do sleep 5; done
$stop_line
curl -fsSL '$INSTALL' | bash -s -- '$domain'
EOF

say "Creating the GPU instance ($TYPE)… this takes a few minutes."
instance=$(aws ec2 run-instances --image-id "$ami" --instance-type "$TYPE" --security-group-ids "$sg" "${key_args[@]}" \
  --block-device-mappings "DeviceName=$root_dev,Ebs={VolumeSize=512,VolumeType=gp3,DeleteOnTermination=true}" \
  --instance-initiated-shutdown-behavior stop \
  --metadata-options HttpTokens=required \
  --user-data "file://$userdata" \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$NAME}]" "ResourceType=volume,Tags=[{Key=Name,Value=$NAME}]" \
  --query 'Instances[0].InstanceId' --output text) \
  || { aws ec2 release-address --allocation-id "$alloc" || true; rm -f "$userdata"; fail "AWS couldn't create the instance (see the message above). The reserved address was released."; }
rm -f "$userdata"
aws ec2 wait instance-running --instance-ids "$instance"
aws ec2 associate-address --instance-id "$instance" --allocation-id "$alloc" >/dev/null

say "Done. The engine is installing and downloading the models now (about 160 GB for best; allow 30–60 minutes). The picture and writing models (about 130 GB more) download the first time they are used."
cat <<EOF

  Address:  https://${domain}
  Token:    ${token}

In Ghost Post: Admin → App settings → Integrations → Ghost Post Video Engine.
Paste the address and the token, press Save & test. Until the download finishes, the test says the model is loading.

Keep the token private. It is also saved on the instance in /etc/ghost-post-engine.env.
$( [ "$SHUTDOWN" = off ] || echo "The instance stops itself every day at $SHUTDOWN UTC, so a forgotten GPU doesn't run up a bill." )

Stop the GPU when you're not filming (you pay only while it runs; the 512 GB disk and the fixed address cost a little while stopped):
  aws ec2 stop-instances --region ${REGION} --instance-ids ${instance}
Start it again (same address and token):
  aws ec2 start-instances --region ${REGION} --instance-ids ${instance}
Installation log, if the address isn't answering after an hour (needs SSH_CIDR when you deploy):
  ssh -i ~/.ssh/${NAME}.pem ubuntu@${ip} sudo tail -n 50 /var/log/cloud-init-output.log
Delete everything:
  aws ec2 terminate-instances --region ${REGION} --instance-ids ${instance} && aws ec2 wait instance-terminated --region ${REGION} --instance-ids ${instance} \\
    && aws ec2 release-address --region ${REGION} --allocation-id ${alloc} && aws ec2 delete-security-group --region ${REGION} --group-id ${sg}
EOF
