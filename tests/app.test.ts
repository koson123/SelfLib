import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { decrypt, verifyPassword } from '../src/server/security.js';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, unlinkSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApplication } from '../src/server/app.js';
import { openDatabase } from '../src/server/db.js';
import { fixtureServer, secret, fixtures, png } from './fixtures.js';
import type { SourceType } from '../src/shared.js';

async function harness(
  dir = mkdtempSync(join(tmpdir(), 'selflib-test-')),
  secure = false,
  cacheBytes?: number,
) {
  const instance = createApplication({
    dataDir: dir,
    appUrl: secure ? 'https://library.example.org' : 'http://library.example.org',
    allowLoopback: true,
    maxItems: 100,
    cacheBytes,
  });
  const server = instance.app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.on('listening', resolve));
  const addr = server.address();
  const url = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  const origin = secure ? 'https://library.example.org' : 'http://library.example.org';
  let cookie = '';
  let csrf = '';
  async function request(
    path: string,
    method = 'GET',
    body?: unknown,
    extra: Record<string, string> = {},
  ) {
    const response = await fetch(url + path, {
      method,
      headers: {
        Cookie: cookie,
        Origin: origin,
        ...(method !== 'GET' ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf } : {}),
        ...extra,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) {
      const jar = new Map(
        cookie
          .split('; ')
          .filter(Boolean)
          .map((c) => {
            const i = c.indexOf('=');
            return [c.slice(0, i), c.slice(i + 1)];
          }),
      );
      for (const set of cookies) {
        const [pair] = set.split(';');
        const i = pair.indexOf('=');
        jar.set(pair.slice(0, i), pair.slice(i + 1));
      }
      cookie = [...jar].map(([k, v]) => k + '=' + v).join('; ');
    }
    const text = await response.text();
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text);
    } catch {
      /* image */
    }
    if (typeof json.csrf === 'string') csrf = json.csrf;
    return { response, json, text };
  }
  async function setup() {
    await request('/api/status');
    return request('/api/setup', 'POST', {
      username: 'reader',
      password: 'a-very-long-fixture-password',
      setupToken: readFileSync(join(dir, 'setup.token'), 'utf8'),
    });
  }
  return {
    instance,
    dir,
    url,
    request,
    setup,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await instance.close();
    },
  };
}
async function waitSync(h: Awaited<ReturnType<typeof harness>>, id: string) {
  for (let i = 0; i < 100; i++) {
    const { json } = await h.request('/api/sources');
    const source = (
      json.sources as { id: string; syncing: boolean; health: string; error?: string }[]
    ).find((s) => s.id === id)!;
    if (!source.syncing) return source;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('sync timeout');
}
test('owner setup, secure authentication, CSRF, sessions and logout protect metadata and images', async () => {
  const h = await harness(undefined, true);
  try {
    assert.equal((await h.request('/api/items')).response.status, 401);
    assert.equal((await h.request('/api/items/demo-0/artwork')).response.status, 401);
    assert.equal((await h.request('/api/sources')).response.status, 401);
    assert.equal((await h.request('/api/demo')).response.status, 200);
    await h.request('/api/status');
    assert.equal(
      (
        await h.request('/api/setup', 'POST', {
          username: 'reader',
          password: 'a-very-long-fixture-password',
          setupToken: 'wrong',
        })
      ).response.status,
      403,
    );
    const created = await h.setup();
    assert.equal(created.response.status, 201);
    assert.ok(
      created.response.headers
        .getSetCookie()
        .some(
          (c) => c.includes('HttpOnly') && c.includes('Secure') && c.includes('SameSite=Strict'),
        ),
    );
    assert.notEqual(
      (h.instance.db.prepare('SELECT password FROM owner').get() as { password: string }).password,
      'a-very-long-fixture-password',
    );
    assert.equal(
      (
        await h.request(
          '/api/collections',
          'POST',
          { name: 'Stories' },
          { Origin: 'https://evil.example' },
        )
      ).response.status,
      403,
    );
    assert.equal(
      (
        await h.request(
          '/api/collections',
          'POST',
          { name: 'Stories' },
          { 'X-CSRF-Token': 'wrong' },
        )
      ).response.status,
      403,
    );
    assert.equal((await h.request('/api/setup', 'POST', {})).response.status, 409);
    await h.request('/api/logout', 'POST', {});
    assert.equal((await h.request('/api/items')).response.status, 401);
    await h.request('/api/status');
    assert.equal(
      (
        await h.request('/api/login', 'POST', {
          username: 'reader',
          password: 'a-very-long-fixture-password',
        })
      ).response.status,
      200,
    );
  } finally {
    await h.close();
    rmSync(h.dir, { recursive: true, force: true });
  }
});
test('fixture sources sync, credentials remain private, cache survives outages and restart, mixed collections persist', async () => {
  const fixture = await fixtureServer();
  let h = await harness();
  const dir = h.dir;
  try {
    await h.setup();
    const ids: string[] = [];
    for (const type of ['audiobookshelf', 'komga', 'jellyfin'] as SourceType[]) {
      const body = {
        type,
        name: type,
        url: fixture.url,
        publicUrl: 'https://media.example.org',
        credential: secret,
        allowPrivate: true,
      };
      assert.equal((await h.request('/api/sources/test', 'POST', body)).response.status, 200);
      const saved = await h.request('/api/sources', 'POST', body);
      assert.equal(saved.response.status, 201);
      const id = String(saved.json.id);
      ids.push(id);
      assert.equal(
        (await h.request('/api/sources/' + id + '/sync', 'POST', {})).response.status,
        202,
      );
      assert.equal((await waitSync(h, id)).health, 'ready');
    }
    for (const [category, count] of [
      ['books', 0],
      ['audiobooks', 1],
      ['comics', 1],
      ['manga', 0],
      ['movies', 1],
      ['shows', 1],
    ] as const) {
      assert.equal((await h.request('/api/items?category=' + category)).json.total, count);
    }
    assert.equal((await h.request('/api/items?category=invalid')).response.status, 400);
    const sourceResponse = await h.request('/api/sources');
    assert.ok(!sourceResponse.text.includes(secret));
    const secrets = h.instance.db.prepare('SELECT secret FROM sources').all() as {
      secret: string;
    }[];
    for (const s of secrets) assert.ok(!s.secret.includes(secret));
    assert.equal(statSync(join(dir, 'secrets.key')).mode & 0o777, 0o600);
    const result = await h.request('/api/items');
    const items = result.json.items as {
      id: string;
      title: string;
      section: string;
      progress?: unknown;
    }[];
    assert.equal(items.length, 4);
    assert.ok(!result.text.includes('/never-read-this-filesystem-path'));
    assert.ok(!result.text.includes(secret));
    const audiobook = items.find((i) => i.title === 'Fixture Atlas')!;
    const movie = items.find((i) => i.title === 'Fixture Film')!;
    assert.equal((await h.request('/api/items/' + audiobook.id + '/artwork')).response.status, 200);
    const handoff = await h.request('/api/items/' + audiobook.id + '/open');
    assert.equal(handoff.json.url, 'https://media.example.org/item/book-1');
    assert.equal((await h.request('/api/items?q=Atlas')).json.total, 1);
    assert.equal((await h.request('/api/items?continue=true')).json.total, 3);
    assert.equal((await h.request('/api/items?section=comics')).json.total, 1);
    await h.request('/api/items/' + audiobook.id + '/favorite', 'PUT', { favorite: true });
    const collection = await h.request('/api/collections', 'POST', { name: 'Across the shelves' });
    const collectionId = String(collection.json.id);
    for (const item of [audiobook, movie])
      assert.equal(
        (
          await h.request(`/api/collections/${collectionId}/items/${item.id}`, 'PUT', {
            included: true,
          })
        ).response.status,
        200,
      );
    assert.equal((await h.request('/api/items?collection=' + collectionId)).json.total, 2);
    fixture.setFailure(true);
    await h.request('/api/sources/' + ids[0] + '/sync', 'POST', {});
    assert.equal((await waitSync(h, ids[0])).health, 'unreachable');
    assert.equal((await h.request('/api/items')).json.total, 4);
    assert.equal((await h.request('/api/items/' + audiobook.id + '/artwork')).response.status, 200);
    await h.close();
    h = await harness(dir);
    await h.request('/api/status');
    await h.request('/api/login', 'POST', {
      username: 'reader',
      password: 'a-very-long-fixture-password',
    });
    assert.equal((await h.request('/api/items?favorite=true')).json.total, 1);
    assert.equal((await h.request('/api/items?collection=' + collectionId)).json.total, 2);
    assert.equal((await h.request('/api/items/demo-0/open')).response.status, 409);
    assert.equal(
      (await h.request('/api/sources/' + ids[0] + '/test', 'POST', {})).response.status,
      502,
    );
  } finally {
    await fixture.close();
    await h.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('login throttling limits brute-force attempts', async () => {
  const h = await harness();
  try {
    await h.setup();
    await h.request('/api/logout', 'POST', {});
    await h.request('/api/status');
    for (let i = 0; i < 8; i++)
      await h.request('/api/login', 'POST', {
        username: 'reader',
        password: 'wrong-long-password',
      });
    assert.equal(
      (
        await h.request('/api/login', 'POST', {
          username: 'reader',
          password: 'wrong-long-password',
        })
      ).response.status,
      429,
    );
  } finally {
    await h.close();
    rmSync(h.dir, { recursive: true, force: true });
  }
});
test('database migrations are idempotent, reject future schemas and detect missing keys', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'selflib-migration-'));
  try {
    let db = openDatabase(dir);
    assert.equal(
      (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
      2,
    );
    db.close();
    db = openDatabase(dir);
    assert.equal((db.prepare('SELECT count(*) AS n FROM migrations').get() as { n: number }).n, 2);
    db.exec('PRAGMA user_version=99');
    db.close();
    assert.throws(() => openDatabase(dir), /newer/);
    db = new DatabaseSync(join(dir, 'selflib.sqlite'));
    db.exec('PRAGMA user_version=2');
    db.close();
    const h = await harness(dir);
    await h.setup();
    await h.request('/api/sources', 'POST', {
      type: 'komga',
      name: 'fixture',
      url: 'https://example.org',
      credential: secret,
      allowPrivate: false,
    });
    await h.close();
    unlinkSync(join(dir, 'secrets.key'));
    assert.throws(
      () => createApplication({ dataDir: dir, appUrl: 'http://localhost:3000' }),
      /Missing secrets.key/,
    );
    assert.throws(
      () => createApplication({ dataDir: dir, appUrl: 'https://example.org/library' }),
      /subpath/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('source configuration rejects unsafe inputs, credentials cannot be read and unsupported services are rejected', async () => {
  const h = await harness();
  try {
    await h.setup();
    for (const url of [
      'file:///etc/passwd',
      'http://user:pass@example.org',
      'http://example.org?key=secret',
    ]) {
      assert.equal(
        (
          await h.request('/api/sources', 'POST', {
            type: 'komga',
            name: 'bad',
            url,
            credential: secret,
          })
        ).response.status,
        400,
      );
    }
    assert.equal(
      (
        await h.request('/api/sources', 'POST', {
          type: 'immich',
          name: 'future',
          url: 'https://example.org',
          credential: secret,
        })
      ).response.status,
      400,
    );
    assert.equal((await h.request('/api/items?limit=1000')).response.status, 400);
  } finally {
    await h.close();
    rmSync(h.dir, { recursive: true, force: true });
  }
});

test('offline key rotation and owner recovery preserve credentials and revoke sessions', async () => {
  const h = await harness();
  const run = (command: string, input?: string) =>
    spawnSync(process.execPath, ['--import', 'tsx', 'scripts/maintenance.ts', command], {
      env: { ...process.env, DATA_DIR: h.dir },
      input,
      encoding: 'utf8',
    });
  try {
    await h.setup();
    await h.request('/api/sources', 'POST', {
      type: 'komga',
      name: 'fixture',
      url: 'https://example.org',
      credential: secret,
      allowPrivate: false,
    });
    assert.notEqual(run('rotate-key').status, 0);
    const oldKey = readFileSync(join(h.dir, 'secrets.key'));
    await h.close();
    const result = run('rotate-key');
    assert.equal(result.status, 0, result.stderr);
    const newKey = readFileSync(join(h.dir, 'secrets.key'));
    assert.notDeepEqual(newKey, oldKey);
    const db = openDatabase(h.dir);
    const stored = (db.prepare('SELECT secret FROM sources').get() as { secret: string }).secret;
    assert.equal(decrypt(stored, newKey), secret);
    db.close();
    const reset = run('reset-password', 'a-new-long-recovery-password');
    assert.equal(reset.status, 0, reset.stderr);
    const recovered = openDatabase(h.dir);
    assert.equal(
      verifyPassword(
        'a-new-long-recovery-password',
        (recovered.prepare('SELECT password FROM owner').get() as { password: string }).password,
      ),
      true,
    );
    assert.equal(
      (recovered.prepare('SELECT count(*) AS n FROM sessions').get() as { n: number }).n,
      0,
    );
    recovered.close();
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});

test('malformed and over-limit catalog responses retain the last complete synchronized catalog', async () => {
  const fixture = await fixtureServer();
  const h = await harness();
  try {
    await h.setup();
    const saved = await h.request('/api/sources', 'POST', {
      type: 'komga',
      name: 'bounded fixture',
      url: fixture.url,
      credential: secret,
      allowPrivate: true,
    });
    const id = String(saved.json.id);
    await h.request('/api/sources/' + id + '/sync', 'POST', {});
    assert.equal((await waitSync(h, id)).health, 'ready');
    fixture.setResponse('/api/v1/books/list', { content: [{ unexpected: secret }], last: true });
    await h.request('/api/sources/' + id + '/sync', 'POST', {});
    const failed = await waitSync(h, id);
    assert.equal(failed.health, 'unreachable');
    assert.ok(String(failed.error).includes('contract'));
    assert.ok(!String(failed.error).includes(secret));
    assert.equal((await h.request('/api/items')).json.total, 1);
    fixture.setResponse('/api/v1/books/list', {
      content: Array.from({ length: 101 }, (_, i) => ({
        ...fixtures.komgaPage.content[0],
        id: 'comic-' + i,
      })),
      last: true,
    });
    await h.request('/api/sources/' + id + '/sync', 'POST', {});
    assert.ok(String((await waitSync(h, id)).error).includes('limit'));
    assert.equal((await h.request('/api/items')).json.total, 1);
    assert.equal(
      (
        await h.request('/api/sources/' + id, 'PUT', {
          type: 'komga',
          name: 'Renamed fixture',
          url: fixture.url,
          credential: '',
          allowPrivate: true,
        })
      ).response.status,
      200,
    );
    assert.equal(
      (await h.request('/api/sources/' + id + '/test', 'POST', {})).response.status,
      200,
    );
    assert.ok(!(await h.request('/api/sources')).text.includes(secret));
    assert.equal((await h.request('/api/sources/' + id, 'DELETE', {})).response.status, 200);
    assert.equal((await h.request('/api/items')).json.total, 0);
    assert.ok(!fixture.requests.some((r) => r.method === 'DELETE'));
  } finally {
    await h.close();
    await fixture.close();
    rmSync(h.dir, { recursive: true, force: true });
  }
});

test('Jellyfin viewer sign-in exchanges passwords server-side and stores only encrypted tokens', async () => {
  const fixture = await fixtureServer();
  const h = await harness();
  try {
    await h.setup();
    const body = {
      type: 'jellyfin',
      name: 'Viewer',
      url: fixture.url,
      allowPrivate: true,
      jellyfinUsername: 'fixture-viewer',
      jellyfinPassword: 'fixture-viewer-password',
    };
    const denied = await h.request('/api/sources/test', 'POST', {
      ...body,
      jellyfinPassword: 'wrong',
    });
    assert.equal(denied.response.status, 502);
    assert.match(denied.text, /Authentication failed/);
    const tested = await h.request('/api/sources/test', 'POST', body);
    assert.equal(tested.response.status, 200);
    assert.ok(!tested.text.includes(secret));
    const saved = await h.request('/api/sources', 'POST', body);
    assert.equal(saved.response.status, 201);
    assert.ok(!saved.text.includes(secret));
    const row = h.instance.db
      .prepare('SELECT * FROM sources WHERE id=?')
      .get(String(saved.json.id))!;
    assert.ok(!JSON.stringify(row).includes(body.jellyfinPassword));
    assert.equal(decrypt(String(row.secret), readFileSync(join(h.dir, 'secrets.key'))), secret);
    const listed = await h.request('/api/sources');
    assert.ok(!listed.text.includes(secret) && !listed.text.includes(body.jellyfinPassword));
    assert.equal(
      (await h.request('/api/sources/' + saved.json.id + '/test', 'POST', {})).response.status,
      200,
    );
    const wrongKey = await h.request('/api/sources/test', 'POST', {
      ...body,
      jellyfinUsername: undefined,
      jellyfinPassword: undefined,
      credential: 'fixture-server-wide-key',
    });
    assert.equal(wrongKey.response.status, 502);
    assert.match(wrongKey.text, /viewer account access token/);
    assert.ok(!wrongKey.text.includes('fixture-server-wide-key'));
    const invalid = await h.request('/api/sources', 'POST', { ...body, type: 'komga' });
    assert.equal(invalid.response.status, 400);
  } finally {
    await h.close();
    await fixture.close();
    rmSync(h.dir, { recursive: true, force: true });
  }
});

test('private artwork uploads, box-set ordering, persistence and removal', async () => {
  let h = await harness();
  const dir = h.dir;
  try {
    await h.setup();
    const rows = (await h.request('/api/items?demo=true&category=books')).json.items as {
      id: string;
    }[];
    const ids = [rows[1].id, rows[0].id];
    const image = { mime: 'image/png', base64: png.toString('base64') };
    const cid = String(
      (await h.request('/api/collections', 'POST', { name: 'Fictional set' })).json.id,
    );
    for (const id of ids)
      await h.request('/api/collections/' + cid + '/items/' + id, 'PUT', { included: true });
    assert.deepEqual(
      (
        (await h.request('/api/items?demo=true&collection=' + cid)).json.items as { id: string }[]
      ).map((item) => item.id),
      ids,
    );
    assert.equal(
      (await h.request('/api/items/' + ids[0] + '/custom-artwork/spine', 'PUT', image)).response
        .status,
      200,
    );
    assert.equal(
      (await h.request('/api/items/' + ids[0] + '/custom-artwork/cover', 'PUT', image)).response
        .status,
      200,
    );
    assert.equal(
      (await h.request('/api/collections/' + cid + '/panorama', 'PUT', image)).response.status,
      200,
    );
    assert.equal((await h.request('/api/items/' + ids[0] + '/artwork')).response.status, 200);
    const layout = await h.request('/api/collections/' + cid + '/spine-layout.css');
    assert.match(layout.text, /width:200%/);
    assert.match(layout.text, /translateX\(-50%\)/);
    assert.equal(
      (
        await h.request('/api/items/' + ids[0] + '/custom-artwork/spine', 'PUT', image, {
          'X-CSRF-Token': 'wrong',
        })
      ).response.status,
      403,
    );
    assert.equal(
      (
        await h.request('/api/items/' + ids[0] + '/custom-artwork/cover', 'PUT', {
          mime: 'image/png',
          base64: Buffer.from('<svg onload=alert(1)></svg>').toString('base64'),
        })
      ).response.status,
      400,
    );
    assert.equal(
      (
        await h.request('/api/items/' + ids[0] + '/custom-artwork/cover', 'PUT', {
          mime: 'image/svg+xml',
          base64: image.base64,
        })
      ).response.status,
      400,
    );
    assert.equal(
      (
        await h.request('/api/items/' + ids[0] + '/custom-artwork/cover', 'PUT', {
          mime: 'image/png',
          base64: Buffer.alloc(512 * 1024 + 1).toString('base64'),
        })
      ).response.status,
      400,
    );
    await h.request('/api/items/' + ids[0] + '/favorite', 'PUT', { favorite: true });
    await h.close();
    h = await harness(dir);
    await h.request('/api/status');
    assert.equal(
      (await h.request('/api/items/' + ids[0] + '/custom-artwork/spine')).response.status,
      401,
    );
    assert.equal(
      (await h.request('/api/collections/' + cid + '/spine-layout.css')).response.status,
      401,
    );
    await h.request('/api/login', 'POST', {
      username: 'reader',
      password: 'a-very-long-fixture-password',
    });
    const item = (
      (await h.request('/api/items?demo=true&favorite=true')).json.items as {
        customSpine: boolean;
        customCover: boolean;
      }[]
    )[0];
    assert.equal(item.customSpine, true);
    assert.equal(item.customCover, true);
    assert.equal((await h.request('/api/collections/' + cid + '/panorama')).response.status, 200);
    const movie = (
      (await h.request('/api/items?demo=true&category=movies')).json.items as { id: string }[]
    )[0];
    await h.request('/api/collections/' + cid + '/items/' + movie.id, 'PUT', { included: true });
    assert.equal(
      (await h.request('/api/collections/' + cid + '/panorama', 'PUT', image)).response.status,
      409,
    );
    assert.ok(
      (
        (await h.request('/api/collections')).json.collections as {
          id: string;
          panorama: boolean;
        }[]
      ).find((c) => c.id === cid)?.panorama === false,
    );
    await h.request('/api/items/' + ids[0] + '/custom-artwork/spine', 'DELETE', {});
    assert.equal(
      (await h.request('/api/items/' + ids[0] + '/custom-artwork/spine')).response.status,
      404,
    );
    await h.request('/api/collections/' + cid, 'DELETE', {});
    assert.equal((await h.request('/api/collections/' + cid + '/panorama')).response.status, 404);
  } finally {
    await h.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('schema 1 upgrade retains owner, favorites, memberships and encrypted connections', async () => {
  const h = await harness();
  const dir = h.dir;
  try {
    await h.setup();
    const id = ((await h.request('/api/items?demo=true')).json.items as { id: string }[])[0].id;
    await h.request('/api/items/' + id + '/favorite', 'PUT', { favorite: true });
    const cid = String(
      (await h.request('/api/collections', 'POST', { name: 'Old membership' })).json.id,
    );
    await h.request('/api/collections/' + cid + '/items/' + id, 'PUT', { included: true });
    await h.request('/api/sources', 'POST', {
      type: 'komga',
      name: 'Old connection',
      url: 'https://media.example.org',
      credential: secret,
    });
    await h.close();
    let db = new DatabaseSync(join(dir, 'selflib.sqlite'));
    const encrypted = db.prepare('SELECT secret FROM sources').get()!.secret;
    db.exec(
      'DROP TABLE item_artwork; DROP TABLE collection_artwork; ALTER TABLE sources DROP COLUMN library_rooms; DELETE FROM migrations WHERE version=2; PRAGMA user_version=1;',
    );
    db.close();
    db = openDatabase(dir);
    assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 2);
    assert.equal(db.prepare('SELECT secret FROM sources').get()!.secret, encrypted);
    assert.equal(db.prepare('SELECT count(*) AS n FROM favorites').get()!.n, 1);
    assert.equal(db.prepare('SELECT count(*) AS n FROM collection_items').get()!.n, 1);
    assert.equal(db.prepare('SELECT library_rooms FROM sources').get()!.library_rooms, '{}');
    assert.equal(db.prepare('SELECT count(*) AS n FROM owner').get()!.n, 1);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('custom artwork shares the global budget and does not evict a previous image on failure', async () => {
  const h = await harness(undefined, false, png.length);
  try {
    await h.setup();
    const id = ((await h.request('/api/items?demo=true')).json.items as { id: string }[])[0].id;
    const image = { mime: 'image/png', base64: png.toString('base64') };
    assert.equal(
      (await h.request('/api/items/' + id + '/custom-artwork/cover', 'PUT', image)).response.status,
      200,
    );
    const denied = await h.request('/api/items/' + id + '/custom-artwork/spine', 'PUT', image);
    assert.equal(denied.response.status, 409);
    assert.match(denied.text, /cache is full/);
    assert.equal(
      (await h.request('/api/items/' + id + '/custom-artwork/cover')).response.status,
      200,
    );
    assert.equal(
      (await h.request('/api/items/' + id + '/custom-artwork/spine')).response.status,
      404,
    );
  } finally {
    await h.close();
    rmSync(h.dir, { recursive: true, force: true });
  }
});

test('Komga library mapping is configurable, survives connection editing, and strips filesystem roots', async () => {
  const h = await harness();
  const server = await fixtureServer();
  try {
    await h.setup();
    const body = {
      type: 'komga',
      name: 'Libraries',
      url: server.url,
      credential: secret,
      allowPrivate: true,
      libraryRooms: { 'comic-lib': 'graphicnovels' },
    };
    const id = String((await h.request('/api/sources', 'POST', body)).json.id);
    const libraries = await h.request('/api/sources/' + id + '/libraries');
    assert.equal(libraries.response.status, 200);
    assert.ok(!libraries.text.includes('/private-library-root'));
    assert.deepEqual(
      (libraries.json.libraries as { id: string }[]).map((library) => library.id),
      ['comic-lib', 'manga-lib', 'graphic-lib'],
    );
    const { libraryRooms: _, ...edited } = body;
    assert.equal(
      (await h.request('/api/sources/' + id, 'PUT', { ...edited, credential: '', name: 'Renamed' }))
        .response.status,
      200,
    );
    assert.equal(
      (await h.request('/api/sources/' + id + '/sync', 'POST', {})).response.status,
      202,
    );
    await waitSync(h, id);
    assert.equal((await h.request('/api/items?category=graphicnovels')).json.total, 1);
    assert.equal((await h.request('/api/items?category=comics')).json.total, 0);
    const itemId = String(
      ((await h.request('/api/items?category=graphicnovels')).json.items as { id: string }[])[0].id,
    );
    await h.request('/api/items/' + itemId + '/favorite', 'PUT', { favorite: true });
    await h.request('/api/items/' + itemId + '/custom-artwork/spine', 'PUT', {
      mime: 'image/png',
      base64: png.toString('base64'),
    });
    assert.equal(
      (await h.request('/api/sources/' + id + '/clear-artwork', 'POST', {})).response.status,
      200,
    );
    assert.equal(
      h.instance.db.prepare('SELECT artwork FROM items WHERE id=?').get(itemId)!.artwork,
      null,
    );
    assert.equal((await h.request('/api/items?favorite=true')).json.total, 1);
    assert.equal(
      (await h.request('/api/items/' + itemId + '/custom-artwork/spine')).response.status,
      200,
    );

    assert.equal(
      (
        await h.request('/api/sources', 'POST', {
          ...body,
          libraryRooms: { 'comic-lib': 'unknown-room' },
        })
      ).response.status,
      400,
    );
  } finally {
    await h.close();
    await server.close();
    rmSync(h.dir, { recursive: true, force: true });
  }
});
