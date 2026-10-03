# Upstream design research and attribution

SelfLib's application code, shelf CSS, fictional titles, generated cover designs, icons and inline SVG room illustration are original. **No code, assets, fonts, screenshots, models, or reader components were copied from the projects below.** MIT was selected for SelfLib because its own implementation and installed permissive dependencies are compatible; this does not relicense connected media services.

The following repositories were inspected at these exact commits. Links pin the inspected state rather than an evolving default branch.

| Project / inspected revision                                                                                                                                     | Verified license | Ideas adopted / reuse decision                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ShelfHaven](https://github.com/bohemtucsok/ShelfHaven/tree/00fe9bced1655c94b06e1b486593e90cf392aa23) — `00fe9bced1655c94b06e1b486593e90cf392aa23`               | MIT              | Inspected `BookSpine.tsx`, `ShelfScene.tsx`, authentication and Docker structure. Adopt the spatial shelf metaphor, stable generated spine colors, and selecting a book for details. Implemented independently with accessible HTML/CSS; no copied React/3D code, book-management backend or artwork. |
| [KoreShelf](https://github.com/GabrieleTrovato01/KoreShelf/tree/90fd06d0ce4898729bef6fffe66432c8c784566e) — `90fd06d0ce4898729bef6fffe66432c8c784566e`           | MIT              | Inspected server, main application and image/loader optimization. Adopt a dedicated browsing experience and small local deployment. Its collection-management and image pipeline are not reused; source services keep ownership.                                                                      |
| [virtual-bookshelf](https://github.com/petargyurov/virtual-bookshelf/tree/3c1073227df161d87eb48e7286bb7748cd22cd4d) — `3c1073227df161d87eb48e7286bb7748cd22cd4d` | Unlicense        | Inspected the CSS shelf/spine structure. Adopt browser-rendered shelves and gentle interaction. Original CSS replaces its implementation. No remote Picsum images or copied assets.                                                                                                                   |
| [PDF.js](https://github.com/mozilla/pdf.js/tree/c33c32aed46637ec6010e9f6c031c72e1c529d31) — `c33c32aed46637ec6010e9f6c031c72e1c529d31`                           | Apache-2.0       | Reviewed as a future reader candidate. Not bundled; version 0.1.0 hands off to source applications. A future inclusion must preserve its license/NOTICE and separately review bundled fonts/assets.                                                                                                   |

These are design inspirations, not runtime dependencies or endorsements. No upstream attribution obligations arise from copied source because none was copied. The URLs/revisions are retained so contributors can verify that boundary. Dependency license obligations are separate.

## Runtime dependencies

Direct packages, exact-pinned in the lockfile:

| Package                                         | Version | License | Role                                     |
| ----------------------------------------------- | ------- | ------- | ---------------------------------------- |
| [Express](https://github.com/expressjs/express) | 5.2.1   | MIT     | HTTP API and static assets               |
| [Undici](https://github.com/nodejs/undici)      | 8.11.2  | MIT     | Bounded, DNS-pinned source HTTP requests |
| [Zod](https://github.com/colinhacks/zod)        | 4.6.5   | MIT     | Input and source-contract validation     |

All installed runtime transitive packages were checked from their actual `package.json` and license files: MIT, ISC or BSD-3-Clause. Full required texts/copyright notices are in [docs/dependency-licenses.txt](docs/dependency-licenses.txt). Installed package directories also retain their own notices in the container. Run `node scripts/licenses.mjs` after `npm ci` when updating the lockfile; the script fails on unfamiliar runtime licenses or missing notices. Review new licenses explicitly before modifying its allowlist.

Development/build tools remain separate: TypeScript is Apache-2.0; esbuild, tsx, ESLint, Prettier and typescript-eslint are MIT; Playwright is Apache-2.0; DefinitelyTyped type packages are MIT. Their exact resolved dependencies and licenses are preserved by npm, not vendored as application code. The frontend bundle contains original SelfLib code and no third-party reader or visual engine.

## Assets and distribution

System font stacks require no downloaded fonts. The app has no external cover assets, cloud images, CDN scripts or telemetry. Screenshots show SelfLib's fictional demo. Real source artwork remains private cached content provided by the user's connected account; users must have rights to their media/artwork. It is not redistributed in SelfLib's repository or image.

The Docker image derives from the official Node Debian image; Node, SQLite, OpenSSL and Debian packages retain their own distribution notices. Do not remove base-image notices when repackaging. New 3D models, fonts, icons, readers or codecs require a separate asset/dependency review even if the enclosing project's code license is permissive.

The illustrated-spine follow-up inspected official Komga OpenAPI BookDto.libraryId, LibraryDto and thumbnail endpoints, and Jellyfin's documented Box/Primary image types. No upstream code or thumbnail assets were copied. User-provided cover/spine reference images were used only to understand presentation and were not bundled. The botanical spine SVG and moonlit panorama in browser fixtures/screenshots are original project drawings. No third-party DVD/fan-art provider, new runtime dependency, mandatory CDN, or user media asset was introduced.

Inspection references for this follow-up: Komga `2ab7a5a61a8b8bb12a6edd576fed380b4b613c99` (`komga/docs/openapi.json`) and Jellyfin `305a96471509f11de4d3a93e1ea268d4fd2af76c` (`MediaBrowser.Model/Entities/ImageType.cs`). These are read-only API/enum inspections; no code or assets were reused.

The TV hierarchy correction also inspected `MediaBrowser.Model/Dto/BaseItemDto.cs` at Jellyfin commit `305a96471509f11de4d3a93e1ea268d4fd2af76c` for SeriesId, ParentIndexNumber and IndexNumber. No upstream code/assets copied. Sleeve crop fixtures reuse SelfLib's original moonlit painting, not retail scans or user images. Read-only artwork-provider research is linked in docs/verification.md; no provider integration or downloaded artwork was added.

The hinged multi-disc case is original HTML/CSS geometry. The uploaded reference product photo was used only to understand the case structure and was not copied into code, screenshots, packages or the repository. Disc labels are generated from source metadata; source covers remain private authenticated artwork.
