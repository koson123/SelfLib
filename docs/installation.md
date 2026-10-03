# Installation

## Requirements and supported platform

Docker Engine/Desktop with Compose v2, Linux AMD64, a writable persistent volume, and browser access. Source services must be reachable **from the container**. Windows browsers are targeted; screenshots/tests exercise Chromium desktop, phone, and tablet viewports. Real iOS Safari and older iPads remain unverified.

Node 24.19.0 is pinned in the image. SQLite is supplied by Node; no native npm SQLite addon or external database is required. Only `linux/amd64` is built by CI. An ARM64 release requires a real container build and smoke test, including SQLite and FTS5; do not remove the platform declaration and assume support.

See the README quick start. Until a public image is actually published, Compose uses `build: .` and the local name `selflib:0.1.0`. Docker builds install the pinned lockfile and compile the app. A Docker daemon is required; no host development toolchain is required.

## Storage and permissions

Compose mounts a named volume at `/data`; Docker initializes its ownership from the image. The runtime user is **10001:10001**, not root. The volume contains `selflib.sqlite`, possible SQLite WAL/SHM files, `secrets.key`, and the temporary first-run `setup.token`. Metadata, thumbnails, favorites, collections and sessions live in SQLite. Source media directories are not mounted.

For an optional bind mount, create a dedicated empty directory and give it ownership:

```bash
sudo install -d -m 700 -o 10001 -g 10001 /srv/selflib-data
```

Replace the volume entry with `/srv/selflib-data:/data`. Database and key files use mode 0600; the directory should be 0700. Back up the key with the database. Docker/host administrators can read both: application encryption is not protection against a compromised host.

## First-run ownership

```bash
docker compose exec selflib cat /data/setup.token
```

Enter that token in the wizard, choose a username and a password of at least 12 characters. Keep the token private. Setup can happen only once; there is no public account registration. The demo is public but contains exclusively fictional data. Private catalog and artwork require the owner session.

## LAN access

Default binding is loopback. To expose to your LAN, edit `.env`:

```dotenv
APP_URL=http://library.example.org:3000
BIND_ADDRESS=0.0.0.0
HOST_PORT=3000
```

Use your actual hostname. Recreate with `docker compose up -d`. HTTP is suitable for an isolated initial check; configure HTTPS before transmitting real passwords or source credentials. SelfLib does not accept self-signed upstream certificates or disable TLS verification. Install trusted certificates at the source or use your trusted internal CA in the container through a deliberate deployment change.

Private source IPs are supported only after approving private LAN access for that specific connection. Prefer Docker service names on a shared network or reachable LAN hostnames. Do not use `localhost` for another container. `ALLOW_LOOPBACK_SOURCES` is a native-development escape hatch, deliberately absent from production Compose.

## Reverse proxy and HTTPS

Use a **dedicated hostname at `/`**. SelfLib subpaths such as `/selflib/` are not implemented, and startup rejects an `APP_URL` containing a path. Upstream service base paths are separately supported by adapters.

Set `APP_URL=https://library.example.org`. HTTPS in this setting enables Secure cookies and HSTS even when TLS terminates at your reverse proxy. Forward to the loopback published port from a proxy running on the host, or join a proxy container to the SelfLib network and forward to `selflib:3000`.

Example Nginx server block (supply your own certificate paths):

```nginx
server {
  listen 443 ssl;
  server_name library.example.org;
  ssl_certificate /etc/nginx/certs/library.crt;
  ssl_certificate_key /etc/nginx/certs/library.key;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
  }
}
```

SelfLib does not trust arbitrary forwarded client IPs. Login throttling is keyed by socket peer IP; behind a proxy its users may share one conservative bucket. For this single-owner release that is intentional. Add edge throttling if exposing it beyond a trusted network. Proxy configuration and certificates are deployment-specific and were not live-tested in this environment; HTTPS cookie behavior is tested at the application layer.

## Health and restart

`GET /healthz` checks SQLite and returns status/version without private metadata. The image has a health check; Compose restarts an exited process (`unless-stopped`), not merely an unhealthy container. Investigate `docker compose logs --tail=100 selflib` and `docker compose ps`. A graceful SIGTERM stops new requests, interrupts sync at safe boundaries, drains active work and closes SQLite. Container shutdown allows 20 seconds; the process has a 15-second forced-exit deadline.
