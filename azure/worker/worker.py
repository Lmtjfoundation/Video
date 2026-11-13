#!/usr/bin/env python3
"""
Render worker v2 (systemd service on each render VM). Managed identity only: tokens come from the VM's Azure Instance
Metadata Service, no keys on the machine.

Each job: tenant-aware, fair-scheduled (paid and free priority queues), generated with the tenant's preferred motion
model, gated for real motion (re-rolled when it comes out still-like, jittery or unsafe), post-processed (motion blur,
temporal smoothing, grade, H.264 + HLS) and stored under renders/<tenantId>/<userId>/<jobId>/ in Blob Storage, with
every intermediate kept. The result (model, seconds, cost, motion score, attempts) goes to "render-done".
"""
import base64, json, os, re, shutil, socket, subprocess, time, urllib.parse, urllib.request
import xml.etree.ElementTree as ET

ACCOUNT = os.environ.get("STORAGE_ACCOUNT", "ghostpostmedia133314")
QURL = f"https://{ACCOUNT}.queue.core.windows.net"
BURL = f"https://{ACCOUNT}.blob.core.windows.net"
SAFETY = os.environ.get("CONTENT_SAFETY_URL", "https://ghostpostai2793931451.cognitiveservices.azure.com/contentsafety/image:analyze?api-version=2024-09-01")
APIM = os.environ.get("APIM_URL", "https://ghostpost-apim-2114.azure-api.net")
WORK = os.environ.get("WORK_DIR", "/workq")
HF = os.environ.get("HF_CACHE", "/work/hf")
RUNPY = os.environ.get("RUNPY", "/work3/run.py")
VM = socket.gethostname()
_tok = {}
_turn = 0


def token(resource="https://storage.azure.com/"):
    t = _tok.get(resource)
    if t and t["exp"] - 300 > time.time():
        return t["v"]
    q = urllib.parse.urlencode({"api-version": "2018-02-01", "resource": resource})
    d = json.load(urllib.request.urlopen(urllib.request.Request(f"http://169.254.169.254/metadata/identity/oauth2/token?{q}", headers={"Metadata": "true"}), timeout=10))
    _tok[resource] = {"v": d["access_token"], "exp": int(d["expires_on"])}
    return d["access_token"]


def call(method, url, data=None, headers=None, resource="https://storage.azure.com/"):
    h = {"Authorization": f"Bearer {token(resource)}", "x-ms-version": "2023-11-03", **(headers or {})}
    with urllib.request.urlopen(urllib.request.Request(url, data=data, method=method, headers=h), timeout=900) as r:
        return r.read()


def q_get(name, visibility=10800):
    m = ET.fromstring(call("GET", f"{QURL}/{name}/messages?numofmessages=1&visibilitytimeout={visibility}")).find("QueueMessage")
    return None if m is None else {k: m.findtext(k) for k in ("MessageId", "PopReceipt", "MessageText", "DequeueCount")}


def q_put(name, obj):
    text = base64.b64encode(json.dumps(obj).encode()).decode()
    call("POST", f"{QURL}/{name}/messages", f"<QueueMessage><MessageText>{text}</MessageText></QueueMessage>".encode(), {"Content-Type": "application/xml"})


def q_del(name, m):
    call("DELETE", f"{QURL}/{name}/messages/{m['MessageId']}?popreceipt={urllib.parse.quote(m['PopReceipt'])}")


def put_blob(path, file, ctype):
    call("PUT", f"{BURL}/{path}", open(file, "rb").read(), {"x-ms-blob-type": "BlockBlob", "x-ms-blob-content-type": ctype})


def next_job():
    """Fair scheduling: about three paid jobs for every free one, and either tier when the other is empty."""
    global _turn
    _turn += 1
    order = ["render-work-free", "render-work-paid"] if _turn % 4 == 0 else ["render-work-paid", "render-work-free"]
    for qn in order + ["render-work"]:
        m = q_get(qn)
        if m:
            return qn, m
    return None, None


def busy():
    return bool(subprocess.run(["docker", "ps", "-q"], capture_output=True, text=True).stdout.strip())


# ---- generation ---------------------------------------------------------------------------------------------------
def gen_vm_ltx(job, d, prompt, seed, frames):
    """LTX-Video 2B on this VM's CPU."""
    with open(f"{d}/1.jpg", "wb") as f:
        f.write(call("GET", f"{BURL}/{job['imageBlob']}"))
    json.dump([{"image": "1.jpg", "prompt": prompt}], open(f"{d}/shots.json", "w"))
    src = re.sub(r"/work\d?/", f"{d}/", open(RUNPY).read())
    src = src.replace(f'subprocess.run(["sh","{d}/up.sh",dst])', "pass").replace("manual_seed(7+i)", "manual_seed(int(os.environ.get('SEED','7'))+i)")
    if os.path.exists(f"{d}/emb.pt"):
        os.remove(f"{d}/emb.pt")  # the prompt changes on a re-roll
    for f in ("out/clip1.mp4",):
        if os.path.exists(f"{d}/{f}"):
            os.remove(f"{d}/{f}")
    open(f"{d}/run.py", "w").write(src)
    subprocess.run(["docker", "run", "--rm", "-e", f"FRAMES={frames}", "-e", f"SEED={seed}", "-v", f"{d}:{d}", "-v", f"{HF}:/root/.cache/huggingface", "ltxcpu", "python", "-u", f"{d}/run.py"],
                   check=True, stdout=open(f"{d}/run.log", "a"), stderr=subprocess.STDOUT, timeout=6 * 3600)
    return f"{d}/out/clip1.mp4"


def gen_foundry(job, d, prompt, seed, frames, model):
    """A Microsoft Foundry video model through API Management. Only used once the registry marks it available."""
    raise RuntimeError(f"{model['label']} isn't available in Microsoft Foundry for this account")


def generate(job, d, prompt, seed, frames):
    errors = []
    for mid in job.get("models") or ["ltx-video-2b-azure-vm"]:
        m = (job.get("modelRegistry") or {}).get(mid, {"route": "worker", "available": True, "label": mid})
        if not m.get("available"):
            errors.append(f"{mid}: not available")
            continue
        try:
            out = gen_vm_ltx(job, d, prompt, seed, frames) if m.get("route") == "worker" else gen_foundry(job, d, prompt, seed, frames, m)
            return mid, m, out
        except Exception as e:
            errors.append(f"{mid}: {str(e)[:200]}")
    raise RuntimeError("No motion model could render this: " + "; ".join(errors))


# ---- quality gate ---------------------------------------------------------------------------------------------------
def fx(*args):
    return subprocess.run(["docker", "run", "--rm", "-v", "/workq:/workq", "postfx", *args], check=True, capture_output=True, text=True, timeout=3600).stdout


def motion_check(clip, d, q):
    fx("python", "/fx/gate.py", clip, f"{d}/gate.json", f"{d}/frames")
    g = json.load(open(f"{d}/gate.json"))
    ratio = g["motionScore"] / (g.get("cameraMotion", 0) + 0.05)
    fails = []
    if g["seconds"] < q.get("minSeconds", 3) - 0.05: fails.append(f"only {g['seconds']}s of motion")
    if g["motionScore"] < q.get("minMotionScore", 0.35): fails.append(f"motion {g['motionScore']}")
    if g["movingFrameRatio"] < q.get("minMovingFrameRatio", 0.5): fails.append(f"moving frames {g['movingFrameRatio']}")
    if ratio < q.get("minSubjectToCamera", 2): fails.append("camera move over a still")
    if g["popRatio"] > q.get("maxPopRatio", 0.1): fails.append(f"pops {g['popRatio']}")
    if g["jitter"] > q.get("maxJitter", 0.2): fails.append(f"jitter {g['jitter']}")
    g["subjectToCamera"] = round(ratio, 3)
    return g, fails


def safety_check(d, q):
    limits = q.get("safety") or {"Sexual": 2, "Hate": 4, "SelfHarm": 2, "Violence": 6}
    worst = {}
    for name in ("first", "middle", "last"):
        img = base64.b64encode(open(f"{d}/frames/{name}.png", "rb").read()).decode()
        r = json.loads(call("POST", SAFETY, json.dumps({"image": {"content": img}}).encode(), {"Content-Type": "application/json"}, resource="https://cognitiveservices.azure.com"))
        for c in r.get("categoriesAnalysis", []):
            worst[c["category"]] = max(worst.get(c["category"], 0), c.get("severity", 0))
    fails = [f"{k} {v}" for k, v in worst.items() if v >= limits.get(k, 99)]
    return worst, fails


def enrich_retry(prompt, attempt):
    """A re-roll asks for more: stronger, clearer movement."""
    more = ["Faster, bigger, continuous movement through the whole shot, every element in motion.", "Explosive full-body action, sweeping camera move, motion never pauses."]
    return f"{prompt} {more[min(attempt - 1, len(more) - 1)]}"


# ---- one job ----------------------------------------------------------------------------------------------------------
def run(job):
    tenant, user = job.get("tenantId", "default"), job.get("userId", job.get("ownerId", "unknown"))
    d = f"{WORK}/{job['id']}"
    os.makedirs(f"{d}/out", exist_ok=True)
    base = f"renders/{tenant}/{user}/{job['id']}"
    q = job.get("quality") or {}
    frames = int(q.get("frames", 73))
    prompt = job.get("enrichedPrompt") or job.get("prompt", "")
    t0 = time.time()
    attempts, last_fail, model_id, model = [], [], None, {}
    for attempt in range(int(q.get("maxRerolls", 2)) + 1):
        p = prompt if attempt == 0 else enrich_retry(prompt, attempt)
        seed = 7 + attempt * 1009 + (abs(hash(job["id"])) % 1000)
        model_id, model, raw = generate(job, d, p, seed, frames)
        put_blob(f"{base}/intermediate/attempt{attempt + 1}-raw.mp4", raw, "video/mp4")
        g, fails = motion_check(raw, d, q)
        if not fails:
            worst, sfails = safety_check(d, q)
            fails += [f"content safety: {s}" for s in sfails]
        attempts.append({"attempt": attempt + 1, "seed": seed, "model": model_id, "gate": g, "fails": fails})
        for name in ("first", "middle", "last"):
            put_blob(f"{base}/intermediate/attempt{attempt + 1}-{name}.png", f"{d}/frames/{name}.png", "image/png")
        if not fails:
            break
        last_fail = fails
    else:
        raise RuntimeError("Quality gate: every attempt came out below the motion bar (" + "; ".join(last_fail) + ")")
    grade = (job.get("settings") or {}).get("grade") or q.get("defaultGrade", "teal_orange")
    accent = (job.get("settings") or {}).get("accent", "orange")
    fx("bash", "/fx/postfx.sh", raw, f"{d}/final", grade, accent)
    put_blob(f"{base}/final.mp4", f"{d}/final/final.mp4", "video/mp4")
    for f in os.listdir(f"{d}/final/hls"):
        put_blob(f"{base}/hls/{f}", f"{d}/final/hls/{f}", "application/vnd.apple.mpegurl" if f.endswith(".m3u8") else "video/mp2t")
    wall = time.time() - t0
    cost = round(wall / 3600 * float(model.get("vmHourlyUsd", 0) or 0), 4) if model.get("route") == "worker" else None
    g = attempts[-1]["gate"]
    return {"ok": True, "blob": f"{base}/final.mp4", "hls": f"{base}/hls/index.m3u8", "model": model_id, "seconds": g["seconds"],
            "wallSeconds": round(wall), "costUsd": cost, "motionScore": g["motionScore"], "gate": g, "attempts": attempts, "grade": grade}


def main():
    while True:
        try:
            if busy():
                time.sleep(30)
                continue
            qn, m = next_job()
            if not m:
                time.sleep(20)
                continue
            job = json.loads(base64.b64decode(m["MessageText"]))
            ctx = {"id": job["id"], "projectId": job.get("projectId", "none"), "tenantId": job.get("tenantId", "default"), "userId": job.get("userId", job.get("ownerId")), "worker": VM, "queue": qn}
            q_put("render-done", {**ctx, "running": True})
            try:
                res = run(job)
            except Exception as e:
                res = {"ok": False, "error": str(e)[:900]}
            q_put("render-done", {**ctx, **res})
            q_del(qn, m)
            shutil.rmtree(f"{WORK}/{job['id']}", ignore_errors=True)
        except Exception as e:
            print("worker error:", e, flush=True)
            time.sleep(30)


if __name__ == "__main__":
    main()
