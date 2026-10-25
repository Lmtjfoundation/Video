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


def test_writing():
    with TestClient(server.app) as client:
        assert client.post("/v1/chat", json={"user": "hi"}).status_code == 401
        assert client.post("/v1/chat", headers=AUTH, json={"user": ""}).status_code == 422
        r = client.post("/v1/chat", headers=AUTH, json={"system": "You write.", "user": "Plan a series.", "max_tokens": 50})
        assert r.status_code == 200 and r.json()["text"] == '{"echo": 14, "system": 10}'
        assert client.get("/v1/info", headers=AUTH).json()["text_model_writer"] == server.WRITER


def test_picture_tools():
    with TestClient(server.app) as client:
        assert client.post("/v1/images", headers=AUTH, json={"op": "upscale"}).status_code == 400
        assert client.post("/v1/images", headers=AUTH, json={"op": "blur", "images": [picture()]}).status_code == 422
        assert client.post("/v1/images", headers=AUTH, json={"prompt": " "}).status_code == 400
        job = client.post("/v1/images", headers=AUTH, json={"op": "upscale", "images": [picture()]}).json()
        assert wait(client, job["id"])["status"] == "succeeded"
        up = Image.open(io.BytesIO(client.get(f"/v1/images/{job['id']}/file", headers=AUTH).content))
        assert up.size == (1200, 2000)  # 300 x 500, four times
        job = client.post("/v1/images", headers=AUTH, json={"op": "upscale", "scale": 2, "images": [picture()]}).json()
        assert wait(client, job["id"])["status"] == "succeeded"
        assert Image.open(io.BytesIO(client.get(f"/v1/images/{job['id']}/file", headers=AUTH).content)).size == (600, 1000)
        job = client.post("/v1/images", headers=AUTH, json={"op": "remove-bg", "images": [picture()]}).json()
        assert wait(client, job["id"])["status"] == "succeeded"
        cut = Image.open(io.BytesIO(client.get(f"/v1/images/{job['id']}/file", headers=AUTH).content))
        assert cut.mode == "RGBA" and cut.getpixel((10, 10))[3] == 255 and cut.getpixel((290, 10))[3] == 0


def clip(path) -> str:
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=s=320x180:r=24:d=1", "-pix_fmt", "yuv420p", str(path)], check=True)
    return base64.b64encode(path.read_bytes()).decode()


def test_video_edits(tmp_path):
    video = clip(tmp_path / "in.mp4")
    with TestClient(server.app) as client:
        assert client.post("/v1/video-edits", headers=AUTH, json={"task": "motion", "video": video, "prompt": "dance"}).status_code == 400
        assert client.post("/v1/video-edits", headers=AUTH, json={"task": "explode", "video": video, "prompt": "x"}).status_code == 422
        for task, extra in [("restyle", {}), ("motion", {"image": picture()}), ("background", {}), ("inpaint", {"box": [0.1, 0.1, 0.3, 0.3]})]:
            job = client.post("/v1/video-edits", headers=AUTH, json={"task": task, "video": video, "prompt": "A watercolor painting", **extra}).json()
            s = None
            for _ in range(300):
                s = client.get(f"/v1/video-edits/{job['id']}", headers=AUTH).json()
                if s["status"] in ("succeeded", "failed"):
                    break
                time.sleep(0.1)
            assert s["status"] == "succeeded", (task, s)
            out = tmp_path / f"{task}.mp4"
            out.write_bytes(client.get(f"/v1/video-edits/{job['id']}/file", headers=AUTH).content)
            frames = subprocess.run(["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", str(out)], capture_output=True, text=True).stdout.strip()
            assert frames == "9", (task, frames)


def test_tools_profile_without_gpu(monkeypatch):
    """ENGINE_PROFILE=tools: no big model loads; upscale and cut-outs work; everything else says it needs a GPU."""
    import importlib

    monkeypatch.setenv("ENGINE_PROFILE", "tools")
    tools = importlib.reload(server)
    try:
        with TestClient(tools.app) as client:
            info = client.get("/v1/info", headers=AUTH).json()
            assert info["profile"] == "tools" and info["ready"] is True
            assert info["capabilities"] == ["upscale", "remove-bg", "isolate"]
            assert tools.engine.i2v is None  # the video model was never loaded
            for path, body in [("/v1/videos", {"prompt": "x"}), ("/v1/images", {"prompt": "a cat"}), ("/v1/chat", {"user": "hi"})]:
                r = client.post(path, headers=AUTH, json=body)
                assert r.status_code == 503 and "without a GPU" in r.json()["detail"], (path, r.text)
            job = client.post("/v1/images", headers=AUTH, json={"op": "upscale", "scale": 2, "images": [picture()]}).json()
            assert wait(client, job["id"])["status"] == "succeeded"
            job = client.post("/v1/images", headers=AUTH, json={"op": "remove-bg", "images": [picture()]}).json()
            assert wait(client, job["id"])["status"] == "succeeded"
    finally:
        monkeypatch.delenv("ENGINE_PROFILE")
        importlib.reload(server)
