#!/usr/bin/env bash
# Deploys Vueio's Azure scene rendering (see ../README.md). Run from the repository root, signed in with `az login`
# on the nonprofit subscription:
#
#   ALERT_EMAIL=you@example.org bash azure/scene-render/infra/deploy.sh
#
# Settings (environment): RG (vueio-scenes), LOCATION (eastus), PREFIX (vueio), TAG (date-based), BUDGET (150 per
# month for this group), APP_VM (Vueio, the app server whose identity queues scenes), APP_RG (vueio).
#
# Before it can render: Azure must grant serverless GPU quota for Consumption-GPU-NC24-A100 in this region (a
# portal quota request; the subscription starts at 0). Everything else deploys and idles at near zero without it.
set -euo pipefail

RG=${RG:-vueio-scenes}
LOCATION=${LOCATION:-eastus}
PREFIX=${PREFIX:-vueio}
TAG=${TAG:-$(date -u +%Y%m%d%H%M)}
BUDGET=${BUDGET:-150}
APP_VM=${APP_VM:-Vueio}
APP_RG=${APP_RG:-vueio}
: "${ALERT_EMAIL:?Set ALERT_EMAIL to the address for budget alerts}"
HERE=azure/scene-render
[ -f "$HERE/infra/main.bicep" ] || { echo "Run from the repository root."; exit 1; }

say() { printf '\n== %s\n' "$*"; }
APP_PRINCIPAL=$(az vm show -g "$APP_RG" -n "$APP_VM" --query identity.principalId -o tsv 2>/dev/null || true)
[ -n "$APP_PRINCIPAL" ] || echo "Note: no managed identity found on $APP_RG/$APP_VM; grant it access to the storage account later."

say "Resource group $RG ($LOCATION)"
az group create -n "$RG" -l "$LOCATION" -o none

say "Pass 1: registry, storage, queues, Event Grid, environment, budget"
az deployment group create -g "$RG" -n scene-render-base -f "$HERE/infra/main.bicep" -o none \
  -p prefix="$PREFIX" deployJobs=false appPrincipalId="$APP_PRINCIPAL" monthlyBudget="$BUDGET" alertEmails="[\"$ALERT_EMAIL\"]"
out() { az deployment group show -g "$RG" -n scene-render-base --query "properties.outputs.$1.value" -o tsv; }
ACR=$(out acrName); SCENES=$(out scenesAccount)

say "Images (built in Azure with ACR Tasks; nothing is pulled from outside registries at run time)"
az acr build -r "$ACR" -t "vueio-scene-worker:$TAG" -f "$HERE/gpu-worker/Dockerfile" "$HERE/gpu-worker" -o none
az acr build -r "$ACR" -t "vueio-stitch-worker:$TAG" -f "$HERE/stitch-worker/Dockerfile" . -o none

say "Artifact streaming (GPU containers start while their image is still streaming)"
for repo in vueio-scene-worker vueio-stitch-worker; do
  az acr artifact-streaming update -n "$ACR" --repository "$repo" --enable-streaming true -o none
done
az acr artifact-streaming create -n "$ACR" --image "vueio-scene-worker:$TAG" -o none
az acr artifact-streaming create -n "$ACR" --image "vueio-stitch-worker:$TAG" -o none

say "Pass 2: the scene, stitch and model-seed jobs"
az deployment group create -g "$RG" -n scene-render-jobs -f "$HERE/infra/main.bicep" -o none \
  -p prefix="$PREFIX" deployJobs=true imageTag="$TAG" appPrincipalId="$APP_PRINCIPAL" monthlyBudget="$BUDGET" alertEmails="[\"$ALERT_EMAIL\"]"

say "Model weights into Azure Files (one time, about 25 GB; CPU job)"
az containerapp job start -g "$RG" -n "$PREFIX-seed-models" -o none
echo "Follow it with: az containerapp job execution list -g $RG -n $PREFIX-seed-models -o table"

say "Done"
cat <<EOF
Point Vueio at it (on the app server, /etc/ghostpost/env), then restart the app:
  AZURE_SCENES_ACCOUNT=$SCENES

Optional, for Azure OpenAI keyframe pictures instead of FLUX (deploy gpt-image-1.5 on the Azure AI resource first):
  AZURE_AI_KEYFRAME_DEPLOYMENT=gpt-image-1.5

GPU quota: request "Managed Environment Consumption NCA100 GPUs" for $LOCATION in the portal
(Container Apps → Quotas, or Help + support → Service and subscription limits). Until it's granted, Vueio keeps
rendering with its motion-graphics engine (the scene jobs simply never start).
EOF
