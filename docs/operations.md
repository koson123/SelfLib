# Backups, restore, upgrades and key rotation

## Logs and shutdown

`docker compose logs --tail=100 selflib` shows JSON event names, IDs and counts. Do not enable request-body or upstream-header logging in your reverse proxy. `/healthz` checks the database. Stop using `docker compose stop`; avoid killing a syncing process unless necessary. SQLite transactions keep catalog replacement atomic. After an abrupt shutdown the source is marked interrupted; a new manual sync can refresh source state; no background sync queue is persisted.

## Backup: stop and copy the whole data directory

Back up the **database and secrets.key together**, including any WAL/SHM files still present. Backing up only `selflib.sqlite` while it is running is not supported by this procedure. The database contains private metadata, sessions and credentials encrypted with the adjacent key. Encrypt the backup at rest and limit access.

```bash
docker compose stop selflib
mkdir -p backups/2026-01-01
docker compose cp selflib:/data/. backups/2026-01-01/
docker compose start selflib
```

Use your chosen date/path. Copy `package.json`/the deployed version identifier alongside the snapshot. Protect the destination with mode 0700 (or equivalent host ACL); key files should be 0600. Copy the full snapshot to durable storage. Test a restore in an isolated instance before relying on backups. The commands require a created service container; don't run `down` before `compose cp`.

## Restore

Restore only a snapshot into a separate empty data directory/volume, paired with its exact matching image/source version. Preserve `secrets.key`; the app stops if existing sources have no key. Do not merge arbitrary database and key versions.

For a bind-mount restore:

1. Stop the existing service and retain its current data as a rollback backup.
2. Copy all snapshot files to a new directory owned by 10001:10001, mode 0700; set database/key files to 0600.
3. Point Compose's `/data` mount at that new directory. Build/run the version that created the snapshot.
4. Confirm login, catalog, favorites/collections and source test. Old sessions may still be valid because a full backup includes them; revoke them with the offline maintenance command if needed.

For named volumes, create a **new** named volume and copy the snapshot into it using an operator-controlled helper container or Docker Desktop's volume tools, set the same ownership, then switch Compose's volume declaration. Never overwrite a running SQLite volume.

## Encryption-key rotation

Rotation is an offline operation. Stop the service and make the complete backup above. Then run the included maintenance command against the mounted data volume:

```bash
docker compose run --rm --no-deps selflib node dist/maintenance.js rotate-key
docker compose up -d
```

The command backs up the current SQLite database and old key under a private `rotation-backup-*` directory, re-encrypts source credentials transactionally, and installs a fresh key. On failure it restores the old database/key before returning an error. Keep the rotation backup until source tests pass, then remove it through your operator file-management process. It contains a complete decryptable backup; treat it as sensitive.

Do not run maintenance alongside the service: offline maintenance refuses operation if it detects the service lock. If power is lost between database commit and key replacement, restore the matching pair from the rotation backup before starting. Filesystem-plus-SQLite replacement is not universally atomic across power loss.

## Owner-password recovery and session revocation

There is no public password-reset endpoint. A host administrator can stop the service and supply a new 12–128-character password over stdin:

```bash
docker compose stop selflib
# Replace the example using an interactive password read in your shell; don't store it in history.
read -r -s -p 'New owner password: ' SELF_LIB_PASSWORD
printf '%s' "$SELF_LIB_PASSWORD" | docker compose run --rm -T --no-deps selflib node dist/maintenance.js reset-password
unset SELF_LIB_PASSWORD
docker compose up -d
```

This replaces the salted password hash and revokes all sessions. `node dist/maintenance.js revoke-sessions` can revoke sessions without changing the password, also while stopped.

## Upgrades and releases

Before every upgrade: stop, snapshot the entire data directory, record your current version, and review the changelog. Build the desired release tag, restart, and check health/login/sources. Don't use `docker compose down -v` on a real install: it deletes the named volume.

0.1.0 supports a new database or its own schema 1. No older SelfLib production schema exists. Future binaries must explicitly migrate supported versions. Downgrades are unsupported after schema changes; restore the old snapshot with its old binary instead. A newer `user_version` produces an actionable startup failure.

Version policy: semantic versions, with `0.x` indicating an evolving API/adapter contract. Stable public image tags are exact release tags (`v0.1.0` style), not an assumed `latest`. A maintainer must ensure checks/container smoke pass, publish the Git tag/release, and manually dispatch the image workflow on that tag with `publish=true`. Verify GHCR package visibility and pullability before editing installation docs to name an available image. The initial PR does not publish a package or release.

## Dependency updates

Dependencies are exact-pinned with a lockfile. Dependabot prepares npm/Docker/Actions update PRs weekly; Actions themselves are commit-pinned. Review license changes, Node engine requirements, image compatibility and upstream API contracts, then run the full checks/browser/container tests. Update the Node image and CI version together. Rebuild regularly for OS fixes; record any new base digest in release notes. Automatic merging/publishing is not configured.
