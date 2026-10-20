"""End-to-end check of the engine with a tiny random model (no GPU, no download of the real weights)."""

import base64
import io
import os
import subprocess
import time

os.environ["ENGINE_MODEL"] = "tiny"
os.environ["ENGINE_TOKEN"] = "test-token-123456"

from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402

import server  # noqa: E402

AUTH = {"Authorization": "Bearer test-token-123456"}


def picture() -> str:
    buf = io.BytesIO()
    Image.new("RGB", (300, 500), (200, 40, 40)).save(buf, "PNG")
    return base64.b64encode(buf.getvalue()).decode()


def wait(client: TestClient, job_id: str) -> dict:
    for _ in range(600):
        s = client.get(f"/v1/videos/{job_id}", headers=AUTH).json()
        if s["status"] in ("succeeded", "failed"):
            return s
        time.sleep(0.2)
    raise AssertionError("the job never finished")


def test_engine_end_to_end(tmp_path):
    with TestClient(server.app) as client:
        assert client.get("/health").json() == {"ok": True}
        assert client.get("/v1/info").status_code == 401
        assert client.get("/v1/info", headers={"Authorization": "Bearer wrong"}).status_code == 401
        for _ in range(600):
            info = client.get("/v1/info", headers=AUTH).json()
            if info["ready"] or info["error"]:
                break
            time.sleep(0.2)
        assert info["ready"], info

        assert client.post("/v1/videos", headers=AUTH, json={"prompt": "x", "aspect": "5:2"}).status_code == 400
        assert client.post("/v1/videos", headers=AUTH, json={"prompt": "x", "image": "bm90IGFuIGltYWdl"}).status_code == 400

        # From a first frame (image to video) and from the prompt alone (text to video).
        for body in (
            {"prompt": "she turns toward the window, rain outside", "image": picture(), "aspect": "9:16", "seconds": 1, "steps": 4, "seed": 1},
            {"prompt": "a truck's headlights in the rain", "aspect": "16:9", "seconds": 1, "steps": 4},
        ):
            job = client.post("/v1/videos", headers=AUTH, json=body).json()
            s = wait(client, job["id"])
            assert s["status"] == "succeeded", s
            mp4 = client.get(f"/v1/videos/{job['id']}/file", headers=AUTH)
            assert mp4.status_code == 200 and mp4.headers["content-type"] == "video/mp4"
            out = tmp_path / f"{job['id']}.mp4"
            out.write_bytes(mp4.content)
            probe = subprocess.run(["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", str(out)], capture_output=True, text=True)
            assert int(probe.stdout.strip()) == 25  # 1 second at 24 fps, rounded to 4n+1 frames


def test_clip_lengths():
    assert server.clip_frames(5) == 121
    assert server.clip_frames(0.2) == 17
    assert server.clip_frames(2) == 49
