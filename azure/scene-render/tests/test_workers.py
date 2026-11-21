"""Worker tests with the real ffmpeg: python3 -m unittest discover -s azure/scene-render/tests (from the repo root)."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path[:0] = [str(HERE.parent / "gpu-worker"), str(HERE.parent / "stitch-worker")]
os.environ.setdefault("FONTS_DIR", str(ROOT / "assets" / "fonts"))
import stitch  # noqa: E402
import worker  # noqa: E402


def probe(f, entries):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", entries, "-of", "json", f], capture_output=True, text=True, check=True)
    return json.loads(r.stdout)


class GpuWorker(unittest.TestCase):
    def test_frames_are_4n_plus_1_within_wan_limits(self):
        self.assertEqual(worker.frames_for(5), 81)
        self.assertEqual(worker.frames_for(9), 81)
        self.assertEqual(worker.frames_for(0.2), 17)
        self.assertEqual(worker.frames_for(2.5), 41)
        for s in (0.5, 1.3, 3.7, 4.9):
            self.assertEqual((worker.frames_for(s) - 1) % 4, 0)

    def test_workflow_is_filled_for_the_scene(self):
        tpl = json.loads(worker.WORKFLOW.read_text())
        wf = worker.fill_workflow(tpl, {"prompt": "neon shapes", "seconds": 3, "seed": 7}, {"gen": {"width": 720, "height": 1280, "steps": 12}}, "a.png", "b.png", "r1/0")
        self.assertEqual(wf["5"]["inputs"]["image"], "a.png")
        self.assertEqual(wf["6"]["inputs"]["image"], "b.png")
        self.assertEqual(wf["9"]["inputs"]["text"], "neon shapes")
        self.assertEqual(wf["11"]["inputs"]["length"], 49)
        self.assertEqual(wf["13"]["inputs"]["steps"], 12)
        self.assertEqual(wf["13"]["inputs"]["seed"], 7)
        self.assertEqual(wf["15"]["inputs"]["filename_prefix"], "r1/0")
        self.assertEqual(tpl["5"]["inputs"]["image"], "__START_IMAGE__")  # the template is untouched
        with self.assertRaises(ValueError):
            worker.fill_workflow(tpl, {"prompt": "x"}, {"gen": {"width": 721}}, "a", "b", "p")
        # Every node input that links to another node points at a node that exists.
        for node in wf.values():
            for v in node["inputs"].values():
                if isinstance(v, list):
                    self.assertIn(v[0], wf)

    def test_messages_decode_as_base64_or_plain_json(self):
        import base64
        self.assertEqual(worker.decode(base64.b64encode(b'{"id":"r","scene":2}').decode()), {"id": "r", "scene": 2})
        self.assertEqual(worker.decode('{"id":"r","scene":1}')["scene"], 1)


class Stitch(unittest.TestCase):
    def test_render_id_from_event_grid_event(self):
        ev = {"subject": "/blobServices/default/containers/scenes/blobs/post_1-abc/clips/2.mp4", "eventType": "Microsoft.Storage.BlobCreated"}
        self.assertEqual(stitch.render_id_from_event(json.dumps(ev)), "post_1-abc")
        self.assertEqual(stitch.render_id_from_event(json.dumps([ev])), "post_1-abc")
        self.assertIsNone(stitch.render_id_from_event(json.dumps({"subject": "/blobServices/default/containers/scenes/blobs/x/final.mp4"})))

    def test_conform_slows_then_holds(self):
        self.assertEqual(stitch.conform(5, 5), (1.0, 0.0))
        f, hold = stitch.conform(5, 9)
        self.assertEqual(f, 1.5)
        self.assertAlmostEqual(hold, 1.5)
        self.assertEqual(stitch.offsets([2.5, 3, 1.5]), [0.0, 2.5, 5.5])

    def test_stitches_clips_text_and_voice_with_ffmpeg(self):
        with tempfile.TemporaryDirectory() as d:
            clips, secs = [], [5.06, 3.06, 2.06]
            for k, s in enumerate(secs):
                c = os.path.join(d, f"{k}.mp4")
                subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"testsrc2=s=720x1280:r=16:d={s}", "-pix_fmt", "yuv420p", c], check=True)
                clips.append(c)
            voice = os.path.join(d, "vo.wav")
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=f=220:d=7", voice], check=True)
            plan = {
                "size": {"width": 540, "height": 960},
                "scenes": [{"seconds": 4.0}, {"seconds": 4.2}, {"seconds": 1.8}],
                "transition": {"type": "smoothleft", "seconds": 0.35},
                "overlays": [
                    {"scene": 0, "text": "MONEY GROWS", "start": 0.3, "end": 3.6, "y": 0.14, "size": 0.1, "bar": True},
                    {"scene": 1, "text": "It's: 100% \"yours\"", "font": "body", "start": 0.2, "end": 3.9, "y": 0.8, "size": 0.05, "x": "left"},
                ],
            }
            out = os.path.join(d, "final.mp4")
            subprocess.run(stitch.build_command(plan, clips, secs, voice, out, d), check=True)
            info = probe(out, "stream=codec_type,width,height,r_frame_rate:format=duration")
            v = [s for s in info["streams"] if s["codec_type"] == "video"][0]
            self.assertEqual((v["width"], v["height"], v["r_frame_rate"]), (540, 960, "30/1"))
            self.assertTrue(any(s["codec_type"] == "audio" for s in info["streams"]))
            self.assertAlmostEqual(float(info["format"]["duration"]), 10.0, delta=0.15)
            if os.environ.get("STITCH_SAMPLE"):
                import shutil
                shutil.copy(out, os.environ["STITCH_SAMPLE"])


if __name__ == "__main__":
    unittest.main()
