"""End-to-end check of the engine with a tiny random model (no GPU, no download of the real weights)."""

import base64
import io
import os
import subprocess
import time

# Run once per profile: ENGINE_MODEL=tiny (fast, TI2V-5B) and ENGINE_MODEL=tiny-best (I2V-A14B, two experts).
os.environ.setdefault("ENGINE_MODEL", "tiny")
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
            profile = server.MAIN if body.get("image") else server.TEXT
            job = client.post("/v1/videos", headers=AUTH, json=body).json()
            s = wait(client, job["id"])
            assert s["status"] == "succeeded", s
            mp4 = client.get(f"/v1/videos/{job['id']}/file", headers=AUTH)
            assert mp4.status_code == 200 and mp4.headers["content-type"] == "video/mp4"
            out = tmp_path / f"{job['id']}.mp4"
            out.write_bytes(mp4.content)
            probe = subprocess.run(["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", str(out)], capture_output=True, text=True)
            assert int(probe.stdout.strip()) == server.clip_frames(1, profile)  # 4n+1 frames at the profile's fps


def test_clip_lengths_and_sizes():
    best, fast = server.PROFILES["best"], server.PROFILES["fast"]
    assert server.clip_frames(5, best) == 81 and server.clip_frames(5, fast) == 121
    assert server.clip_frames(0.2, fast) == 17 and server.clip_frames(2, fast) == 49
    if not server.TINY:
        # The models' native 720p sizes.
        assert server.size_for("9:16", best) == (720, 1280) and server.size_for("16:9", best) == (1280, 720)
        assert server.size_for("9:16", fast) == (704, 1280) and server.size_for("16:9", fast) == (1280, 704)


def test_pictures(tmp_path):
    with TestClient(server.app) as client:
        for _ in range(600):
            if client.get("/v1/info", headers=AUTH).json()["ready"]:
                break
            time.sleep(0.2)
        assert client.post("/v1/images", headers=AUTH, json={"prompt": "x", "aspect": "5:2"}).status_code == 400
        assert client.post("/v1/images", headers=AUTH, json={"prompt": "x", "images": ["bm90IGFuIGltYWdl"]}).status_code == 400
        assert client.post("/v1/images", headers=AUTH, json={"prompt": "x", "images": [picture()] * 4}).status_code == 422
        # From the prompt alone, and an edit that puts a reference picture into a new scene.
        for body in ({"prompt": "a kitchen at night", "aspect": "9:16"}, {"prompt": "the woman in picture 1 at a desk", "images": [picture()], "aspect": "1:1"}):
            job = client.post("/v1/images", headers=AUTH, json=body).json()
            for _ in range(600):
                s = client.get(f"/v1/images/{job['id']}", headers=AUTH).json()
                if s["status"] in ("succeeded", "failed"):
                    break
                time.sleep(0.1)
            assert s["status"] == "succeeded", s
            png = client.get(f"/v1/images/{job['id']}/file", headers=AUTH)
            assert png.status_code == 200 and png.headers["content-type"] == "image/png"
            assert Image.open(io.BytesIO(png.content)).size == (64, 64)
        # A video job's id doesn't serve a picture.
        assert client.get(f"/v1/images/{'0' * 32}/file", headers=AUTH).status_code == 404


def test_picture_sizes():
    # Qwen-Image's native sizes; every side is a multiple of 16.
    assert server.IMAGE_SIZES["9:16"] == (928, 1664) and server.IMAGE_SIZES["16:9"] == (1664, 928)
    assert all(w % 16 == 0 and h % 16 == 0 for w, h in server.IMAGE_SIZES.values())
