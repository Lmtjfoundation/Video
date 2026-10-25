"""
Shared plumbing for the engine's side services (speech_server.py, lipsync_server.py): each runs a model that needs its
own Python packages, in its own environment, behind the same token as the video engine, which forwards its path to it.
A side service is a queue of jobs, one at a time, each producing one file; files are kept for three hours.
Imports only the standard library, FastAPI and pydantic, so it works in every environment.
"""


import base64
import logging
import os
import queue
import secrets
import tempfile
import threading
import time
import uuid
from collections.abc import Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass, field

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

KEEP_SECONDS = 3 * 3600
TINY = os.environ.get("ENGINE_MODEL", "") in ("tiny", "tiny-best")


@dataclass
class Job:
    id: str
    req: BaseModel
    dir: str
    status: str = "queued"
    progress: float = 0.0
    error: str | None = None
    file: str | None = None
    meta: dict = field(default_factory=dict)
    created: float = field(default_factory=time.time)


def decode_file(b64: str, path: str, what: str) -> str:
    """Writes a base64 (or data: URL) upload to `path`; a 400 if it isn't base64."""
    try:
        raw = base64.b64decode(b64.split(",", 1)[-1], validate=False)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"The {what} couldn't be read: {e}") from e
    if len(raw) < 16:
        raise HTTPException(400, f"The {what} is empty.")
    with open(path, "wb") as f:
        f.write(raw)
    return path


def create_app(name: str, prefix: str, req_model: type[BaseModel], run: Callable[[Job], str], media_type: str,
               check: Callable[[BaseModel], None] | None = None, info: Callable[[], dict] | None = None) -> FastAPI:
    """A FastAPI app with POST {prefix}, GET {prefix}/{id}, GET {prefix}/{id}/file and GET {prefix}/info.
    `run(job)` makes the file (in job.dir) and returns its path; it may set job.progress and job.meta."""
    log = logging.getLogger(prefix.strip("/").replace("/", "-"))
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    token = os.environ.get("ENGINE_TOKEN") or ""
    if not token:
        token = secrets.token_urlsafe(24)
        log.warning("ENGINE_TOKEN is not set; using a one-time token for this run: %s", token)
    out_dir = os.path.join(os.environ.get("ENGINE_SIDE_OUT") or tempfile.gettempdir(), f"ghost-post{prefix.replace('/', '-')}")
    jobs: dict[str, Job] = {}
    q: queue.Queue[str] = queue.Queue()
    lock = threading.Lock()

    def cleanup() -> None:
        cutoff = time.time() - KEEP_SECONDS
        with lock:
            for jid in [j.id for j in jobs.values() if j.created < cutoff and j.status in ("succeeded", "failed")]:
                job = jobs.pop(jid)
                import shutil

                shutil.rmtree(job.dir, ignore_errors=True)

    def worker() -> None:
        while True:
            job = jobs.get(q.get())
            if not job:
                continue
            job.status = "running"
            try:
                job.file = run(job)
                job.status, job.progress = "succeeded", 1.0
            except Exception as e:  # noqa: BLE001
                log.exception("Job %s failed", job.id)
                job.status, job.error = "failed", f"{type(e).__name__}: {e}"[:500]
                try:
                    import torch

                    if torch.cuda.is_available():
                        torch.cuda.empty_cache()
                except Exception:  # noqa: BLE001
                    pass
            cleanup()

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        os.makedirs(out_dir, exist_ok=True)
        threading.Thread(target=worker, daemon=True).start()
        yield

    app = FastAPI(title=name, lifespan=lifespan)

    def authorised(authorization: str = Header(default="")) -> None:
        if not secrets.compare_digest(authorization, f"Bearer {token}"):
            raise HTTPException(401, "Wrong or missing engine token.")

    @app.get("/health")
    def health() -> dict:
        return {"ok": True}

    @app.get(f"{prefix}/info", dependencies=[Depends(authorised)])
    def get_info() -> dict:
        return {"engine": name, "queue": q.qsize(), **(info() if info else {})}

    @app.post(prefix, dependencies=[Depends(authorised)])
    def create(req: req_model) -> dict:  # type: ignore[valid-type]
        if check:
            check(req)
        job = Job(id=uuid.uuid4().hex, req=req, dir=os.path.join(out_dir, uuid.uuid4().hex))
        os.makedirs(job.dir, exist_ok=True)
        with lock:
            jobs[job.id] = job
        q.put(job.id)
        return {"id": job.id, "status": job.status}

    @app.get(f"{prefix}/{{job_id}}", dependencies=[Depends(authorised)])
    def status(job_id: str) -> dict:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(404, "No such job (finished files are kept for 3 hours).")
        return {"id": job.id, "status": job.status, "progress": round(job.progress, 3), "error": job.error, **job.meta}

    @app.get(f"{prefix}/{{job_id}}/file", dependencies=[Depends(authorised)])
    def file(job_id: str) -> FileResponse:
        job = jobs.get(job_id)
        if not job or job.status != "succeeded" or not job.file:
            raise HTTPException(404, "The file isn't ready.")
        return FileResponse(job.file, media_type=media_type, filename=os.path.basename(job.file))

    return app
