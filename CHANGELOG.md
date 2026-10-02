# Changelog

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
