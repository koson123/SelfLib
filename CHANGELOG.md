# Changelog

## Artwork and library routing follow-up (unreleased)

- TV episodes now live inside source-identified series boxes with season discs, paged tracks and Resume from the latest unfinished source episode.
- Actual wraparound sleeve scans can be previewed and cropped into front/spine artwork in the browser. Removed synthetic DVD branding and modeled hinges, latches and box-set edges.
- Automatic retail sleeve discovery remains unavailable; source posters are fallback artwork.

- Fixed image Accept negotiation; Komga thumbnails no longer use a JSON-only header that causes HTTP 406.
- Added actual Komga library IDs/names and owner-configurable Comics/Manga/Graphic Novels mappings.
- Added DVD-style cases and Jellyfin Box artwork preference with Primary fallback.
- Added private cover/spine uploads, full-surface spine rendering and continuous box-set panoramas in insertion order.
- Added shared cache accounting and clear-downloaded-cover controls; source assets and custom artwork remain separate.
- Added transactional schema 1 → 2 migration and matching offline maintenance support.
- No automatic Internet DVD/fan-art lookup or copied reference artwork is included.

## Follow-up fixes on the 0.1.0 implementation branch

- Corrected Komga identity checks to `/api/v2/users/me`; fixtures now reject the incorrect v1 route.
- Added server-side Jellyfin viewer sign-in and actionable errors for keys without user identity.
- Separated Books/Audiobooks and Movies/TV Shows; added Manga for explicitly tagged Komga books.
- Added cached-artwork spine medallions, author labels and two-line vertical titles while preserving cover view.
- Added filled/pulsing favorite hearts, accessible confirmation and badges attached to moving objects.
- Added artwork failure reason counts. Existing source IDs, saved favorites, collections and schema remain unchanged.

## 0.1.0 — First milestone (unreleased)

- Added single-owner onboarding, local sessions, CSRF checks and login throttling.
- Added server-side encrypted service credentials and endpoint-constrained API transport.
- Added Audiobookshelf, Komga and Jellyfin contract-tested adapters and bounded manual sync.
- Added physical wooden bookcases, spine-first browsing, individual shelf rows, and varied book shapes.
- Added responsive shelves, source handoff, progress snapshots, search, favorites and mixed collections.
- Added clearly labeled fictional demo and protected catalog/artwork caching.
- Added versioned SQLite initialization, offline maintenance, Docker packaging, checks and public docs.

No prebuilt public image, live-service compatibility matrix or ARM64 support is claimed yet.
