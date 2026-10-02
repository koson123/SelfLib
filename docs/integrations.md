# Integration setup and contracts

All adapters in 0.1.0 are tested against hand-authored fixtures based on official APIs, not live instances. API documentation and upstream routing were inspected; installed-version compatibility still needs live confirmation. SelfLib doesn't infer capabilities from screenshots. Future adapters aren't selectable.

| Source         | Credential                                            | Catalog and artwork                                                              | Progress                                     | Handoff                                         |
| -------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------- |
| Audiobookshelf | User-bound API key as Bearer token                    | `/api/libraries`, paginated `/api/libraries/{id}/items`, `/api/items/{id}/cover` | `/api/me` mediaProgress snapshot             | `/item/{id}` detail page                        |
| Komga          | `X-API-Key` from intended reader account              | POST `/api/v1/books/list`, book thumbnail                                        | `readProgress` in BookDto                    | `/book/{id}` detail page; source chooses reader |
| Jellyfin       | Intended viewer's user access token in `X-Emby-Token` | `/Items?UserId=...`, Primary images                                              | UserData positions/runtime for Movie/Episode | `/web/#/details?id={id}`                        |

`embeddedPlayback` is explicitly unsupported. TV series folders have no meaningful playback position; only movies/episodes report one. A book without recorded progress has no continue entry. Finished items are excluded from continue. SelfLib reads progress and leaves updates to source readers/players. Its progress positions are not generic interchangeable bookmarks: seconds, pages or source fractions are retained.

## Shelf categories

Books, Audiobooks, Comics, Manga, Movies, and TV Shows have separate navigation and shelves. Item identity and coarse source sections remain unchanged, so existing favorites and collections survive the update without a database migration. Audiobookshelf audio presence distinguishes audiobook editions; mixed ebook/audio items use the audiobook room. Jellyfin Movie goes to Movies; Series/Episode go to TV Shows. Nested seasons remain a later refinement.

Komga does not provide a universal manga format flag on book records. SelfLib uses an explicit book metadata tag `Manga` (case-insensitive, trimmed) for the Manga room; untagged books stay in Comics. It does not infer manga from titles, creators, nationality, or artwork. Synchronize again after source tags change. Series-only genre tags are not used in this milestone.

Spines use cached cover artwork in a small medallion, or locally drawn symbols when artwork is missing, with title/author labels. No third-party fan art is automatically downloaded. Full titles are available in the detail panel and hover tooltip.

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
