"""The speech and lip-sync side services with ENGINE_MODEL=tiny (no model weights), and the video engine passing
their paths through."""

import base64
import io
import os
import subprocess
import tempfile
import threading
import time
import wave

os.environ.setdefault("ENGINE_MODEL", "tiny")
os.environ["ENGINE_TOKEN"] = "test-token-123456"

import uvicorn  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import lipsync_server  # noqa: E402
import speech_server  # noqa: E402
import voicedesign_server  # noqa: E402

AUTH = {"Authorization": "Bearer test-token-123456"}


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


def tone(seconds: float) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(b"\x00\x10" * int(16000 * seconds))
    return buf.getvalue()


def wait(client: TestClient, path: str) -> dict:
    for _ in range(600):
        s = client.get(path, headers=AUTH).json()
        if s["status"] in ("succeeded", "failed"):
            return s
        time.sleep(0.05)
    raise AssertionError("the job never finished")


def test_speech():
    with TestClient(speech_server.app) as c:
        assert c.post("/v1/speech", json={"text": "hi"}).status_code == 401
        assert c.post("/v1/speech", headers=AUTH, json={"text": "hola", "language": "xx"}).status_code == 400
        assert c.post("/v1/speech", headers=AUTH, json={"mode": "convert", "source": b64(tone(1))}).status_code == 400
        assert "sw" in c.get("/v1/speech/info", headers=AUTH).json()["languages"]
        job = c.post("/v1/speech", headers=AUTH, json={"text": "Hola, ¿cómo estás? Bienvenidos.", "language": "es", "voice": b64(tone(6))}).json()
        s = wait(c, f"/v1/speech/{job['id']}")
        assert s["status"] == "succeeded" and s["cloned"] is True and s["language"] == "es", s
        with wave.open(io.BytesIO(c.get(f"/v1/speech/{job['id']}/file", headers=AUTH).content)) as w:
            assert w.getnframes() / w.getframerate() > 1.5
        job = c.post("/v1/speech", headers=AUTH, json={"mode": "convert", "source": b64(tone(1)), "voice": b64(tone(5))}).json()
        assert wait(c, f"/v1/speech/{job['id']}")["status"] == "succeeded"
        # The voice isolator: a recording, and which part to keep.
        assert c.post("/v1/speech", headers=AUTH, json={"mode": "isolate"}).status_code == 400
        assert c.post("/v1/speech", headers=AUTH, json={"mode": "isolate", "source": b64(tone(1)), "stem": "drums"}).status_code == 422
        job = c.post("/v1/speech", headers=AUTH, json={"mode": "isolate", "source": b64(tone(2)), "stem": "background"}).json()
        s = wait(c, f"/v1/speech/{job['id']}")
        assert s["status"] == "succeeded" and s["stem"] == "background", s
        with wave.open(io.BytesIO(c.get(f"/v1/speech/{job['id']}/file", headers=AUTH).content)) as w:
            assert abs(w.getnframes() / w.getframerate() - 2) < 0.05
        assert "isolate" in c.get("/v1/speech/info", headers=AUTH).json()["modes"]


def test_voice_design():
    with TestClient(voicedesign_server.app) as c:
        assert c.post("/v1/voice-design", headers=AUTH, json={"text": "Hello there."}).status_code == 400
        job = c.post("/v1/voice-design", headers=AUTH, json={"text": "Welcome back to the show, everybody.", "description": "A warm older man, slow and calm."}).json()
        s = wait(c, f"/v1/voice-design/{job['id']}")
        assert s["status"] == "succeeded" and s["designed"] is True, s
        with wave.open(io.BytesIO(c.get(f"/v1/voice-design/{job['id']}/file", headers=AUTH).content)) as w:
            assert w.getnframes() / w.getframerate() > 2


def test_lipsync():
    d = tempfile.mkdtemp()
    mp4 = os.path.join(d, "v.mp4")
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc=s=64x64:r=24:d=1", "-pix_fmt", "yuv420p", mp4], check=True)
    with TestClient(lipsync_server.app) as c:
        assert c.post("/v1/lipsync", headers=AUTH, json={"video": "x"}).status_code == 422
        job = c.post("/v1/lipsync", headers=AUTH, json={"video": b64(open(mp4, "rb").read()), "audio": b64(tone(3))}).json()
        s = wait(c, f"/v1/lipsync/{job['id']}")
        assert s["status"] == "succeeded", s
        out = os.path.join(d, "out.mp4")
        open(out, "wb").write(c.get(f"/v1/lipsync/{job['id']}/file", headers=AUTH).content)
        dur = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out]))
        assert abs(dur - 3) < 0.2  # the 1-second video was looped to the 3 seconds of speech
        streams = subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", out]).decode().split()
        assert streams == ["video", "audio"]
        bad = c.post("/v1/lipsync", headers=AUTH, json={"video": b64(b"not a video at all, sorry"), "audio": b64(tone(1))}).json()
        assert wait(c, f"/v1/lipsync/{bad['id']}")["status"] == "failed"


def test_video_engine_forwards_speech():
    srv = uvicorn.Server(uvicorn.Config(speech_server.app, host="127.0.0.1", port=8766, log_level="warning"))
    threading.Thread(target=srv.run, daemon=True).start()
    while not srv.started:
        time.sleep(0.05)
    os.environ["SPEECH_URL"] = "http://127.0.0.1:8766"
    import importlib

    import server

    importlib.reload(server)
    try:
        with TestClient(server.app) as c:
            job = c.post("/v1/speech", headers=AUTH, json={"text": "Bonjour", "language": "fr"}).json()
            assert wait(c, f"/v1/speech/{job['id']}")["status"] == "succeeded"
            assert c.get(f"/v1/speech/{job['id']}/file", headers=AUTH).content[:4] == b"RIFF"
            # Lip sync isn't running in this test: a clear 503, not a crash.
            r = c.post("/v1/lipsync", headers=AUTH, json={"video": "x", "audio": "y"})
            assert r.status_code == 503 and "lip-sync engine" in r.json()["detail"]
            r = c.post("/v1/voice-design", headers=AUTH, json={"text": "x", "description": "y"})
            assert r.status_code == 503 and "voice-design engine" in r.json()["detail"]
    finally:
        srv.should_exit = True
