"""
Vueio scene worker: one execution of the Container Apps Job renders ONE scene.

KEDA (azure-queue scaler, queueLength 1) starts one execution per waiting message on the "scene-jobs" queue, up to
maxExecutions (3), so a video's scenes render in parallel on separate serverless A100s and nothing runs (or bills)
while the queue is empty. Each execution:

  1. takes one message {"id": <render id>, "scene": <index>} (hidden for 30 minutes while it works),
  2. reads <id>/plan.json and the scene's start/end keyframes from Blob Storage,
  3. runs ComfyUI headless (Wan 2.1 First-Last-Frame-to-Video, FP8 weights, SageAttention) on the weights mounted
     from Azure Files at /models,
  4. encodes the frames to <id>/clips/<scene>.mp4. That upload fires Event Grid, which queues the stitch worker.

Signs in with the job's managed identity (AZURE_CLIENT_ID); no keys. Settings: SCENES_ACCOUNT (storage account),
SCENES_CONTAINER (default "scenes"), SCENE_QUEUE (default "scene-jobs").
"""
from __future__ import annotations

import base64
import copy
import json
import os
import subprocess
import sys
import time
import urllib.request
import uuid
from pathlib import Path

COMFY = Path(os.environ.get("COMFY_DIR", "/opt/ComfyUI"))
WORK = Path(os.environ.get("WORK_DIR", "/tmp/comfy"))
PORT = 8188
WORKFLOW = Path(__file__).parent / "workflows" / "wan21_flf2v_api.json"
NEGATIVE = (
    "blurry, low quality, jpeg artifacts, distorted text, garbled letters, watermark, logo, extra fingers, deformed, "
    "flicker, jitter, noisy, washed out, static frame"
)
GEN_FPS = 16  # Wan 2.1 is trained at 16 fps; the stitch worker conforms to the output rate
MAX_TRIES = 3


def frames_for(seconds: float) -> int:
    """Wan needs 4n+1 frames; 17 (1 s) to 81 (5 s) at 16 fps. Longer scenes are slowed or held by the stitcher."""
    n = round(max(0.1, seconds) * GEN_FPS / 4)
    return max(17, min(81, 4 * n + 1))


def fill_workflow(template: dict, scene: dict, plan: dict, start_name: str, end_name: str, prefix: str) -> dict:
    """The API-format workflow for one scene: its prompt, keyframes, size, length, steps and seed."""
    wf = copy.deepcopy(template)
    gen = plan.get("gen", {})
    wf["5"]["inputs"]["image"] = start_name
    wf["6"]["inputs"]["image"] = end_name
    wf["9"]["inputs"]["text"] = scene["prompt"][:2000]
    wf["10"]["inputs"]["text"] = scene.get("negative") or NEGATIVE
    flf = wf["11"]["inputs"]
    flf["width"] = int(gen.get("width", 720))
    flf["height"] = int(gen.get("height", 1280))
    flf["length"] = frames_for(float(scene.get("seconds", 5)))
    ks = wf["13"]["inputs"]
    ks["seed"] = int(scene.get("seed", 0)) % (2**63)
    ks["steps"] = int(gen.get("steps", 16))
    ks["cfg"] = float(gen.get("cfg", 5.0))
    wf["15"]["inputs"]["filename_prefix"] = prefix
    for k in ("width", "height"):
        if flf[k] % 16:
            raise ValueError(f"{k} must be a multiple of 16, got {flf[k]}")
    return wf


# ── Azure ─────────────────────────────────────────────────────────────────────────────────────────────────────
def clients():
    from azure.identity import ManagedIdentityCredential, DefaultAzureCredential
    from azure.storage.blob import BlobServiceClient
    from azure.storage.queue import QueueClient

    account = os.environ["SCENES_ACCOUNT"]
    cid = os.environ.get("AZURE_CLIENT_ID")
    cred = ManagedIdentityCredential(client_id=cid) if cid else DefaultAzureCredential()
    blobs = BlobServiceClient(f"https://{account}.blob.core.windows.net", credential=cred).get_container_client(
        os.environ.get("SCENES_CONTAINER", "scenes"))
    queue = QueueClient(f"https://{account}.queue.core.windows.net", os.environ.get("SCENE_QUEUE", "scene-jobs"), credential=cred)
    return blobs, queue


def decode(text: str) -> dict:
    """Messages are base64 JSON (what Vueio sends); plain JSON is accepted too."""
    try:
        return json.loads(text)
    except ValueError:
        return json.loads(base64.b64decode(text))


# ── ComfyUI ───────────────────────────────────────────────────────────────────────────────────────────────────
def start_comfy() -> subprocess.Popen:
    for d in ("in", "out", "temp", "user"):
        (WORK / d).mkdir(parents=True, exist_ok=True)
    args = [
        sys.executable, str(COMFY / "main.py"), "--listen", "127.0.0.1", "--port", str(PORT),
        "--disable-auto-launch", "--use-sage-attention", "--bf16-unet",
        "--extra-model-paths-config", str(Path(__file__).parent / "extra_model_paths.yaml"),
        "--input-directory", str(WORK / "in"), "--output-directory", str(WORK / "out"),
        "--temp-directory", str(WORK / "temp"), "--user-directory", str(WORK / "user"),
    ]
    return subprocess.Popen(args, cwd=COMFY)


def api(path: str, body: dict | None = None, timeout: float = 30):
    req = urllib.request.Request(f"http://127.0.0.1:{PORT}{path}", data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json"}, method="POST" if body is not None else "GET")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def wait_ready(proc: subprocess.Popen, seconds: int = 600):
    t = time.time()
    while time.time() - t < seconds:
        if proc.poll() is not None:
            raise RuntimeError(f"ComfyUI exited with {proc.returncode}")
        try:
            api("/system_stats", timeout=5)
            return
        except Exception:
            time.sleep(1)
    raise RuntimeError("ComfyUI did not start in time")


def run_workflow(wf: dict, seconds: int = 1700) -> list[Path]:
    pid = api("/prompt", {"prompt": wf, "client_id": str(uuid.uuid4())})["prompt_id"]
    t = time.time()
    while time.time() - t < seconds:
        h = api(f"/history/{pid}").get(pid)
        if h:
            status = h.get("status", {})
            if status.get("status_str") == "error":
                raise RuntimeError(f"ComfyUI failed: {json.dumps(status.get('messages', []))[:800]}")
            images = [i for o in h.get("outputs", {}).values() for i in o.get("images", [])]
            if images:
                return [WORK / "out" / i.get("subfolder", "") / i["filename"] for i in images]
        time.sleep(2)
    raise RuntimeError("the scene took too long")


def encode(frames: list[Path], out: Path):
    """Frames → H.264 at the model's 16 fps, near-lossless (the stitcher re-encodes once at the end)."""
    lst = out.with_suffix(".txt")
    lst.write_text("".join(f"file '{f}'\nduration {1 / GEN_FPS:.6f}\n" for f in sorted(frames)))
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(lst),
                    "-r", str(GEN_FPS), "-c:v", "libx264", "-preset", "veryfast", "-crf", "14", "-pix_fmt", "yuv420p", str(out)], check=True)


def main():
    blobs, queue = clients()
    msgs = queue.receive_messages(messages_per_page=1, visibility_timeout=1800)
    msg = next(iter(msgs), None)
    if msg is None:
        print("queue empty; nothing to do")
        return
    job = decode(msg.content)
    rid, i = job["id"], int(job["scene"])
    try:
        plan = json.loads(blobs.download_blob(f"{rid}/plan.json").readall())
        scene = plan["scenes"][i]
        WORK.mkdir(parents=True, exist_ok=True)
        (WORK / "in").mkdir(parents=True, exist_ok=True)
        start_name, end_name = f"{rid}-{i}-start.png", f"{rid}-{i}-end.png"
        (WORK / "in" / start_name).write_bytes(blobs.download_blob(scene["start"]).readall())
        (WORK / "in" / end_name).write_bytes(blobs.download_blob(scene["end"]).readall())
        proc = start_comfy()
        try:
            wait_ready(proc)
            t = time.time()
            frames = run_workflow(fill_workflow(json.loads(WORKFLOW.read_text()), scene, plan, start_name, end_name, f"{rid}/{i}"))
            out = WORK / f"{rid}-{i}.mp4"
            encode(frames, out)
            print(f"scene {i}: {len(frames)} frames in {time.time() - t:.0f}s")
        finally:
            proc.terminate()
        with open(out, "rb") as fh:
            blobs.upload_blob(f"{rid}/clips/{i}.mp4", fh, overwrite=True)  # fires Event Grid → stitch queue
        queue.delete_message(msg)
    except Exception as e:  # noqa: BLE001
        print(f"scene {i} of {rid} failed (try {msg.dequeue_count}): {e}", file=sys.stderr)
        if msg.dequeue_count >= MAX_TRIES:
            blobs.upload_blob(f"{rid}/failed/{i}.json", json.dumps({"scene": i, "error": str(e)[:1000]}), overwrite=True)
            queue.delete_message(msg)
        raise


if __name__ == "__main__":
    main()
