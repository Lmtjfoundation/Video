# Vueio on Modal

Vueio is a [Ghost](https://ghost.org) publishing site (blog, newsletter, memberships) hosted on [Modal](https://modal.com). It uses the official `ghost:6` Docker image. Posts, images and themes are kept on a Modal Volume named `vueio-ghost-content`, so they survive restarts and redeploys.

## Deploy

```bash
pip install modal
modal token set --token-id <id> --token-secret <secret>   # or: modal setup
modal deploy vueio/ghost_modal.py
```

Modal prints a URL such as `https://<workspace>--vueio-ghost.modal.run`. Open `<url>/ghost` to create the owner account.

The first boot takes about a minute while Ghost sets up its database. Later cold starts take 10–20 seconds. If you deploy with `KEEP_WARM=1`, one container runs all the time and there are no cold starts, but you pay for it around the clock.

## Options (environment variables at deploy time)

| Variable | Purpose |
|---|---|
| `GHOST_URL` | Public URL of the site, for example `https://vueio.com`. |
| `CUSTOM_DOMAIN` | Attaches a domain through Modal custom domains. Your Modal plan must include them, and your DNS must point at Modal. |
| `KEEP_WARM=1` | Keeps one container running all the time. |
| `USE_SECRET=1` | Attaches the Modal Secret `vueio-ghost`, which holds the MySQL and email settings. |

Example: `GHOST_URL=https://vueio.com CUSTOM_DOMAIN=vueio.com USE_SECRET=1 modal deploy vueio/ghost_modal.py`

## Database and email

By default the site uses SQLite on the Volume. That's fine for a small site. Ghost only supports SQLite in its development mode, and only one container can run at a time. For real traffic, use MySQL 8 (PlanetScale, AWS RDS, DigitalOcean and others offer it). Create the secret like this:

```bash
modal secret create vueio-ghost \
  database__client=mysql \
  database__connection__host=HOST \
  database__connection__user=USER \
  database__connection__password=PASSWORD \
  database__connection__database=ghost \
  mail__transport=SMTP \
  mail__options__service=Mailgun \
  mail__options__auth__user=SMTP_USER \
  mail__options__auth__pass=SMTP_PASSWORD \
  mail__from='Vueio <noreply@vueio.com>'
```

Then redeploy with `USE_SECRET=1`. Without email settings Ghost still runs, but staff invites and member sign-in links won't send.
