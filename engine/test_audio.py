"""End-to-end check of the audio engine with ENGINE_MODEL=tiny (tones instead of the real models), and of the video
engine passing /v1/audio through to it."""

import io
import os
import threading
import time
import wave

os.environ.setdefault("ENGINE_MODEL", "tiny")
os.environ["ENGINE_TOKEN"] = "test-token-123456"

import uvicorn  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import audio_server  # noqa: E402

AUTH = {"Authorization": "Bearer test-token-123456"}


def wait(client: TestClient, job_id: str) -> dict:
    for _ in range(300):
        s = client.get(f"/v1/audio/{job_id}", headers=AUTH).json()
        if s["status"] in ("succeeded", "failed"):
            return s
        time.sleep(0.05)
    raise AssertionError("the job never finished")


def test_audio_engine():
    with TestClient(audio_server.app) as client:
        assert client.post("/v1/audio", json={"kind": "music", "prompt": "x"}).status_code == 401
        assert client.post("/v1/audio", headers=AUTH, json={"kind": "speech", "prompt": "x"}).status_code == 422
        assert client.post("/v1/audio", headers=AUTH, json={"kind": "sfx", "prompt": "x", "seconds": 45}).status_code == 400
        info = client.get("/v1/audio/info", headers=AUTH).json()
        assert info["limits"]["music"]["max"] == 240
        for body in ({"kind": "music", "prompt": "warm lo-fi piano", "seconds": 3, "bpm": 84}, {"kind": "sfx", "prompt": "door slam", "seconds": 1.5}):
            job = client.post("/v1/audio", headers=AUTH, json=body).json()
            s = wait(client, job["id"])
            assert s["status"] == "succeeded", s
            if body["kind"] == "music":
                assert s["bpm"] == 84
            wav = client.get(f"/v1/audio/{job['id']}/file", headers=AUTH)
            assert wav.headers["content-type"] == "audio/wav"
            with wave.open(io.BytesIO(wav.content)) as w:
                assert (w.getnchannels(), w.getframerate()) == (2, 48000)
                assert abs(w.getnframes() / 48000 - body["seconds"]) < 0.01
        assert client.get("/v1/audio/nope", headers=AUTH).status_code == 404


def test_video_engine_forwards_audio():
    config = uvicorn.Config(audio_server.app, host="127.0.0.1", port=8765, log_level="warning")
    srv = uvicorn.Server(config)
    threading.Thread(target=srv.run, daemon=True).start()
    while not srv.started:
        time.sleep(0.05)
    os.environ["AUDIO_URL"] = "http://127.0.0.1:8765"
    import importlib

    import server

    importlib.reload(server)
    try:
        with TestClient(server.app) as client:
            assert client.post("/v1/audio", json={"kind": "sfx", "prompt": "x"}).status_code == 401
            job = client.post("/v1/audio", headers=AUTH, json={"kind": "sfx", "prompt": "rain on a tin roof", "seconds": 1}).json()
            for _ in range(300):
                s = client.get(f"/v1/audio/{job['id']}", headers=AUTH).json()
                if s["status"] == "succeeded":
                    break
                time.sleep(0.05)
            assert s["status"] == "succeeded", s
            wav = client.get(f"/v1/audio/{job['id']}/file", headers=AUTH)
            assert wav.status_code == 200 and wav.content[:4] == b"RIFF"
            assert client.get("/v1/audio/missing", headers=AUTH).status_code == 404
    finally:
        srv.should_exit = True
