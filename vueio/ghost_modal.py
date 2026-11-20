"""Vueio: a Ghost publishing site running on Modal.

Deploy:
    modal deploy vueio/ghost_modal.py

Optional settings, read at deploy time:
    GHOST_URL       Public URL of the site (for example https://vueio.com).
                    If unset, the site uses its *.modal.run URL.
    CUSTOM_DOMAIN   Domain to attach with Modal custom domains (needs a Modal
                    plan that has them, and a DNS record pointing at Modal).
    KEEP_WARM       "1" keeps one container running so visitors never wait
                    for a cold start (costs compute around the clock).
    USE_SECRET      "1" attaches the Modal Secret "vueio-ghost" (see below).

Database: SQLite on a Modal Volume by default. For production traffic, create
a Modal Secret named "vueio-ghost" (and deploy with USE_SECRET=1) with Ghost's MySQL 8 settings, for example:
    database__client=mysql
    database__connection__host=...
    database__connection__user=...
    database__connection__password=...
    database__connection__database=ghost
Email (staff invites, member sign-in links) goes in the same secret:
    mail__transport=SMTP
    mail__options__service=Mailgun
    mail__options__auth__user=...
    mail__options__auth__pass=...
    mail__from="Vueio <noreply@your-domain>"
"""

import os
import subprocess

import modal

APP_NAME = "vueio"
GHOST_PORT = 2368
CONTENT_DIR = "/var/lib/ghost/content"

GHOST_URL = os.environ.get("GHOST_URL", "").strip()
CUSTOM_DOMAIN = os.environ.get("CUSTOM_DOMAIN", "").strip()
KEEP_WARM = os.environ.get("KEEP_WARM", "") == "1"
USE_SECRET = os.environ.get("USE_SECRET", "") == "1"

# Official Ghost 6 image (Debian). Modal adds a Python runtime next to it.
image = (
    modal.Image.from_registry("ghost:6", add_python="3.12")
    .env(
        {
            "server__host": "0.0.0.0",
            "server__port": str(GHOST_PORT),
            "paths__contentPath": CONTENT_DIR,
            **({"VUEIO_PUBLIC_URL": GHOST_URL} if GHOST_URL else {}),
        }
    )
)

content = modal.Volume.from_name("vueio-ghost-content", create_if_missing=True)
secret = modal.Secret.from_name("vueio-ghost") if USE_SECRET else None

app = modal.App(APP_NAME, image=image)


def _public_url() -> str:
    url = os.environ.get("VUEIO_PUBLIC_URL")
    if url:
        return url
    if CUSTOM_DOMAIN:
        return f"https://{CUSTOM_DOMAIN}"
    # Fall back to this function's own *.modal.run address.
    return modal.Function.from_name(APP_NAME, "ghost").get_web_url()


@app.function(
    volumes={CONTENT_DIR: content},
    secrets=[secret] if secret else [],
    cpu=1.0,
    memory=1024,
    # Ghost keeps state on one disk, so only one container may run at a time.
    max_containers=1,
    min_containers=1 if KEEP_WARM else 0,
    scaledown_window=20 * 60,
    timeout=24 * 60 * 60,
)
@modal.concurrent(max_inputs=200)
@modal.web_server(GHOST_PORT, startup_timeout=300, custom_domains=[CUSTOM_DOMAIN] if CUSTOM_DOMAIN else None)
def ghost():
    env = os.environ.copy()
    env["url"] = _public_url()

    if env.get("database__client", "").startswith("mysql"):
        env["NODE_ENV"] = "production"
    else:
        # Ghost supports SQLite only in its development mode.
        os.makedirs(f"{CONTENT_DIR}/data", exist_ok=True)
        env["NODE_ENV"] = "development"
        env["database__client"] = "sqlite3"
        env["database__connection__filename"] = f"{CONTENT_DIR}/data/ghost.db"
        env["database__useNullAsDefault"] = "true"

    _seed_content()
    subprocess.Popen(["node", "current/index.js"], cwd="/var/lib/ghost", env=env)


def _seed_content():
    """Copy the image's default content (Casper theme, folders) into the
    volume on first boot, like the official entrypoint does."""
    import shutil

    base = "/var/lib/ghost/content.orig"
    if not os.path.isdir(base):
        return
    sources = [os.path.join(base, d) for d in os.listdir(base)]
    themes = os.path.join(base, "themes")
    if os.path.isdir(themes):
        sources += [os.path.join(themes, t) for t in os.listdir(themes)]
    for src in sources:
        target = os.path.join(CONTENT_DIR, os.path.relpath(src, base))
        if os.path.exists(target):
            continue
        os.makedirs(os.path.dirname(target), exist_ok=True)
        if os.path.isdir(src):
            shutil.copytree(src, target, symlinks=True)
        else:
            shutil.copy2(src, target)
