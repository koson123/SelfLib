# Development

Use Node **24.19.0** (supported engine: 24.15+ within major 24) and npm. The Node SQLite API used here is not supported by older Node runtimes. Dependencies are exact-pinned; run `npm ci`, not an unreviewed blanket dependency upgrade.

```bash
npm ci
npm run check
npm run dev
```

Open `http://localhost:3000`. The default data directory is `./data` (ignored by Git). `dev` builds once and runs the TypeScript server; it is not a hot-reload environment. Rebuild/restart after edits. Read the first-run token from `data/setup.token` privately, then create the owner. Native runs can set `APP_URL`, `PORT`, and `DATA_DIR`; `APP_URL` must match the browser origin.

## Checks

- `npm run typecheck`: strict TypeScript check.
- `npm run lint`: ESLint and formatting check.
- `npm run format`: format source, tests and public docs.
- `npm test`: Node test runner, synthetic HTTP source fixtures, security, persistence/migrations and maintenance.
- `node scripts/licenses.mjs`: regenerate and validate runtime dependency notices after installing an updated lockfile.
- `node scripts/native-smoke.mjs`: exercise the compiled production server with a disposable temporary directory, including setup and restart persistence. Run the build first.
- `npm run build`: actual production server/browser build; all browser assets copied locally.
- `npx playwright install --with-deps chromium` then `npm run build` and `npm run test:e2e`: owner/demo/connection/collections browser flows at desktop, phone and tablet viewports.
- `docker compose --env-file .env.example up -d --build` then `node scripts/container-smoke.mjs`: **disposable fresh volume only**; creates a fixture owner and tests restart/persistence. Afterwards `docker compose down -v` only for that disposable install.

Browser tests create temporary data and fixture servers, not real service connections. They record fictional-demo screenshots in `docs/screenshots`. `CHROMIUM_EXECUTABLE` optionally selects an installed Chromium binary for constrained environments; it does not change supported browser claims. `playwright.config.ts` contains the viewport matrix; phone/tablet Chromium emulation is not real iOS Safari verification.

## Layout

```text
src/shared.ts             Presentation-independent adapter/catalog contracts
src/server/app.ts         Authenticated API, onboarding, catalog and sync
src/server/adapters.ts    Official-contract service adapters
src/server/security.ts    Passwords, credentials and bounded pinned-DNS transport
src/server/db.ts          Versioned SQLite initialization/migrations
src/client/               Browser TypeScript, locally bundled CSS and SVG
tests/                    Synthetic fixtures and API/security/persistence tests
tests/browser/            Disposable browser fixtures and UI journeys
scripts/                  Production build, offline maintenance, container smoke
```

The frontend has no runtime framework dependency. Scripts are bundled by esbuild; production dependencies are Express, Zod and Undici. SQLite database operations are synchronous and short; password scrypt and complete catalog transactions can briefly block the event loop. Limits keep this acceptable for the single-owner milestone. For larger multi-user workloads, measure before changing architecture.

## Fixture and live integration policy

Fixtures must be fictional, documented by upstream URL/contract, and exclude personal media, credentials and filesystem layout. Assert method, pagination and credential headers, not just that a title rendered. Include failure, unsupported progress, and malformed data tests. Never commit live access tokens or screenshots of connection credentials. A fixture-tested adapter becomes live-tested only when an actual source-version test is recorded explicitly.

## Contribution and release

See [CONTRIBUTING](../CONTRIBUTING.md), [architecture](architecture.md), and [operations](operations.md). Changes go through PR checks; no automatic deployment or image publishing. Run the image release workflow only on a reviewed exact-version tag once GHCR permissions and public visibility have been verified.
