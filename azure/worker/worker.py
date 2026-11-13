#!/usr/bin/env python3
"""
Ghost Post render worker (runs on each render VM as a systemd service).

Takes jobs from the "render-work" queue, runs them, uploads the result to Blob Storage and reports to "render-done".
Authenticates with the VM's managed identity through the Azure Instance Metadata Service: no keys on the machine.
Waits while other containers are running, so it never fights an existing job for the CPU.

Job kinds:
  ltx-image-to-video  {imageBlob:"container/path.jpg", prompt, settings:{frames, steps, seed}}
"""
import base64, json, os, shutil, socket, subprocess, time, urllib.parse, urllib.request

ACCOUNT = os.environ.get("STORAGE_ACCOUNT", "ghostpostmedia133314")
QURL = f"https://{ACCOUNT}.queue.core.windows.net"
BURL = f"https://{ACCOUNT}.blob.core.windows.net"
WORK = os.environ.get("WORK_DIR", "/workq")
HF = os.environ.get("HF_CACHE", "/work/hf")
RUNPY = os.environ.get("RUNPY", "/work3/run.py")
VM = socket.gethostname()
_tok = {}


def token(resource="https://storage.azure.com/"):
    t = _tok.get(resource)
    if t and t["exp"] - 300 > time.time():
        return t["v"]
    q = urllib.parse.urlencode({"api-version": "2018-02-01", "resource": resource})
    req = urllib.request.Request(f"http://169.254.169.254/metadata/identity/oauth2/token?{q}", headers={"Metadata": "true"})
    d = json.load(urllib.request.urlopen(req, timeout=10))
    _tok[resource] = {"v": d["access_token"], "exp": int(d["expires_on"])}
    return d["access_token"]


def call(method, url, data=None, headers=None):
    h = {"Authorization": f"Bearer {token()}", "x-ms-version": "2023-11-03", **(headers or {})}
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    with urllib.request.urlopen(req, timeout=600) as r:
        return r.read()


def queue_get(name, visibility=7200):
    import xml.etree.ElementTree as ET
    x = ET.fromstring(call("GET", f"{QURL}/{name}/messages?numofmessages=1&visibilitytimeout={visibility}"))
    m = x.find("QueueMessage")
    if m is None:
        return None
    return {k: m.findtext(k) for k in ("MessageId", "PopReceipt", "MessageText", "DequeueCount")}


def queue_put(name, obj):
    text = base64.b64encode(json.dumps(obj).encode()).decode()
    call("POST", f"{QURL}/{name}/messages", f"<QueueMessage><MessageText>{text}</MessageText></QueueMessage>".encode(), {"Content-Type": "application/xml"})


def queue_delete(name, m):
    call("DELETE", f"{QURL}/{name}/messages/{m['MessageId']}?popreceipt={urllib.parse.quote(m['PopReceipt'])}")


def busy():
    out = subprocess.run(["docker", "ps", "-q"], capture_output=True, text=True).stdout.strip()
    return bool(out)


def ltx(job, d):
    s = job.get("settings") or {}
    os.makedirs(f"{d}/out", exist_ok=True)
    with open(f"{d}/1.jpg", "wb") as f:
        f.write(call("GET", f"{BURL}/{job['imageBlob']}"))
    json.dump([{"image": "1.jpg", "prompt": job.get("prompt", "")}], open(f"{d}/shots.json", "w"))
    import re
    src = re.sub(r"/work\d?/", f"{d}/", open(RUNPY).read()).replace(f'subprocess.run(["sh","{d}/up.sh",dst])', "pass")
    open(f"{d}/run.py", "w").write(src)
    env = ["-e", f"FRAMES={int(s.get('frames', 33))}"]
    subprocess.run(["docker", "run", "--rm", *env, "-v", f"{d}:{d}", "-v", f"{HF}:/root/.cache/huggingface", "ltxcpu", "python", "-u", f"{d}/run.py"],
                   check=True, stdout=open(f"{d}/run.log", "w"), stderr=subprocess.STDOUT, timeout=4 * 3600)
    return f"{d}/out/clip1.mp4"


KINDS = {"ltx-image-to-video": ltx}


def main():
    while True:
        try:
            if busy():
                time.sleep(30)
                continue
            m = queue_get("render-work")
            if not m:
                time.sleep(20)
                continue
            job = json.loads(base64.b64decode(m["MessageText"]))
            d = f"{WORK}/{job['id']}"
            os.makedirs(d, exist_ok=True)
            queue_put("render-done", {"id": job["id"], "projectId": job.get("projectId", "none"), "running": True, "worker": VM})
            t = time.time()
            try:
                out = KINDS[job["kind"]](job, d)
                blob = f"renders/jobs/{job.get('projectId', 'none')}/{job['id']}.mp4"
                call("PUT", f"{BURL}/{blob}", open(out, "rb").read(), {"x-ms-blob-type": "BlockBlob", "x-ms-blob-content-type": "video/mp4"})
                queue_put("render-done", {"id": job["id"], "projectId": job.get("projectId", "none"), "ok": True, "blob": blob, "worker": VM, "seconds": round(time.time() - t)})
            except Exception as e:  # report the failure; the job's record says what went wrong
                queue_put("render-done", {"id": job["id"], "projectId": job.get("projectId", "none"), "ok": False, "error": str(e)[:900], "worker": VM, "seconds": round(time.time() - t)})
            queue_delete("render-work", m)
            shutil.rmtree(d, ignore_errors=True)
        except Exception as e:
            print("worker error:", e, flush=True)
            time.sleep(30)


if __name__ == "__main__":
    main()
