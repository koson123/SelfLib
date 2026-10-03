import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../../src/server/app.js';
import { fixtureServer } from '../fixtures.js';
const dir = mkdtempSync(join(tmpdir(), 'selflib-browser-'));
mkdirSync('test-results', { recursive: true });
writeFileSync('test-results/e2e-directory.txt', dir);
const fixture = await fixtureServer();
writeFileSync('test-results/e2e-source.txt', fixture.url);
const instance = createApplication({
  dataDir: dir,
  appUrl: 'http://localhost:3100',
  staticDir: 'dist/public',
  allowLoopback: true,
});
const server = instance.app.listen(3100);
async function close() {
  server.closeAllConnections();
  server.close();
  await instance.close();
  await fixture.close();
  rmSync(dir, { recursive: true, force: true });
  process.exit(0);
}
process.on('SIGTERM', () => void close());
process.on('SIGINT', () => void close());
