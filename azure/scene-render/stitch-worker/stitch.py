"""
Vueio stitch worker (CPU, Container Apps Job): composites the final MP4 the moment the last scene clip lands.

Every clip upload to <id>/clips/<n>.mp4 fires an Event Grid BlobCreated event into the "stitch-jobs" queue; KEDA
starts one execution per event. An execution that finds clips still missing exits in seconds. The one that sees
them all takes a lock blob (so two near-simultaneous last clips can't stitch twice) and:

  - conforms each clip to its scene's length (slowed up to 1.5x, then the last frame held) at the output frame rate,
  - scales to the output size (4K by default) with Lanczos, and joins scenes with smooth xfade transitions,
  - draws the motion-graphic typography from the plan (text rendered at output resolution, so it stays sharp,
    sliding and fading in on its keyframes), accent bars, and an optional logo,
  - lays the Azure AI Speech voiceover on top and encodes H.264 with -preset veryfast,
  - uploads <id>/final.mp4 and <id>/status.json, which Vueio is waiting for.
"""
from __future__ import annotations

import base64
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

FONTS = Path(os.environ.get("FONTS_DIR", "/app/fonts"))
FONT = {"display": "BebasNeue-Regular.ttf", "body": "Poppins-Bold.ttf"}
OUT_FPS = 30


def hexcolor(c: str, default: str = "FFFFFF") -> str:
    c = (c or "").lstrip("#")
    return c.upper() if len(c) == 6 and all(x in "0123456789abcdefABCDEF" for x in c) else default


def conform(clip_seconds: float, scene_seconds: float) -> tuple[float, float]:
    """(setpts factor, seconds to hold the last frame) that make a clip last exactly the scene."""
    if clip_seconds <= 0:
        return 1.0, scene_seconds
    factor = min(1.5, max(0.5, scene_seconds / clip_seconds))
    hold = max(0.0, scene_seconds - clip_seconds * factor)
    return factor, hold


def offsets(durations: list[float]) -> list[float]:
    """Scene start times; with each non-last clip extended by the transition, xfade k starts at sum(d[:k])."""
    out, t = [], 0.0
    for d in durations:
        out.append(round(t, 3))
        t += d
    return out


def esc_path(p: str) -> str:
    return p.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")


def build_command(plan: dict, clips: list[str], clip_seconds: list[float], voice: str | None, out: str, workdir: str) -> list[str]:
    """The whole ffmpeg command: inputs, the filter graph, and the encode. Pure (writes only the text files)."""
    W, H = int(plan["size"]["width"]), int(plan["size"]["height"])
    scenes = plan["scenes"]
    durs = [max(0.5, float(s["seconds"])) for s in scenes]
    tr = plan.get("transition", {})
    T = max(0.0, min(1.0, float(tr.get("seconds", 0.35))))
    kind = tr.get("type", "fade") if tr.get("type") in ("fade", "fadeblack", "slideleft", "slideup", "circleopen", "smoothleft", "dissolve", "wipeleft") else "fade"
    n = len(clips)
    args = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y"]
    for c in clips:
        args += ["-i", c]
    if voice:
        args += ["-i", voice]
    logo = plan.get("logo")
    if logo:
        args += ["-i", logo]
    parts = []
    for k in range(n):
        ext = T if k < n - 1 else 0.0
        factor, hold = conform(clip_seconds[k], durs[k])
        parts.append(
            f"[{k}:v]setpts={factor:.4f}*(PTS-STARTPTS),fps={OUT_FPS},"
            f"scale={W}:{H}:force_original_aspect_ratio=increase:flags=lanczos,crop={W}:{H},setsar=1,format=yuv420p,"
            f"tpad=stop_mode=clone:stop_duration={hold + ext + 0.1:.3f},trim=duration={durs[k] + ext:.3f},setpts=PTS-STARTPTS[v{k}]"
        )
    starts = offsets(durs)
    last = "v0"
    for k in range(1, n):
        lbl = f"x{k}"
        parts.append(f"[{last}][v{k}]xfade=transition={kind}:duration={T:.3f}:offset={starts[k]:.3f}[{lbl}]" if T > 0 else f"[{last}][v{k}]concat=n=2:v=1:a=0[{lbl}]")
        last = lbl
    # Typography: each overlay's text from a file (no escaping problems), sized and placed against the 4K frame.
    draw = []
    for j, o in enumerate(plan.get("overlays", [])):
        k = int(o.get("scene", 0))
        if k >= n or not str(o.get("text", "")).strip():
            continue
        t0 = starts[k] + max(0.0, float(o.get("start", 0.2)))
        t1 = min(starts[k] + durs[k], starts[k] + float(o.get("end", durs[k] - 0.2)))
        if t1 - t0 < 0.3:
            continue
        txt = Path(workdir) / f"overlay{j}.txt"
        txt.write_text(str(o["text"])[:120])
        size = max(0.02, min(0.2, float(o.get("size", 0.07))))
        fs = round(size * W)
        font = esc_path(str(FONTS / FONT.get(o.get("font", "display"), FONT["display"])))
        color = hexcolor(o.get("color", "FFFFFF"))
        y0 = max(0.04, min(0.92, float(o.get("y", 0.12)))) * H
        slide = round(0.025 * H) if o.get("style", "slide-up") == "slide-up" else 0
        a_in, a_out = f"min(1,max(0,(t-{t0:.3f})/0.3))", f"min(1,max(0,({t1:.3f}-t)/0.3))"
        y = f"{y0:.1f}+{slide}*(1-min(1,max(0,(t-{t0:.3f})/0.35)))^3"
        x = {"left": f"{0.07 * W:.0f}", "right": f"w-text_w-{0.07 * W:.0f}"}.get(o.get("x", "center"), "(w-text_w)/2")
        border = max(2, round(W / 540))
        draw.append(
            f"drawtext=fontfile='{font}':textfile='{esc_path(str(txt))}':expansion=none:fontsize={fs}:fontcolor=0x{color}:"
            f"borderw={border}:bordercolor=black@0.55:x={x}:y='{y}':alpha='{a_in}*{a_out}':enable='between(t,{t0:.3f},{t1:.3f})'"
        )
        if o.get("bar"):
            accent = hexcolor(o.get("accent", "3EF0A8"), "3EF0A8")
            bw, bh = round(W * 0.22), max(4, round(H * 0.006))
            draw.append(f"drawbox=x=(iw-{bw})/2:y={y0 + fs * 1.15:.0f}:w={bw}:h={bh}:color=0x{accent}@0.95:t=fill:enable='between(t,{t0 + 0.15:.3f},{t1:.3f})'")
    vout = last
    if draw:
        parts.append(f"[{last}]" + ",".join(draw) + "[vt]")
        vout = "vt"
    if logo:
        li = n + (1 if voice else 0)
        lw = round(W * 0.14)
        parts.append(f"[{li}:v]scale={lw}:-1[lg];[{vout}][lg]overlay=W-w-{round(W * 0.05)}:{round(H * 0.04)}:format=auto[vl]")
        vout = "vl"
    total = sum(durs)
    if voice:
        parts.append(f"[{n}:a]aresample=48000,apad,atrim=duration={total:.3f},asetpts=PTS-STARTPTS[a]")
    args += ["-filter_complex", ";".join(parts), "-map", f"[{vout}]"]
    if voice:
        args += ["-map", "[a]", "-c:a", "aac", "-b:a", "192k"]
    args += ["-t", f"{total:.3f}", "-r", str(OUT_FPS), "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
             "-pix_fmt", "yuv420p", "-movflags", "+faststart", out]
    return args


def probe_seconds(f: str) -> float:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], capture_output=True, text=True, check=True)
    return float(r.stdout.strip() or 0)


# ── Azure ─────────────────────────────────────────────────────────────────────────────────────────────────────
def render_id_from_event(text: str) -> str | None:
    """Event Grid puts the BlobCreated event in the queue as JSON (base64 in some setups); subject ends .../blobs/<id>/clips/<n>.mp4."""
    try:
        ev = json.loads(text)
    except ValueError:
        ev = json.loads(base64.b64decode(text))
    if isinstance(ev, list):
        ev = ev[0]
    subject = ev.get("subject", "")
    marker = "/blobs/"
    if marker not in subject or "/clips/" not in subject:
        return None
    return subject.split(marker, 1)[1].split("/clips/", 1)[0]


def main():
    from azure.core.exceptions import ResourceExistsError
    from azure.identity import ManagedIdentityCredential, DefaultAzureCredential
    from azure.storage.blob import BlobServiceClient
    from azure.storage.queue import QueueClient

    account = os.environ["SCENES_ACCOUNT"]
    cid = os.environ.get("AZURE_CLIENT_ID")
    cred = ManagedIdentityCredential(client_id=cid) if cid else DefaultAzureCredential()
    blobs = BlobServiceClient(f"https://{account}.blob.core.windows.net", credential=cred).get_container_client(os.environ.get("SCENES_CONTAINER", "scenes"))
    queue = QueueClient(f"https://{account}.queue.core.windows.net", os.environ.get("STITCH_QUEUE", "stitch-jobs"), credential=cred)
    msg = next(iter(queue.receive_messages(messages_per_page=1, visibility_timeout=900)), None)
    if msg is None:
        return
    rid = render_id_from_event(msg.content)
    if not rid:
        queue.delete_message(msg)
        return
    plan = json.loads(blobs.download_blob(f"{rid}/plan.json").readall())
    n = len(plan["scenes"])
    have = {b.name for b in blobs.list_blobs(name_starts_with=f"{rid}/clips/")}
    if len(have) < n:
        print(f"{rid}: {len(have)} of {n} clips; waiting for the rest")
        queue.delete_message(msg)
        return
    try:
        blobs.upload_blob(f"{rid}/stitch.lock", b"", overwrite=False)
    except ResourceExistsError:
        queue.delete_message(msg)
        return
    try:
        with tempfile.TemporaryDirectory() as d:
            clips = []
            for k in range(n):
                p = os.path.join(d, f"{k}.mp4")
                with open(p, "wb") as fh:
                    blobs.download_blob(f"{rid}/clips/{k}.mp4").readinto(fh)
                clips.append(p)
            voice = None
            if plan.get("voice"):
                voice = os.path.join(d, "voice" + Path(plan["voice"]).suffix)
                with open(voice, "wb") as fh:
                    blobs.download_blob(plan["voice"]).readinto(fh)
            if plan.get("logo"):
                lp = os.path.join(d, "logo.png")
                with open(lp, "wb") as fh:
                    blobs.download_blob(plan["logo"]).readinto(fh)
                plan["logo"] = lp
            out = os.path.join(d, "final.mp4")
            subprocess.run(build_command(plan, clips, [probe_seconds(c) for c in clips], voice, out, d), check=True)
            with open(out, "rb") as fh:
                blobs.upload_blob(f"{rid}/final.mp4", fh, overwrite=True)
        blobs.upload_blob(f"{rid}/status.json", json.dumps({"state": "done"}), overwrite=True)
    except Exception as e:  # noqa: BLE001
        blobs.upload_blob(f"{rid}/status.json", json.dumps({"state": "failed", "error": str(e)[:1000]}), overwrite=True)
        print(f"{rid}: stitch failed: {e}", file=sys.stderr)
    queue.delete_message(msg)


if __name__ == "__main__":
    main()
