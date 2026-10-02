# Configuration and privacy

| Variable                 | Default                              | Meaning                                                                                                    |
| ------------------------ | ------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `APP_URL`                | `http://localhost:3000`              | Exact browser-facing root origin; controls origin checks and Secure cookie behavior.                       |
| `BIND_ADDRESS`           | `127.0.0.1`                          | Compose-only published-port binding.                                                                       |
| `HOST_PORT`              | `3000`                               | Compose-only host port.                                                                                    |
| `PORT`                   | `3000`                               | Native Node HTTP listener; keep container port 3000 for the image health check.                            |
| `DATA_DIR`               | `./data` natively, `/data` in Docker | Persistent application state.                                                                              |
| `ALLOW_LOOPBACK_SOURCES` | disabled                             | Native development only; allows configured loopback fixture services. Do not enable in public deployments. |

There are no required upstream credentials in `.env`. Connections are created, tested, edited or removed through the authenticated owner UI. Server and browser URLs may differ. The server URL is used for fixed API requests; the browser URL is used for source handoff and never for credentialed requests.

The first milestone has one owner. Every connected upstream account's permitted collection becomes visible to that owner. It does not provide per-family-member access controls. Choose normal reader/viewer accounts with only the intended source libraries; do not use an administrative shared account expecting SelfLib to filter private content.

Passwords use salted scrypt (N=32768, r=8, p=3, 64-byte output). Random sessions are stored only as SHA-256 hashes and expire after 24 hours. Cookies are HttpOnly, SameSite=Strict, root-scoped, and Secure for HTTPS `APP_URL`. Logout revokes the server session. Mutations require the configured Origin, JSON content type, and a session CSRF token. Setup/login use a separate short-lived pre-auth cookie/token. Attempts are limited to eight per socket IP per 15 minutes; the throttle is process-local and resets on restart.

Upstream secrets use AES-256-GCM with random nonces and a generated 32-byte `/data/secrets.key` (0600). The database stores ciphertext; credentials are never returned by connection-list/edit APIs. Keep the whole data directory and backups private. The key residing beside the database means a complete volume backup can decrypt secrets; encrypt backups separately. Missing keys with existing sources stop startup rather than silently replacing the key. Rotation procedure is in [operations](operations.md).

Endpoint policy allows only explicitly saved HTTP(S) services, with no embedded credentials, query or fragment. Private IPv4/unique-local IPv6 requires per-connection approval. Loopback is blocked by default; link-local, unspecified, multicast and known metadata endpoints remain blocked. DNS results are checked and pinned to the outgoing socket. Redirects are refused rather than carrying source credentials elsewhere. The browser cannot supply an arbitrary proxy URL or path; adapter paths and item identifiers are constrained.

Requests have a 10-second timeout, JSON responses an 8 MiB limit, and artwork a 512 KiB limit. Only PNG/JPEG/WebP are cached, never SVG/HTML. Fixed CSP, nosniff, no-referrer, same-origin assets and escaped metadata reduce browser injection risks. No source filesystem paths are exposed or used for file access. Logs contain event names, source IDs, counts and listening ports, not passwords, tokens, raw upstream responses, request bodies or full request URLs.

Artwork caches are protected by the same owner session as metadata. The global artwork budget is 64 MiB; at most the 200 uncached candidate items are inspected for artwork during each sync. The first release does not evict an existing cache automatically. Cached covers can remain old until a connection is removed/re-added; metadata is refreshed on every successful sync.
