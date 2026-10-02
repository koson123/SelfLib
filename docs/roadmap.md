# Roadmap

## Implemented in 0.1.0

Owner setup/authentication, fictional demo, responsive CSS shelves, Audiobookshelf/Komga/Jellyfin adapters, metadata search, persisted favorites/mixed collections, source progress snapshots, source handoff, connection management, bounded manual synchronization, outage browsing, Docker packaging and public contributor documentation.

## Next

- Live-version compatibility matrix for the three implemented adapters; real Windows/iOS Safari testing.
- Better series/season grouping, filters and user-defined shelf ordering.
- Progress-only refresh, scheduled incremental catalog updates, source-specific permission warnings.
- Cache eviction/refresh controls and support for larger catalogs through a staging table.
- Navidrome records, Immich albums and Paperless-ngx binders with documented account permissions.

## Later

- Playnite catalog export and an authenticated Windows companion accepting only approved game IDs.
- RomM catalog/launch handoff with per-emulator/browser/save limitations documented.
- Selected embedded reading/listening only after progress-location compatibility is validated.
- Optional walkable browser-rendered 3D room using the same catalog/actions; retain the accessible shelf/list UI.
- Multi-user authorization and source-account mapping before any family-sharing feature.

Planned capabilities are not selectable integrations. No arbitrary shell commands, unrestricted proxy, replacement media server, mandatory cloud account or server-side 3D rendering is planned.
