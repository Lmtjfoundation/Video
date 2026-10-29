#!/usr/bin/env bash
# Starts Ghost Post's video engine on an Azure GPU virtual machine, with HTTPS, in one command.
# Run it in Azure Cloud Shell (portal.azure.com → the >_ button), which already has the az tool and your sign-in:
#
#   curl -sL https://raw.githubusercontent.com/Lmtjfoundation/Video/nexus-pulse-autopilot/engine/azure/deploy.sh | bash
#
# Optional settings (put them before `bash`, e.g. `... | QUALITY=fast bash`):
#   LOCATION   Azure region (default eastus)
#   SIZE       VM size (default Standard_NC24ads_A100_v4: one A100 80 GB, 220 GB memory)
#   QUALITY    best (Wan 2.2 I2V-A14B, needs 80 GB) or fast (Wan 2.2 TI2V-5B)
#   GROUP      resource group name (default ghost-post-engine)
#   SHUTDOWN   daily automatic stop, UTC hhmm (default 0700: 1 AM in Dallas in winter, 2 AM in summer); "off" to skip
#   IDLE_STOP  minutes without a request before the VM deallocates itself (default 20); "off" to keep it on
#              For an A10: SIZE=Standard_NV36ads_A10_v5 QUALITY=fast (24 GB: the fast video model, the others offload)
#   PRIORITY   Regular (default) or Spot: Azure's spare capacity, much cheaper by the hour; Azure may take the VM back
#              when it needs the capacity (it is then stopped, not deleted, and the app wakes it again or falls back)
set -euo pipefail

LOCATION="${LOCATION:-eastus}"
SIZE="${SIZE:-Standard_NC24ads_A100_v4}"
QUALITY="${QUALITY:-best}"
GROUP="${GROUP:-ghost-post-engine}"
SHUTDOWN="${SHUTDOWN:-0700}"
IDLE_STOP="${IDLE_STOP:-20}"
PRIORITY="${PRIORITY:-Regular}"
case "$PRIORITY" in Regular|Spot) ;; *) echo "PRIORITY must be Regular or Spot" >&2; exit 1 ;; esac
VM="ghost-post-engine"
BRANCH="nexus-pulse-autopilot"
RAW="https://raw.githubusercontent.com/Lmtjfoundation/Video/${BRANCH}/engine/azure"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

command -v az >/dev/null || fail "The az tool isn't installed. Run this in Azure Cloud Shell (portal.azure.com → >_)."
az account show >/dev/null 2>&1 || fail "You're not signed in to Azure. Run: az login"
say "Subscription: $(az account show --query name -o tsv)"

# GPU quota: new and grant-funded subscriptions usually start at 0 vCPUs for GPU families.
family=$(az vm list-skus --location "$LOCATION" --size "$SIZE" --resource-type virtualMachines --query "[0].family" -o tsv 2>/dev/null || true)
[ -n "$family" ] || fail "$SIZE isn't offered in $LOCATION. Try LOCATION=eastus2, westus3 or southcentralus."
need=$(az vm list-skus --location "$LOCATION" --size "$SIZE" --resource-type virtualMachines --query "[0].capabilities[?name=='vCPUs'].value | [0]" -o tsv)
# Spot VMs count against one shared Spot quota ("lowPriorityCores") instead of the GPU family's.
quota="$family"; [ "$PRIORITY" = Spot ] && quota="lowPriorityCores"
read -r used limit < <(az vm list-usage --location "$LOCATION" --query "[?name.value=='$quota'] | [0].[currentValue, limit]" -o tsv)
if [ "${limit:-0}" -lt "$(( ${used:-0} + need ))" ]; then
  fail "Your subscription's quota for $quota in $LOCATION is ${limit:-0} vCPUs (${used:-0} in use); this VM needs $need.
Request more: portal.azure.com → Quotas → Compute → search \"$quota\" → set the new limit to $need → Submit.
Say it is for a nonprofit's AI video generation. Approval can take from minutes to a few days. Then run this again."
fi

token=$(openssl rand -hex 24)
label="ghostpost-$(openssl rand -hex 3)"
domain="${label}.${LOCATION}.cloudapp.azure.com"
init=$(mktemp)
curl -fsSL "$RAW/cloud-init.yaml" | sed -e "s|__TOKEN__|$token|g" -e "s|__DOMAIN__|$domain|g" -e "s|__QUALITY__|$QUALITY|g" -e "s|__BRANCH__|$BRANCH|g" -e "s|__IDLE__|$IDLE_STOP|g" > "$init"

say "Creating resource group $GROUP in $LOCATION…"
az group create --name "$GROUP" --location "$LOCATION" -o none

spot=()
[ "$PRIORITY" = Spot ] && spot=(--priority Spot --eviction-policy Deallocate --max-price -1)
say "Creating the GPU virtual machine ($SIZE, $PRIORITY)… this takes a few minutes."
az vm create \
  --resource-group "$GROUP" --name "$VM" --location "$LOCATION" --size "$SIZE" \
  --image Canonical:0001-com-ubuntu-server-jammy:22_04-lts-gen2:latest \
  --security-type Standard \
  --os-disk-size-gb 512 --storage-sku Premium_LRS \
  --public-ip-sku Standard --public-ip-address-dns-name "$label" \
  --admin-username ghostpost --generate-ssh-keys \
  "${spot[@]}" \
  --custom-data "$init" -o none
rm -f "$init"

say "Opening HTTPS (443) and the certificate check (80)…"
az vm open-port --resource-group "$GROUP" --name "$VM" --port 80,443 --priority 900 -o none

say "Installing the NVIDIA driver (the VM may restart)…"
az vm extension set --resource-group "$GROUP" --vm-name "$VM" \
  --name NvidiaGpuDriverLinux --publisher Microsoft.HpcCompute -o none

if [ "$IDLE_STOP" != "off" ]; then
  say "Letting the VM stop itself after $IDLE_STOP idle minutes (its own identity may only read and deallocate this VM)…"
  principal=$(az vm identity assign --resource-group "$GROUP" --name "$VM" --query systemAssignedIdentity -o tsv)
  vmid=$(az vm show --resource-group "$GROUP" --name "$VM" --query id -o tsv)
  sub=$(az account show --query id -o tsv)
  az role definition list --name "Ghost Post VM self-stop" --query "[0].name" -o tsv | grep -q . || az role definition create -o none --role-definition "{\"Name\":\"Ghost Post VM self-stop\",\"Description\":\"Lets an engine VM read and deallocate itself when idle.\",\"Actions\":[\"Microsoft.Compute/virtualMachines/read\",\"Microsoft.Compute/virtualMachines/deallocate/action\"],\"AssignableScopes\":[\"/subscriptions/$sub\"]}"
  for _ in 1 2 3 4 5 6; do
    az role assignment create -o none --assignee-object-id "$principal" --assignee-principal-type ServicePrincipal --role "Ghost Post VM self-stop" --scope "$vmid" 2>/dev/null && break
    sleep 20
  done
fi

if [ "$SHUTDOWN" != "off" ]; then
  say "Setting a daily automatic stop at $SHUTDOWN UTC, so a forgotten VM doesn't use up your credit…"
  az vm auto-shutdown --resource-group "$GROUP" --name "$VM" --time "$SHUTDOWN" -o none
fi

say "Done. The engine is installing and downloading the model now (about 160 GB for best; allow 30–60 minutes). The picture and writing models (about 130 GB more) download the first time they are used."
cat <<EOF

  Address:  https://${domain}
  Token:    ${token}

In Ghost Post: Admin → App settings → Integrations → Ghost Post Video Engine.
Paste the address and the token, press Save & test. Until the download finishes, the test says the model is loading.

Keep the token private. It is also saved on the VM in /etc/ghost-post-engine.env.

Stop the GPU when you're not filming (you pay only while it runs; the disk costs a little while stopped):
  az vm deallocate -g ${GROUP} -n ${VM}
Start it again:
  az vm start -g ${GROUP} -n ${VM}
Delete everything:
  az group delete -n ${GROUP}
EOF
