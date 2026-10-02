import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdapter } from '../src/server/adapters.js';
import { addressAllowed, validateBase, sourceTransport } from '../src/server/security.js';
import type { SourceConfig, SourceType } from '../src/shared.js';
import { fixtureServer, secret, fixtures } from './fixtures.js';
test('all documented adapters normalize paginated contracts, artwork, progress and handoff', async () => {
  const server = await fixtureServer();
  try {
    for (const type of ['audiobookshelf', 'komga', 'jellyfin'] as SourceType[]) {
      const source: SourceConfig = {
        id: type,
        type,
        name: type,
        url: server.url,
        publicUrl: 'https://media.example.org/base',
        credential: secret,
        allowPrivate: true,
      };
      const adapter = createAdapter(source, { allowLoopback: true });
      assert.ok((await adapter.health()).account);
      const page = await adapter.page();
      assert.ok(page.items.length);
      const item = page.items[0];
      assert.equal(item.sourceId, type);
      assert.ok(item.progress!.fraction > 0);
      if (type === 'audiobookshelf') {
        assert.equal(item.kind, 'audiobook');
        assert.equal(item.creator, 'Fictional Author');
        assert.equal(item.series, 'Fixture Journeys');
      }
      assert.equal(page.nextCursor, undefined);
      assert.equal((await adapter.artwork(item))?.mime, 'image/png');
      const url = adapter.handoff(item);
      assert.ok(url.startsWith(source.publicUrl + '/'));
      assert.ok(!url.includes(secret));
      assert.equal(item.actions.embeddedPlayback, 'unsupported');
      if (type === 'jellyfin') assert.equal(page.items[1].actions.progress, 'unsupported');
    }
    assert.ok(server.requests.some((r) => r.url === '/api/v2/users/me'));
    assert.ok(!server.requests.some((r) => r.url === '/api/v1/users/me'));
    assert.ok(
      server.requests.some((r) => r.method === 'POST' && r.url.startsWith('/api/v1/books/list')),
    );
  } finally {
    await server.close();
  }
});
test('endpoint policy rejects metadata, loopback, dangerous schemes and credential URLs', () => {
  for (const address of [
    '169.254.169.254',
    '127.0.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::',
    'fe80::1',
    'ff02::1',
    '::ffff:169.254.169.254',
    '168.63.129.16',
    '100.100.100.200',
    'fd00:ec2:0:0:0:0:0:254',
  ])
    assert.equal(addressAllowed(address, true), false, address);
  assert.equal(addressAllowed('10.2.3.4', false), false);
  assert.equal(addressAllowed('10.2.3.4', true), true);
  assert.equal(addressAllowed('fc00::1', true), true);
  assert.equal(addressAllowed('8.8.8.8', false), true);
  for (const url of [
    'file:///etc/passwd',
    'http://user:password@example.org',
    'https://example.org/?token=x',
    'https://example.org/#x',
    'https://example.org/%2f%2fevil',
  ])
    assert.throws(() => validateBase(url));
  assert.equal(validateBase('https://example.org/base/'), 'https://example.org/base');
});
test('transport refuses redirects, oversized artwork and unapproved local destinations', async () => {
  const server = await fixtureServer();
  const source: SourceConfig = {
    id: 'test',
    type: 'komga',
    name: 'test',
    url: server.url,
    publicUrl: server.url,
    credential: secret,
    allowPrivate: true,
  };
  try {
    await assert.rejects(() => sourceTransport(source, {}).json('/api/me'), /Endpoint blocked/);
    const transport = sourceTransport(source, {}, true);
    await assert.rejects(() => transport.json('/redirect'), /redirected/);
    await assert.rejects(() => transport.image('/oversized'), /size limit/);
    await assert.rejects(() => transport.json('//evil.example'), /invalid path/);
  } finally {
    await server.close();
  }
});
test('adapter pagination advances actual library/page and offset cursors', async () => {
  const server = await fixtureServer();
  try {
    const source: SourceConfig = {
      id: 'test',
      type: 'komga',
      name: 'test',
      url: server.url,
      publicUrl: server.url,
      credential: secret,
      allowPrivate: true,
    };
    const calls: string[] = [];
    const transport = {
      async json<T>(path: string): Promise<T> {
        calls.push(path);
        if (path === '/Users/Me') return { Id: 'viewer-1' } as T;
        if (path.startsWith('/Items?'))
          return {
            Items: [{ Id: 'movie-1', Name: 'Fixture', Type: 'Movie' }],
            TotalRecordCount: 2,
          } as T;
        if (path === '/api/libraries')
          return {
            libraries: [
              { id: 'lib-1', mediaType: 'book' },
              { id: 'lib-2', mediaType: 'book' },
            ],
          } as T;
        if (path.startsWith('/api/libraries/'))
          return { results: [], total: path.includes('page=0') ? 101 : 0 } as T;
        if (path.startsWith('/api/v1/books/list'))
          return { content: [], last: path.includes('page=1') } as T;
        return { bytes: new Uint8Array(), mime: 'image/png' } as T;
      },
      async image() {
        return { bytes: new Uint8Array(), mime: 'image/png' };
      },
    };
    const abs = createAdapter({ ...source, type: 'audiobookshelf' }, { transport });
    assert.equal((await abs.page()).nextCursor, '0:1');
    assert.equal((await abs.page('0:1')).nextCursor, '1:0');
    assert.equal((await abs.page('1:0')).nextCursor, '1:1');
    const komga = createAdapter(source, { transport });
    assert.equal((await komga.page()).nextCursor, '1');
    assert.equal((await komga.page('1')).nextCursor, undefined);
    assert.ok(calls.some((c) => c.includes('page=1')));
    const jelly = createAdapter({ ...source, type: 'jellyfin' }, { transport });
    assert.equal((await jelly.page()).nextCursor, '1');
    assert.equal((await jelly.page('1')).nextCursor, undefined);
    assert.ok(calls.some((c) => c.includes('StartIndex=1')));
  } finally {
    await server.close();
  }
});

test('Komga manga labels come from explicit book tags without guessing titles or changing source identity', async () => {
  const server = await fixtureServer();
  try {
    const book = fixtures.komgaPage.content[0];
    server.setResponse('/api/v1/books/list', {
      content: [{ ...book, metadata: { ...book.metadata, tags: [' Manga '] } }],
      last: true,
    });
    const source: SourceConfig = {
      id: 'komga',
      type: 'komga',
      name: 'Comics',
      url: server.url,
      publicUrl: server.url,
      credential: secret,
      allowPrivate: true,
    };
    const item = (await createAdapter(source, { allowLoopback: true }).page()).items[0];
    assert.equal(item.kind, 'manga');
    assert.equal(item.section, 'comics');
    assert.equal(item.sourceItemId, book.id);
  } finally {
    await server.close();
  }
});
