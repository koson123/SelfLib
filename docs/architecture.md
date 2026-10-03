# Architecture and adapter development

## Decisions

- TypeScript on server and browser; a small DOM UI avoids a larger frontend runtime.
- Express handles API routing; Node 24 supplies SQLite, eliminating a native npm SQLite addon.
- One process, one SQLite database with FTS5, one Docker container, one owner.
- Source apps own files, reading/playback, collection management and progress.
- The library owns favorites, mixed collections, source configuration and a cached metadata projection.
- CSS gives books/comic volumes/film cases depth and selection movement without continuous GPU rendering.
- The normalized catalog/action contract is independent of DOM presentation; a future 3D room can reuse it.
- No copied shelf implementation, texture, font, external image, reader or server from inspiration repositories.

## Data flow

The authenticated owner saves an encrypted connection. An adapter identifies the account, enumerates pages and normalizes records. A bounded staging array is checked for duplicate identities, pagination loops, item/page caps and deadlines. Only a complete enumeration atomically replaces the source catalog and FTS projection. Failed enumerations preserve prior catalog and progress snapshots. Then bounded artwork requests populate SQLite BLOBs independently; artwork failure doesn't undo metadata.

Items have stable SHA-256 identities derived from source UUID and remote item ID. Source item IDs remain available for handoff. When a successfully synchronized source removes an item, its local favorites/collection memberships cascade away. A failed or partial sync never treats unseen items as deletions.

Catalog search and pagination happen in SQLite; the browser receives at most 100 items per request. Entrance previews fetch six items per presentation category. `ShelfCategory` maps normalized `kind` to Books, Audiobooks, Comics, Manga, Graphic Novels, Movies, or TV Shows; API `category` filters the existing JSON metadata in SQLite. Coarse source sections and item identities remain stable. Source requests use checked/pinned DNS, hardcoded endpoint paths, no redirects, deadlines and body limits. One safe retry is attempted for a failed page request caused by reachability or HTTP 5xx. No retry is attempted for invalid authentication, schema mismatch or unsafe destinations.

## Adapter contract

`src/shared.ts` defines `Adapter`, `SourceConfig`, `CatalogItem`, `Page`, `Progress`, and capabilities. `src/server/adapters.ts` contains the three implementations. A transport is injectable for contract fixtures; the production transport enforces endpoint policy.

| Method/field               | Responsibility                                                                                              |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `type`, `capabilities`     | Declare catalog/artwork/progress/handoff availability explicitly.                                           |
| `health()`                 | Authenticate intended account; return optional account/version. No credentials in results/errors.           |
| `page(cursor?)`            | Return normalized items and an opaque next cursor; never self-repeat.                                       |
| `artwork(item)`            | Use a constrained service-relative path; accepted raster types and byte cap are enforced.                   |
| `handoff(item)`            | Construct a known source route on configured Browser URL with validated identifier.                         |
| `sourceId`, `sourceItemId` | Preserve source identity; never use title as identity.                                                      |
| `progress`                 | Optional source fraction plus unit/position/timestamp. Unsupported or absent is not invented zero progress. |
| `actions`                  | Declare supported open/progress and unsupported embedded playback. Never ship API credentials.              |

The backend removes internal `artworkPath` from browser responses. The browser receives a protected SelfLib artwork reference. Item text is rendered escaped, not as source HTML. Credentials are not part of `ItemView`.

## Adding an adapter

1. Inspect official API docs and authentication/permission semantics. Record version and upstream evidence.
2. Add a typed source discriminator and normalization schema. Represent unsupported capabilities explicitly.
3. Implement all contract methods without direct filesystem access, arbitrary outbound paths or shell execution.
4. Add synthetic fixtures for account identity, pagination, artwork, progress and failures. Exercise normalization and credential headers against a fixture HTTP server.
5. Add setup instructions for required credentials/permissions and source route limitations.
6. Test the common sync/API path and browser connection setup. Distinguish fixture evidence from live tests.
7. Only then enable the integration in the UI and README. Do not create selectable nonfunctional placeholders.

## Migrations

Schema version 1 is created transactionally for a new database and recorded in `migrations` plus `PRAGMA user_version`. Reopening version 1 is idempotent. A database newer than the binary is rejected. Future migrations must run in explicit ordered transactions, test old supported schemas with preserved items/favorites/secrets, and document unsupported upgrade jumps. A version number alone is not a downgrade mechanism.

## Resource bounds

10 connections, one sync concurrently, 100 records/page, 10,000 records/100 pages/source, two-minute sync budget, 10-second requests, 8 MiB JSON responses, 512 KiB raster artwork, 200 uncached artwork attempts/sync, 64 MiB total artwork. Reading all full metadata into a bounded staging array avoids partial-catalog commits; a future streaming staging table can reduce memory for larger libraries. The cache is bounded but not a media offline store.

## Artwork and library-room decisions

Schema 2 adds `sources.library_rooms` and `item_artwork`/`collection_artwork` BLOB tables. Foreign keys cascade custom item images and panoramas when their local parents are removed. Upstream caches and custom overrides are separate; synchronization never overwrites a custom image. A source image endpoint change invalidates its cached thumbnail. `artworkBytes()` includes all three storage locations in one budget.

Komga's library list is loaded once per adapter instance, stripped to ID/name, and joined against BookDto.libraryId. Owner mappings take precedence over narrow name defaults and explicit book tags. Filesystem root/path properties are discarded. This corrects the earlier assumption that every installation would tag individual books.

Collection ordering uses membership rowid (insertion order); default catalog ordering is unchanged. Single-room, single-mode collections with 2–18 members may use a panorama. An authenticated, no-store CSS endpoint emits only generated/validated item selectors and numeric slice dimensions. It accepts no arbitrary CSS, URLs, or source destinations and avoids relaxing the CSP for inline styles. Browser CSS performs rendering; the server stores and serves bounded raster bytes without image transformation libraries.

Optional Jellyfin Box images have a Primary-image fallback. DVD shells are a visual choice, not an inferred edition or new metadata provider. Third-party cover scraping and automatic spine-art discovery remain unsupported. Public screenshots use original fictional illustrations, not the uploaded personal/reference images.

### Series and sleeve presentation

Normalized episodes optionally carry `parentSourceItemId`, `seasonNumber` and `episodeNumber`. Relationships are scoped by source and demo/live identity, never a shared title. Ordinary shelf queries omit episodes; search, explicit favorites and collections retain them. Show summaries count children and select the latest unfinished progress via SQLite; the owner-only `/api/items/:id/episodes` route returns at most 100 sorted children plus an independently selected resume target. Browse data is cached; no upstream request on opening a case. Hierarchy fields live in the existing versioned JSON record and require resynchronization, not a new database migration.

Wraparound scans are locally decoded and cropped with the browser canvas, then saved through existing authenticated cover/spine endpoints. No new dependency, cloud lookup or server image decoder. The browser limits scans to 4 MiB / 20 million pixels; output JPEGs pass the existing server-side signature, size and shared-cache checks. Two independent uploads report partial failure explicitly.
