# On-demand GPU server for the SaaS

`template.yaml` is a CloudFormation stack. It creates:

| Piece | What it does |
|---|---|
| **GPU instance** (default `g5.xlarge`: NVIDIA A10G 24 GB, 4 vCPU, 16 GB RAM) | Runs your app's GPU backend. Uses the AWS Deep Learning Base AMI (Ubuntu 22.04), which comes with the NVIDIA driver, CUDA, Docker and the NVIDIA container runtime installed. |
| **Idle auto-stop** | Checks every minute. The server counts as **active** while the GPU is above 5 % utilization, a client is connected to the app port, or an admin shell is open. After **30 minutes** with none of those, the server **stops**. A stopped server keeps its disk and data. |
| **Fixed IP** (Elastic IP) | The server's address stays the same across stops and starts, so your app always knows where it is. |
| **Wake endpoint** (Lambda function URL) | Your app sends `POST` to this URL with a secret header, and the server starts if it's stopped. |
| **Security** | Only the app port is open. There's no SSH; admin access goes through AWS Systems Manager. The disk is encrypted and IMDSv2 is required. |

## Deploy

```bash
aws cloudformation deploy \
  --region us-east-1 \
  --stack-name saas-gpu \
  --template-file infra/gpu-server/template.yaml \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides WakeToken="$(openssl rand -hex 24)" IdleMinutes=30 AppPort=8000

aws cloudformation describe-stacks --stack-name saas-gpu --query "Stacks[0].Outputs"
```

Keep the `WakeToken` value somewhere safe, such as your app's secret store. Your app sends it to start the server.

**Before the first deploy:** new AWS accounts often have a GPU quota of 0. Look up *Running On-Demand G and VT instances* under Service Quotas in `us-east-1`. A `g5.xlarge` needs at least **4** vCPUs; raise the quota if it's lower.

## How your app uses it

```js
// 1. Wake the GPU server (safe to call every time; it does nothing if already running)
const wake = await fetch(WAKE_URL, { method: "POST", headers: { "x-wake-token": WAKE_TOKEN } })
const { url } = await wake.json()

// 2. Wait until the app on the GPU server answers (a cold start takes about 1–3 minutes)
async function waitForGpu() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${url}/health`)).ok) return } catch {}
    await new Promise(r => setTimeout(r, 5000))
  }
  throw new Error("GPU server did not come up")
}
await waitForGpu()

// 3. Send the work
const result = await fetch(`${url}/render`, { method: "POST", body: job })
```

Call the wake endpoint from your **backend**, not from browser code, so the token isn't exposed to the public.

## Run your app on the GPU server

```bash
aws ssm start-session --target <InstanceId> --region us-east-1
# on the server:
docker run -d --restart unless-stopped --gpus all -p 8000:8000 your-image:tag
```

`--restart unless-stopped` starts your app again automatically each time the server wakes up.

To keep the server awake during maintenance, run `sudo touch /etc/gpu-idle/keep-awake`. Remove the file to let it stop again. The idle log is at `journalctl -t gpu-idle`.

## Cost (us-east-1, on-demand; check current pricing)

- `g5.xlarge` running: about **$1.01/hour**. You're billed only while it runs.
- While stopped: the 100 GB disk costs about **$8/month**, and the Elastic IP about **$3.60/month**.
- Wake endpoint (Lambda): effectively free at this scale.

## Before production

- This setup serves plain **HTTP**. For a public SaaS, put HTTPS in front of it, either with a reverse proxy such as Caddy or nginx with a TLS certificate, or with a load balancer.
- Narrow `AllowedCidr` to your app servers' IPs.
- One instance means requests wait through a cold start of about 1–3 minutes after an idle stop. If users can't wait that long, raise `IdleMinutes` or keep the server running during business hours.
