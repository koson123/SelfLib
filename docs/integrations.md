# Integration setup and contracts

All adapters in 0.1.0 are tested against hand-authored fixtures based on official APIs, not live instances. API documentation and upstream routing were inspected; installed-version compatibility still needs live confirmation. SelfLib doesn't infer capabilities from screenshots. Future adapters aren't selectable.

| Source         | Credential                                            | Catalog and artwork                                                              | Progress                                     | Handoff                                         |
| -------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------- |
| Audiobookshelf | User-bound API key as Bearer token                    | `/api/libraries`, paginated `/api/libraries/{id}/items`, `/api/items/{id}/cover` | `/api/me` mediaProgress snapshot             | `/item/{id}` detail page                        |
| Komga          | `X-API-Key` from intended reader account              | POST `/api/v1/books/list`, book thumbnail                                        | `readProgress` in BookDto                    | `/book/{id}` detail page; source chooses reader |
| Jellyfin       | Intended viewer's user access token in `X-Emby-Token` | `/Items?UserId=...`, Box/Primary images                                          | UserData positions/runtime for Movie/Episode | `/web/#/details?id={id}`                        |

`embeddedPlayback` is explicitly unsupported. TV series folders have no meaningful playback position; only movies/episodes report one. A book without recorded progress has no continue entry. Finished items are excluded from continue. SelfLib reads progress and leaves updates to source readers/players. Its progress positions are not generic interchangeable bookmarks: seconds, pages or source fractions are retained.

## Shelf categories and Komga libraries

Books, Audiobooks, Comics, Manga, Graphic Novels, Movies, and TV Shows have separate navigation and shelves. Source identities stay stable, so moving an item to a different room preserves favorites and collection memberships. Audiobookshelf audio presence distinguishes audiobook editions; mixed ebook/audio items use the audiobook room. Jellyfin Movie goes to Movies; Series/Episode go to TV Shows. Nested seasons remain a later refinement.

Komga supplies `libraryId` on each BookDto. SelfLib reads `/api/v1/libraries` using the reader account and joins by that ID; it does not read NAS paths or infer a format from a filename. In **Connections → Komga → Map libraries**, choose Comics, Manga, or Graphic Novels for each actual library. **Save library rooms**, then **Synchronize**. Explicit mappings override tags and survive connection edits. Without a mapping, a library named `Manga` or `Graphic Novels` (case-insensitive; spaces, underscores and hyphens ignored for Graphic Novels) gets that room automatically. Other libraries use the book's explicit `Manga` tag or default to Comics. A mixed library without distinguishing metadata cannot be classified reliably by title alone. Only book tags, not series-only genre tags, are read in this milestone.

Thumbnail requests now send image Accept types instead of `application/json`. The previous header produced HTTP 406 from Komga even though catalog sync succeeded. The regression fixture rejects JSON-only image requests. After updating, synchronize again; uncached covers are retried automatically.

## DVD cases and illustrated spines

Movies and TV Shows use a **DVD-style presentation shell**. The decorative DVD label does not claim the source media is a physical DVD, change playback quality, or convert files. Jellyfin's supplied `Box` image is preferred when present; `Primary` is the fallback. Missing/unsupported box artwork falls back to Primary without requiring external services. Jellyfin's image slot is not a verified DVD-edition identifier. SelfLib does **not** search or scrape third-party DVD/fan-art sites automatically: edition matching, provider permissions, credentials and licensing are not implemented. A preferred DVD front cover can be uploaded privately in the item's detail panel.

Open an item → **Cover and spine artwork**. Choose Cover/DVD cover or Full illustrated spine, select PNG/JPEG/WebP (maximum 512 KiB), and Save artwork. A true spine image fills its spine without synthetic text over it. Without one, the cached cover is cropped behind readable labels; a locally drawn botanical illustration is used when no image exists. Crop wraparound scans to the desired front or spine first. Use artwork you have permission to use; uploads are not published or committed to the project and never alter source assets. Remove selected custom artwork to return to the fallback.

For the continuous artwork in a box set, create a collection, add **2–18 items from one room** in the intended order, select that collection, and upload a **Box-set panorama**. View Spines. One raster image is divided across the cases, including gaps and individual pull-out movement. Crop/design the image for the assembled set's proportions (roughly 44 pixels per case × 190 pixels of visible printed height); its image fills that surface. Items use persisted insertion order in the collection. To move an item to the end, remove and add its membership again. The ordinary catalog still sorts by title. Mixed-room or mixed demo/live collections cannot share a panorama. Adding incompatible members or changing their room suspends panorama rendering without deleting the image; Remove panorama frees its space. No arbitrary CSS, remote image URL, filesystem path, HTML or SVG upload is accepted.

Custom covers, spines and panoramas share the **64 MiB** budget with cached source covers. Connection **Clear cached covers** frees only downloaded source images, retaining metadata, favorites, custom images and source files; synchronize to download them again. The controls are protected by owner authentication and the same JSON/Origin/CSRF checks as other mutations. Raster signatures are checked against declared MIME; uploaded images are stored as SQLite BLOBs and included in the normal backup. There is no anonymous upload or arbitrary image proxy.

## URLs

Enter the base service URL, not an API endpoint or item URL: `https://books.example.org` or `https://example.org/books`. The container must resolve it and trust its TLS certificate. A separate optional Browser URL allows local server networking with a different browser-accessible hostname. Handoff navigates the current tab, so mobile popup blockers do not prevent it; use Back to return. No credentials appear in handoff URLs. Source handoff routes are inspected/structurally tested, not live navigated against all source versions; route changes can require an adapter update. No configurable arbitrary action URL/template is accepted.

Use **Test connection** before saving; saved connections can also be tested. Save then synchronize. Test validates the authenticated identity endpoint, not every media format or library permission. An empty accessible library can successfully test and sync zero items. Removing a connection deletes its cached catalog/favorites/memberships, never its upstream files.

## Audiobookshelf

Use a normal account with access to only the intended book libraries and create a user-bound API key in the server's API Keys settings. An administrator may need to issue the key for that reader depending on the installed version. Do not grant a shared administrator's entire library to a future family account. The latest API-key model is targeted; older static JWT/token behavior is unverified.

Health calls `/api/me`; collection enumeration includes only libraries whose media type is `book`, not podcasts. Book responses accept regular `audioFiles` plus full or minified author/series forms. Audio presence determines audiobook presentation. Metadata filenames/filesystem paths are discarded. Mixed ebook/audio editions use one source item and hand off to the source detail page.

Official documentation: <https://api.audiobookshelf.org/> and <https://audiobookshelf.org/docs/category/server-management/>. Inspection included `server/models/Book.js`, `User.js`, and `client/pages/item/_id/index.vue` in <https://github.com/advplyr/audiobookshelf>. Fixtures use the documented `results/total`, library metadata and mediaProgress fields.

## Komga

Create an API key under **Account → API keys** for a normal reader with the intended libraries. Version lines without `X-API-Key` are not supported by this milestone; Basic authentication isn't implemented. The inspected official API reference was version 1.28.0. This is a contract target, not a live compatibility guarantee.

The account health endpoint is `/api/v2/users/me`; the earlier milestone incorrectly used v1 and produced HTTP 404 on current Komga. Its book-list and thumbnail endpoints remain v1. SelfLib uses the documented POST list endpoint rather than the deprecated GET list. Book metadata includes series title, authors, summary and reading progress. Progress is `page / pagesCount`, with completed books marked 100%. The detail handoff supports Komga selecting its appropriate comic/PDF or EPUB reader rather than forcing `/read` for all formats.

Official docs: <https://komga.org/docs/openapi/komga-api/>. Inspected `BookDto.kt` and `komga-webui/src/router.ts` in <https://github.com/gotson/komga>. The fixture includes `content/last`, metadata, page count and readProgress.

## Jellyfin

The connection form now offers **Jellyfin username/password sign-in** as well as manual token entry. Choose Jellyfin, leave the token field blank, enter a normal viewer account, approve private LAN access if needed, then Test/Save. SelfLib calls only the configured server's `/Users/AuthenticateByName`, using its bounded, DNS-checked, redirect-blocking transport. The password is transient: it is not written to SQLite or logs; the resulting access token is encrypted server-side and is never returned to the browser. Use HTTPS between browser/SelfLib and SelfLib/Jellyfin when transmitting real credentials. Test and Save each create a source session; revoke unused SelfLib sessions in Jellyfin. Existing connections can be edited to replace a Dashboard key with viewer sign-in.

HTTP 400 from `/Users/Me` can mean that a server-wide key has no viewer identity. SelfLib now explains this rather than showing only HTTP 400. A wrong URL can also cause this status; a screenshot alone cannot confirm which credential was used.

### Manual token alternative

Use a normal **viewer account's access token**, not an admin Dashboard API key. `/Users/Me` must identify the intended viewer; server-wide API keys that don't identify a user aren't accepted. A user token can be acquired through Jellyfin's documented authentication API. The following operator example requests credentials interactively, avoids putting the password in command arguments, and prints the token privately to your terminal. Requires Python 3; do not record/share its output.

```bash
python3 - <<'PY'
import getpass, json, urllib.request
base = input('Jellyfin base URL (HTTPS recommended): ').rstrip('/')
username = input('Viewer username: ')
password = getpass.getpass('Viewer password: ')
payload = json.dumps({'Username': username, 'Pw': password}).encode()
auth = 'MediaBrowser Client="SelfLib setup", Device="Terminal", DeviceId="selflib-setup", Version="0.1.0"'
request = urllib.request.Request(base + '/Users/AuthenticateByName', data=payload,
    headers={'Content-Type': 'application/json', 'Authorization': auth}, method='POST')
with urllib.request.urlopen(request, timeout=10) as response:
    result = json.load(response)
print('User:', result['User']['Name'])
print('Private access token:', result['AccessToken'])
PY
```

Paste the private access token into the connection form, then clear any terminal recording/clipboard history you control. Source tokens can be revoked at the source. SelfLib doesn't persist the upstream password. Each token request creates a source session; use a dedicated identifiable token and revoke it when no longer needed.

SelfLib enumerates Movie, Series and Episode using a viewer ID and source-provided UserData. Runtime/position ticks are converted to seconds and fractions. Existing Jellyfin remains responsible for streaming, codec support, subtitles, transcoding and progress updates. Series and episodes appear together in TV Shows, separate from Movies; nested season browsing is a later UI refinement.

Official SDK/API docs: <https://typescript-sdk.jellyfin.org/> and <https://typescript-sdk.jellyfin.org/classes/generated-client.LibraryApi.html>. Authentication endpoint: <https://typescript-sdk.jellyfin.org/classes/generated-client.AuthenticationApi.html>. The fixture includes `Items/TotalRecordCount`, runtime, UserData and image tags.

## Errors and limits

- 401/403: verify credential and account/library permissions.
- Redirect: enter the final base URL; credentials are never forwarded through redirects.
- Timeout: check container DNS, firewall and valid certificates.
- Contract mismatch: consult the source's API docs and report the version with a redacted fixture.
- Pagination or item cap: the old catalog is retained; this milestone doesn't partially replace a collection.
- Artwork failure/budget: catalog still succeeds and generated covers remain usable. Connection warnings now summarize safe error reasons and counts (HTTP, format, size, or reachability); private response bodies are not shown.

When editing URL, account credential or type, old cached content remains until a successful sync. All of it remains private to the sole owner. Remove/re-add if you intend to purge the old account's cached content immediately.
